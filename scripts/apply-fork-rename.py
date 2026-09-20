#!/usr/bin/env python3
"""把上游 Small-tailqwq 的 scope 重新改回本 fork 的 @wjingshan，并分离两套皮肤的身份。

上游每次发布都可能把包名写成 @smalltailqwq/*，而本 fork 使用 @wjingshan/*。
本脚本在每次合并上游之后运行，把改名规则重新施加一遍，因此合并时
不需要人工解决 scope 冲突。

除 scope 外，本脚本还完成「身份分离」，使本 fork 的两套皮肤能与上游包装在同一
profile 里而不互相顶掉——管理器按 id 与 wiringId 去重，重复条目会被直接丢弃
（skin-manager/src/index.ts：`if (ids.has(entry.id) || wiringIds.has(entry.wiringId)) continue`），
并且靠 bodyAttr 判断「当前激活的是哪套皮肤」
（skin-manager/src/client/index.ts：`catalog.find(skin => document.body.hasAttribute(skin.bodyAttr))`）。
因此 id / wiring.id / bodyAttr 三者必须同时与上游不同，缺一就会出现
「皮肤在列表里消失」「管理器认错激活皮肤」或「皮肤设旧属性、CSS 找新属性」。
注意 bodyAttr 在源码里是用 dataset 驼峰 API 设置的（body.dataset.dshMaidAtelier），
只改字面量会漏掉它。

**manager 不做身份分离**：本 fork 不再发行自己的 manager，用户安装上游已发布的那个
（`skin-manager/` 只作为皮肤编译所用的 protocol 源码与上游镜像保留，其 loader id
保持上游的 `ui-skin-deep-whale-manager`）。因此文档需要写出上游 manager 的真实包名，
而 scope 规则会改写该字面量——用哨兵先占位、最后还原。

规则分两层，**不要把它们合成一层**：
  * 全局规则（RULES / REGEX_RULES）：scope 改名、文档里的 id 用法。
  * 皮肤内规则（SKIN_RULES / SKIN_REGEX_RULES）：皮肤的身份值。它们只在 maid-atelier/ 与
    orca-link/ 下生效——manager 的源码与测试同样用 'maid-atelier' 表示合成 id、甚至表示
    临时目录名，全局替换会破坏上游自带的 manager 测试。

所有规则都必须可重复执行（本脚本每天在 CI 里跑）：带引号/冒号/方括号锚点的规则天然幂等，
而后缀式规则必须用 `(?!-wj)` / `(?!Wj)` 负向断言，否则第二遍会叠成 `-wj-wj`。

刻意不改的文件（版权与署名）：
  LICENSE / NOTICE / LICENSE-ARTWORK
刻意不改的内容：
  skin.json 的 author 字段（那是作者署名，不是包名）
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SELF = Path(__file__).resolve()

# 身份值规则的作用范围：只有这两个皮肤包需要身份分离。
SKIN_PREFIXES = ('maid-atelier/', 'orca-link/')

# 文档必须能写出上游 manager 的真实包名（用户要装它）。scope 规则会改写该字面量，
# 所以先换成哨兵、跑完全部规则后再还原。
UPSTREAM_MANAGER = '@smalltailqwq/dsh-client-ui-skin-deep-whale-manager'
UPSTREAM_MANAGER_SENTINEL = '@@UPSTREAM_MANAGER@@'

# ── 全局规则：顺序重要，先处理带斜杠的包名，再处理裸形式 ──
RULES: list[tuple[str, str]] = [
    ('@smalltailqwq/', '@wjingshan/'),
    ('@smalltailqwq', '@wjingshan'),
    ('Small-tailqwq/dsh-deep-whale', 'wjingshan/dsh-deep-whale'),
    ("owner: 'Small-tailqwq'", "owner: 'wjingshan'"),
]

# ── 皮肤内规则：身份三件套（id / wiring.id / bodyAttr）与显示名 ──
SKIN_RULES: list[tuple[str, str]] = [
    # 源码里硬编码的 id（skinId / SKIN_OWNER / data-skin-owner 标记）
    ("skinId: 'maid-atelier'", "skinId: 'maid-atelier-wj'"),
    ("skinId: 'orca-link'", "skinId: 'orca-link-wj'"),
    ("const SKIN_OWNER = 'maid-atelier'", "const SKIN_OWNER = 'maid-atelier-wj'"),
    ("const SKIN_OWNER = 'orca-link'", "const SKIN_OWNER = 'orca-link-wj'"),
    ("dataset.skinOwner = 'maid-atelier'", "dataset.skinOwner = 'maid-atelier-wj'"),
    ("dataset.skinOwner = 'orca-link'", "dataset.skinOwner = 'orca-link-wj'"),
    # 测试里对 id 值的断言与属性选择器（不是路径，也不是 CSS 文件/变量名）
    ("[data-skin-owner='maid-atelier']", "[data-skin-owner='maid-atelier-wj']"),
    ('[data-skin-owner="maid-atelier"]', '[data-skin-owner="maid-atelier-wj"]'),
    ("[data-skin-owner='orca-link']", "[data-skin-owner='orca-link-wj']"),
    ('[data-skin-owner="orca-link"]', '[data-skin-owner="orca-link-wj"]'),
    ("dataset.skinOwner).toBe('maid-atelier')", "dataset.skinOwner).toBe('maid-atelier-wj')"),
    ("dataset.skinOwner).toBe('orca-link')", "dataset.skinOwner).toBe('orca-link-wj')"),
    # skin.json 的 id：管理器 catalog 的主键
    ('"id": "maid-atelier"', '"id": "maid-atelier-wj"'),
    ('"id": "orca-link"', '"id": "orca-link-wj"'),
    # skin.json 的 wiring.id：JSON 形态（带引号），与 cordis.patch.yml 的 insert id 必须一致，
    # 否则管理器会按上游的 wiringId 去写/读 patch 行（漏掉它 = 冲突没消除）
    ('"id": "ui-skin-maid-atelier"', '"id": "ui-skin-maid-atelier-wj"'),
    ('"id": "ui-skin-orca-link"', '"id": "ui-skin-orca-link-wj"'),
    # 源码里的 effect 标签（冒号锚点）
    ("'ui-skin-maid-atelier:", "'ui-skin-maid-atelier-wj:"),
    ("'ui-skin-orca-link:", "'ui-skin-orca-link-wj:"),
    # 显示名加后缀：共存时管理器列表里两套同名会分不清
    ('"name": "深海女仆工坊"', '"name": "深海女仆工坊（WJ 改版）"'),
    ('"nameEn": "Abyssal Maid Atelier"', '"nameEn": "Abyssal Maid Atelier (WJ edition)"'),
    ('"name": "虎鲸链路"', '"name": "虎鲸链路（WJ 改版）"'),
    ('"nameEn": "ORCA LINK"', '"nameEn": "ORCA LINK (WJ edition)"'),
]

# ── 全局正则规则：需要负向断言才能幂等的串（是加后缀后字符串的前缀） ──
REGEX_RULES: list[tuple[str, str]] = [
    # cordis.patch.yml 的 insert id，以及文档里的 YAML 示例（不碰同行的 name: 包名）
    (r'id: ui-skin-maid-atelier(?!-wj)', 'id: ui-skin-maid-atelier-wj'),
    (r'id: ui-skin-orca-link(?!-wj)', 'id: ui-skin-orca-link-wj'),
    # 文档与脚本里的皮肤 id 用法
    (r'--target maid-atelier(?!-wj)', '--target maid-atelier-wj'),
    (r'--target orca-link(?!-wj)', '--target orca-link-wj'),
]

# ── 皮肤内正则规则：bodyAttr 的两种写法 ──
SKIN_REGEX_RULES: list[tuple[str, str]] = [
    # bodyAttr 字面量：皮肤 CSS 的 body 作用域
    (r'data-dsh-maid-atelier(?!-wj)', 'data-dsh-maid-atelier-wj'),
    (r'data-dsh-orca-link(?!-wj)', 'data-dsh-orca-link-wj'),
    # bodyAttr 的 dataset 驼峰写法（body.dataset.dshMaidAtelier = ''）。
    # 锚在 `dataset.` 上，以免误伤 window.__dshMaidAtelierArtwork（立绘全局变量）。
    (r'dataset\.dshMaidAtelier(?!Wj)', 'dataset.dshMaidAtelierWj'),
    (r'dataset\.dshOrcaLink(?!Wj)', 'dataset.dshOrcaLinkWj'),
]

SKIP_DIR_PARTS = {'.git', 'node_modules', 'dist', '.test-env'}
SKIP_FILE_NAMES = {'LICENSE', 'NOTICE', 'LICENSE-ARTWORK'}
# 二进制素材不必改名，缺失时也不该告警（read_text 本来也会跳过它们）。
BINARY_SUFFIXES = {'.webp', '.png', '.ico', '.jpg', '.jpeg', '.gif', '.map', '.woff', '.woff2'}

# 这几个文件描述“上游是谁”以及改名规则本身，绝不能被自己的规则改写：
# sync-upstream.sh 的 UPSTREAM_URL 一旦变成 fork，同步就退化为自己合并自己；
# 而改写正在被 bash 执行的脚本还会造成读取错位（CI 曾因此报 `-A: command not found`）。
# 比较时用 as_posix()：Windows 上 relative_to() 产出反斜杠，曾导致本脚本改写自身，
# 把整张规则表中和成自恒等（scope 改名随之整体失效）。
SKIP_PATHS = {
    'scripts/apply-fork-rename.py',
    'scripts/sync-upstream.sh',
    '.github/workflows/sync-upstream.yml',
}


def tracked_files() -> list[Path]:
    out = subprocess.run(
        ['git', 'ls-files'], cwd=ROOT, capture_output=True, text=True, check=True,
    ).stdout
    return [ROOT / line for line in out.splitlines() if line]


def main() -> int:
    original_self = SELF.read_text(encoding='utf-8')
    changed: list[str] = []
    missing: list[str] = []

    for path in tracked_files():
        if any(part in SKIP_DIR_PARTS for part in path.parts):
            continue
        if path.name in SKIP_FILE_NAMES:
            continue
        relative = path.relative_to(ROOT).as_posix()
        if relative in SKIP_PATHS:
            continue
        try:
            text = path.read_text(encoding='utf-8')
        except (UnicodeDecodeError, IsADirectoryError):
            continue
        except FileNotFoundError:
            # 稀疏/部分检出时 tracked 文件可能不在工作区。静默跳过会让改名出现
            # 看不见的缺口（曾导致皮肤设旧属性、CSS 找新属性），所以显式告警。
            if path.suffix.lower() not in BINARY_SUFFIXES:
                missing.append(relative)
            continue

        new = text.replace(UPSTREAM_MANAGER, UPSTREAM_MANAGER_SENTINEL)
        for old, repl in RULES:
            new = new.replace(old, repl)
        for pattern, repl in REGEX_RULES:
            new = re.sub(pattern, repl, new)
        if relative.startswith(SKIN_PREFIXES):
            for old, repl in SKIN_RULES:
                new = new.replace(old, repl)
            for pattern, repl in SKIN_REGEX_RULES:
                new = re.sub(pattern, repl, new)
        new = new.replace(UPSTREAM_MANAGER_SENTINEL, UPSTREAM_MANAGER)

        if new != text:
            path.write_text(new, encoding='utf-8')
            changed.append(relative)

    if missing:
        print(f'[警告] {len(missing)} 个 tracked 文件不在工作区，已跳过（改名可能不完整）：',
              file=sys.stderr)
        for name in missing[:10]:
            print(f'  {name}', file=sys.stderr)

    if SELF.read_text(encoding='utf-8') != original_self:
        print('[错误] 本脚本改写了自身：SKIP_PATHS 失效，规则会被中和。', file=sys.stderr)
        return 2

    if changed:
        print(f'重新套用 @wjingshan 改名与身份分离：{len(changed)} 个文件')
        for name in changed:
            print(f'  {name}')
    else:
        print('改名规则已是最新，无需改动。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
