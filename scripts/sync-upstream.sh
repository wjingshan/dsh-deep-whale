#!/usr/bin/env bash
# 以上游内容为准重放：把上游 Small-tailqwq/dsh-deep-whale 的代码树重放到本 fork，
# 随后重新套用本 fork 的 @wjingshan 改名与身份分离。
#
# 为什么不用 git merge：
#   1. 本 fork 的 git 历史与上游不相关（内容从上游 0.1.3 导入后重写），
#      `git merge` 会直接 `fatal: refusing to merge unrelated histories`。
#   2. 旧版本把 UPSTREAM_URL 写成了本 fork 自己（wjingshan/dsh-deep-whale），
#      于是每天「同步」都在合并自己，`git merge-base --is-ancestor` 恒为真，
#      上游代码一个都没进来。两个问题叠加，CI 一直是绿的假象。
# 这里改为逐文件重放，且任何 git 失败都会让 CI 红，不再有 `|| true`。
#
# 重放规则（每个上游文件）：
#   * 本地没有          → 取上游（新增）
#   * 本地 == 分叉基线   → 取上游最新（fork 没碰过这个文件）
#   * 本地 != 分叉基线   → 保留本地并告警（fork 改过：滑杆、立绘、身份分离等）
# 这样上游修复能持续进来，而 fork 自己的改动不会被静默覆盖。被判为「fork 改过」
# 的文件如果上游也改了，需要人工跟进——告警会列出来，CI 日志里能查到。
#
# 范围：只重放代码树与包清单。素材（winter/maid-right 等 fork 自有美术）、预览图、
# lib 构建产物与 fork 文档不在重放范围内；lib 由 CI 的 build 步骤重新生成。
set -euo pipefail

UPSTREAM_REMOTE="${UPSTREAM_REMOTE:-upstream}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-main}"
UPSTREAM_URL="${UPSTREAM_URL:-https://github.com/Small-tailqwq/dsh-deep-whale}"
# 本 fork 的分叉基线：上游 0.1.3 发布点。用来判断「这个文件 fork 是否改过」。
BASE_COMMIT="${FORK_BASE_COMMIT:-8063000}"
# 设为 1 时只打印计划，不改工作区（本地演练用）。
DRY_RUN="${DRY_RUN:-0}"

cd "$(dirname "$0")/.."

# CI 里没有全局 git 身份，而提交发生在 workflow 的后续步骤（提交构建产物），
# 所以在重放阶段就设好仓库级身份，让整个 job 内的 git commit 都能用。
if [ -z "$(git config user.name || true)" ]; then
  git config user.name "github-actions[bot]"
fi
if [ -z "$(git config user.email || true)" ]; then
  git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
fi

# 从上游重放的代码树。刻意排除三类：
#   * tests/：测试是各仓库自己的契约。上游新增的测试测的是上游实现，而 fork 保留
#     的 index.ts 等文件还没接线，重放测试必然红（实测 windows-caption、
#     release-claimed-styles 两组共 10 条）。让 fork 用自己的测试验证自己的实现。
#   * assets/、preview/：fork 自有或二进制素材。
#   * lib/：构建产物，由 CI 的 build 步骤重建。
UPSTREAM_TREES=(
  maid-atelier/src
  maid-atelier/build
  orca-link/src
  orca-link/build
  skin-manager/src
  shared
  scripts
)
UPSTREAM_FILES=(
  maid-atelier/package.json
  maid-atelier/skin.json
  maid-atelier/cordis.patch.yml
  maid-atelier/tsdown.config.ts
  orca-link/package.json
  orca-link/skin.json
  orca-link/cordis.patch.yml
  orca-link/tsdown.config.ts
  skin-manager/package.json
  skin-manager/tsdown.config.ts
)

# 注意：这里没有「受保护文件」白名单。新策略用「本地内容 != 分叉基线」判断
# fork 是否改过：改过就保留。曾经的 PROTECTED_FILES 白名单把真冲突（比如
# customization.ts，上游也改过）短路成「保留」，让告警失效——已删除。

# 资产方案相关的文件一律不重放。上游 0.1.4 起把图片从 base64 内联改成
# `/skin-assets/<skin>/<file>` URL（asset-url.ts + shared/skin-assets.ts + host 半边的
# installSkinAssets），而本 fork 的宿主路由是 `/maid-atelier/art/`。只重放客户端一半会
# 让每张图请求 404，所以这些文件保留 fork 版本；要迁移资产方案必须连同 host 半边一起
# 移植，那是独立的一次改动。
EXCLUDE_PATTERNS=(
  'maid-atelier/src/client/asset-url.ts'
  'maid-atelier/src/client/art.ts'
  'maid-atelier/src/client/*-art.generated.ts'
  'orca-link/src/client/asset-url.ts'
  'orca-link/src/client/art.ts'
  'orca-link/src/client/*-art.generated.ts'
)

is_excluded() {
  local candidate="$1"
  local pattern
  for pattern in "${EXCLUDE_PATTERNS[@]}"; do
    # shellcheck disable=SC2053
    if [[ "$candidate" == $pattern ]]; then
      return 0
    fi
  done
  return 1
}

