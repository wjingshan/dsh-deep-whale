#!/usr/bin/env python3
"""把上游 Small-tailqwq 的 scope 重新改回本 fork 的 @wjingshan。

上游每次发布都可能把包名写成 @smalltailqwq/*，而本 fork 使用 @wjingshan/*。
本脚本在每次合并上游之后运行，把改名规则重新施加一遍，因此合并时
不需要人工解决 scope 冲突。

刻意不改的文件（版权与署名）：
  LICENSE / NOTICE / LICENSE-ARTWORK
刻意不改的内容：
  skin.json 的 author 字段（那是作者署名，不是包名）
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# 顺序重要：先处理带斜杠的包名，再处理裸形式（含正则里被转义的 \/）
RULES: list[tuple[str, str]] = [
    ('@smalltailqwq/', '@wjingshan/'),
    ('@smalltailqwq', '@wjingshan'),
    ('Small-tailqwq/dsh-deep-whale', 'wjingshan/dsh-deep-whale'),
    ("owner: 'Small-tailqwq'", "owner: 'wjingshan'"),
]

SKIP_DIR_PARTS = {'.git', 'node_modules', 'dist', '.test-env'}
SKIP_FILE_NAMES = {'LICENSE', 'NOTICE', 'LICENSE-ARTWORK'}

# 这几个文件描述“上游是谁”以及改名规则本身，绝不能被自己的规则改写：
# sync-upstream.sh 的 UPSTREAM_URL 一旦变成 fork，同步就退化为自己合并自己；
# 而改写正在被 bash 执行的脚本还会造成读取错位（CI 曾因此报 `-A: command not found`）。
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
    changed: list[str] = []
    for path in tracked_files():
        if any(part in SKIP_DIR_PARTS for part in path.parts):
            continue
        if path.name in SKIP_FILE_NAMES:
            continue
        if str(path.relative_to(ROOT)) in SKIP_PATHS:
            continue
        try:
            text = path.read_text(encoding='utf-8')
        except (UnicodeDecodeError, IsADirectoryError, FileNotFoundError):
            continue
        new = text
        for old, repl in RULES:
            new = new.replace(old, repl)
        if new != text:
            path.write_text(new, encoding='utf-8')
            changed.append(str(path.relative_to(ROOT)))

    if changed:
        print(f'重新套用 @wjingshan 改名：{len(changed)} 个文件')
        for name in changed:
            print(f'  {name}')
    else:
        print('改名规则已是最新，无需改动。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
