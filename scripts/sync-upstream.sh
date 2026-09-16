#!/usr/bin/env bash
# 把上游 Small-tailqwq/dsh-deep-whale 的 main 合并进当前分支，
# 然后重新套用本 fork 的 @wjingshan 改名。
#
# 设计要点：
#   * 上游改动 scope 时必然与本 fork 冲突。这里对冲突文件统一取上游版本，
#     再由 apply-fork-rename.py 重新施加改名，所以 scope 冲突可以自动解决。
#   * 本 fork 独有的功能文件若被上游同时修改，会保留本 fork 版本并在
#     日志里告警（不会静默丢弃），随后的测试步骤负责兜底。
set -euo pipefail

UPSTREAM_REMOTE="${UPSTREAM_REMOTE:-upstream}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-main}"
UPSTREAM_URL="${UPSTREAM_URL:-https://github.com/Small-tailqwq/dsh-deep-whale}"

cd "$(dirname "$0")/.."

# 本 fork 独有、必须保留的功能文件
PROTECTED_FILES=(
  "maid-atelier/src/client/session-artwork.ts"
  "maid-atelier/tests/session-artwork.spec.ts"
  "maid-atelier/src/client/customization.ts"
)

if ! git remote get-url "$UPSTREAM_REMOTE" >/dev/null 2>&1; then
  echo "==> 添加 upstream remote：$UPSTREAM_URL"
  git remote add "$UPSTREAM_REMOTE" "$UPSTREAM_URL"
fi

echo "==> 拉取 $UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
git fetch --no-tags "$UPSTREAM_REMOTE" "$UPSTREAM_BRANCH"

UPSTREAM_HEAD="$(git rev-parse "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH")"
echo "    上游 HEAD：$(git rev-parse --short "$UPSTREAM_HEAD")"

if git merge-base --is-ancestor "$UPSTREAM_HEAD" HEAD; then
  echo "==> 已经包含上游最新提交，无需合并"
else
  echo "==> 合并上游"
  git merge --no-commit --no-ff "$UPSTREAM_HEAD" || true

  CONFLICTS="$(git diff --name-only --diff-filter=U || true)"
  if [ -n "$CONFLICTS" ]; then
    echo "==> 冲突文件（取上游版本，随后重新套用改名）"
    printf '%s\n' "$CONFLICTS" | sed 's/^/      /'
    for f in $CONFLICTS; do
      git checkout --theirs -- "$f" 2>/dev/null \
        || git checkout "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" -- "$f"
      git add -- "$f"
    done
    for p in "${PROTECTED_FILES[@]}"; do
      if printf '%s\n' "$CONFLICTS" | grep -qx -- "$p"; then
        echo "      [注意] $p 同时被上游修改：保留本 fork 版本，请人工确认" >&2
        git checkout HEAD -- "$p" 2>/dev/null || true
        git add -- "$p" 2>/dev/null || true
      fi
    done
  fi
fi

echo "==> 重新套用 @wjingshan 改名"
python3 scripts/apply-fork-rename.py

git add -A
if git diff --cached --quiet; then
  echo "==> 无改动需要提交"
else
  git commit --no-verify -m "chore(sync): merge upstream ${UPSTREAM_BRANCH} ($(git rev-parse --short "$UPSTREAM_HEAD")) and reapply @wjingshan rename"
  echo "==> 已提交合并结果"
fi