if ! git remote get-url "$UPSTREAM_REMOTE" >/dev/null 2>&1; then
  echo "==> 添加 upstream remote：$UPSTREAM_URL"
  git remote add "$UPSTREAM_REMOTE" "$UPSTREAM_URL"
fi

echo "==> 拉取 $UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
git fetch --no-tags "$UPSTREAM_REMOTE" "$UPSTREAM_BRANCH"
UPSTREAM_HEAD="$(git rev-parse "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH")"
echo "    上游 HEAD：$(git rev-parse --short "$UPSTREAM_HEAD")"

if ! git cat-file -e "$BASE_COMMIT" 2>/dev/null; then
  echo "    基线 $BASE_COMMIT 不在本地，补拉一次"
  git fetch --no-tags "$UPSTREAM_REMOTE" "$BASE_COMMIT" || true
fi
if ! git cat-file -e "$BASE_COMMIT" 2>/dev/null; then
  echo "[错误] 找不到分叉基线 $BASE_COMMIT，无法判断哪些文件 fork 改过。" >&2
  echo "       设置 FORK_BASE_COMMIT 指向正确的上游提交后重试。" >&2
  exit 1
fi

mapfile -t UPSTREAM_PATHS < <(
  git ls-tree -r --name-only "$UPSTREAM_HEAD" -- "${UPSTREAM_TREES[@]}" "${UPSTREAM_FILES[@]}"
)

updated=()
added=()
kept=()
conflict=()
skipped=()

for path in "${UPSTREAM_PATHS[@]}"; do
  if is_excluded "$path"; then
    skipped+=("$path")
    continue
  fi

  local_blob=""
  if [ -f "$path" ]; then
    local_blob="$(git hash-object "$path")"
  fi
  upstream_blob="$(git rev-parse "$UPSTREAM_HEAD:$path")"
  base_blob="$(git rev-parse "$BASE_COMMIT:$path" 2>/dev/null || true)"

  if [ -z "$local_blob" ]; then
    # 本地没有这个上游文件：新增。
    added+=("$path")
    [ "$DRY_RUN" = 1 ] || git checkout "$UPSTREAM_HEAD" -- "$path"
    continue
  fi

  if [ -z "$base_blob" ]; then
    # 基线里没有、本地却有：同路径的 fork 自有文件，保留。
    kept+=("$path")
    continue
  fi

  if [ "$local_blob" = "$base_blob" ]; then
    # fork 没改过这个文件：采用上游最新（内容相同时不必写盘）。
    if [ "$local_blob" != "$upstream_blob" ]; then
      updated+=("$path")
      [ "$DRY_RUN" = 1 ] || git checkout "$UPSTREAM_HEAD" -- "$path"
    fi
    continue
  fi

  # fork 改过这个文件：本地版本保留。再区分两种情况——
  #   上游没动过（upstream == base）→ 只是 fork 自有改动，正常保留；
  #   上游也改了（upstream != base）→ 真正的冲突，需要人工合并。
  if [ "$local_blob" = "$upstream_blob" ]; then
    # 两边最终内容相同：无需处理，视作已同步。
    continue
  fi
  if [ "$upstream_blob" = "$base_blob" ]; then
    kept+=("$path")
  else
    conflict+=("$path")
  fi
done

echo "==> 上游重放结果"
echo "    采用上游最新：${#updated[@]} 个文件"
echo "    新增上游文件：${#added[@]} 个文件"
echo "    保留 fork 自有改动：${#kept[@]} 个文件（上游未动）"
echo "    需要人工合并：${#conflict[@]} 个文件（两边都改过）"
echo "    按策略跳过（资产方案）：${#skipped[@]} 个文件"

print_list() {
  local label="$1"
  shift
  local items=("$@")
  if [ "${#items[@]}" -eq 0 ]; then
    return 0
  fi
  echo "    ${label}："
  local shown=0
  local item
  for item in "${items[@]}"; do
    echo "      $item"
    shown=$((shown + 1))
    if [ "$shown" -ge 20 ]; then
      echo "      … 共 ${#items[@]} 个"
      break
    fi
  done
}

print_list "更新" "${updated[@]}"
print_list "新增" "${added[@]}"
print_list "保留（fork 改过、上游未动）" "${kept[@]}"
print_list "需要人工合并（两边都改过）" "${conflict[@]}"
print_list "跳过（资产方案，保留 fork 版本）" "${skipped[@]}"

if [ "${#conflict[@]}" -gt 0 ]; then
  echo "    [注意] 上面这些文件上游也改了，本脚本保留 fork 版本、不会自动跟随；" >&2
  echo "           请按文件名逐个人工合并，需要时参考上游 $(git rev-parse --short "$UPSTREAM_HEAD") 的改动。" >&2
fi

if [ "$DRY_RUN" = 1 ]; then
  echo "==> DRY_RUN=1：只打印计划，未修改工作区，也未套用改名。"
  exit 0
fi

echo "==> 重新套用 @wjingshan 改名与身份分离"
python3 scripts/apply-fork-rename.py

if [ "${#updated[@]}" -eq 0 ] && [ "${#added[@]}" -eq 0 ]; then
  echo "==> 上游没有新的代码改动"
else
  echo "==> 已重放上游内容，改动留给后续 build/test 提交"
fi
