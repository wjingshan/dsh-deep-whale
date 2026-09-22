#!/usr/bin/env python3
"""Semantic QC for the generated maid sprites (WJ edition).

`build-maid-left-state-art.py` can only prove *mechanical* things about a render:
that the border is a flat green screen, how much of it keyed out, and that the
crop ended up 1400 px tall. It cannot tell whether the model actually drew the
outfit that was asked for, whether the whale tail survived the costume change,
or whether an arm came out with six fingers. Those are exactly the failures this
pipeline hits, and they are invisible to both the keying stats and the test
suite (a data URL is a string; the tests only assert that the right string is
selected for the right state).

So this script reads the pixels back with a vision model on the same DashScope
account the renders came from and asks a fixed checklist, ending in a JSON
verdict line the caller can parse:

    python scripts/review-maid-art.py <image> [<image> ...] [--ask "..."]
    python scripts/review-maid-art.py --expect yukata dsh-image-gen/yukata-*.png

Exit code is 1 when any image loses the character's identity, misses the expected
outfit, hides the whale tail, crops the body, or is flagged `artifacts: severe`.
`--require-green` additionally demands a flat green screen, which only the raw
renders have — the committed sprites are transparent WebP.

Key: `DASHSCOPE_API_KEY`, read from the environment or from `~/.dsh/.env`.
"""
from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ENDPOINT = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
# `qwen-vl-max-latest` answers 403 AccessDenied on this account; the pinned
# aliases in this list are the ones the key is actually entitled to.
DEFAULT_MODEL = "qwen-vl-max"
WORKING_MODELS = ("qwen-vl-max", "qwen-vl-plus")
DEFAULT_ENV_FILE = Path.home() / ".dsh" / ".env"

# The character's identity anchors. Anything that loses one of these is a
# different character, which is the main risk when the edit model is asked to
# re-dress her.
IDENTITY = (
    "深蓝长卷发、发梢为浅蓝渐变；鲸鱼鳍头饰；白色蕾丝头饰；鲸鱼尾；蓝色大眼睛；赛璐璐上色"
)

# Outfit -> what the render must actually show. Kept as the *visible* description
# rather than the prompt, so a model that agrees with itself does not pass.
OUTFITS = {
    "swim": "分体深蓝蕾丝比基尼 + 半透明白纱笼裙（大面积裸露的皮肤）",
    "winter": "毛领深蓝大衣 + 白色围裙（鲸鱼徽章）+ 白荷叶边裙 + 深蓝毛边雪地靴（全身裹住）",
    "yukata": "深蓝浴衣（和服，交叠前襟、宽大袖口）+ 腰带/obi 打结 + 木屐（不是大衣、不是比基尼）",
}

CHECKLIST = """你是这个项目的立绘质检员。只根据图片回答，不要客套，不要臆测。
请逐条回答：
1) 背景是不是均匀的纯绿色幕布（#00FF00 附近）？有没有渐变、阴影、地面、边框、其他物体？
2) 角色身份是否保持：{identity}？逐项确认，指出哪一项不符。
3) 鲸鱼尾是否完整可见、没有被衣服遮住？
4) 她穿的到底是什么？逐件描述上装/下装/腰带/鞋/配饰，并明确判断它是否属于「{outfit}」。
5) 姿势与表情是什么？手里拿着什么道具？
6) 有没有明显画崩：多余或缺损的肢体/手指、脸崩、比例失调、衣服与身体穿插、文字水印？
7) 全身是否完整（头顶到脚都在画面里），有没有被裁掉？

最后输出一行 JSON（不要放在代码块里）：
{{"green_screen":true/false,"identity_ok":true/false,"outfit_ok":true/false,"tail_visible":true/false,"full_body":true/false,"artifacts":"none|minor|severe","confidence":"high|medium|low","summary":"一句话"}}"""


def read_key(explicit: Path | None) -> str:
    key = os.environ.get("DASHSCOPE_API_KEY", "").strip()
    if key:
        return key
    env_file = explicit or DEFAULT_ENV_FILE
    if env_file.is_file():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            match = re.match(r"\s*DASHSCOPE_API_KEY\s*=\s*(.+?)\s*$", line)
            if match:
                return match.group(1).strip().strip('"').strip("'")
    raise SystemExit(
        "DASHSCOPE_API_KEY is not set and was not found in "
        f"{env_file}; export it or pass --env-file"
    )


def data_url(path: Path) -> str:
    media = mimetypes.guess_type(path.name)[0] or "image/png"
    return f"data:{media};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"


def ask(key: str, model: str, image: Path, prompt: str, timeout: float) -> str:
    body = json.dumps(
        {
            "model": model,
            "input": {
                "messages": [
                    {"role": "user", "content": [{"image": data_url(image)}, {"text": prompt}]}
                ]
            },
            "parameters": {},
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        ENDPOINT,
        data=body,
        headers={"content-type": "application/json", "authorization": f"Bearer {key}"},
        method="POST",
    )
    # DashScope returns the model's text inside output.choices[0].message.content
    # as a list of parts; the same shape the image routes use for their URL.
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:600].replace(key, "<key>")
        raise SystemExit(f"{image.name}: DashScope returned HTTP {error.code}: {detail}")
    except urllib.error.URLError as error:
        raise SystemExit(f"{image.name}: cannot reach DashScope ({error.reason})")
    parts = payload.get("output", {}).get("choices", [{}])[0].get("message", {}).get("content", [])
    text = "\n".join(part["text"] for part in parts if isinstance(part, dict) and "text" in part)
    if not text:
        raise SystemExit(f"{image.name}: no text in response: {json.dumps(payload)[:600]}")
    return text


def verdict(text: str) -> dict | None:
    """Pull the trailing JSON object out of the model's answer."""
    for match in reversed(list(re.finditer(r"\{[^{}]*\}", text))):
        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict) and "outfit_ok" in parsed:
            return parsed
    return None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("images", nargs="+", type=Path)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--env-file", type=Path, default=None)
    parser.add_argument("--timeout", type=float, default=180.0)
    parser.add_argument("--ask", default=None, help="replace the checklist prompt entirely")
    parser.add_argument(
        "--require",
        default=None,
        help=(
            "comma-separated verdict keys that must be true (default: the checklist's set, "
            "or none when --ask replaces the checklist with a prompt that may not ask for them)"
        ),
    )
    parser.add_argument(
        "--require-green",
        action="store_true",
        help="also require a flat green screen (raw renders only; the committed sprites are transparent)",
    )
    parser.add_argument(
        "--expect",
        default=None,
        choices=sorted(OUTFITS),
        help="require this outfit; exit non-zero when a render disagrees",
    )
    args = parser.parse_args()

    # The model answers in Chinese; a cp936 console mangles it into mojibake that
    # is easy to misread as a failure.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    key = read_key(args.env_file)
    prompt = args.ask or CHECKLIST.format(
        identity=IDENTITY, outfit=OUTFITS[args.expect or "yukata"]
    )

    if args.require is None:
        # A custom prompt may not ask for every key; requiring an absent one would
        # report a failure the model was never given the chance to answer.
        required = [] if args.ask else ["identity_ok", "outfit_ok", "tail_visible", "full_body"]
    else:
        required = [key.strip() for key in args.require.split(",") if key.strip()]
    if args.require_green:
        required.insert(0, "green_screen")

    failures: list[str] = []
    for image in args.images:
        if not image.is_file():
            failures.append(f"{image}: missing")
            print(f"=== {image} === MISSING")
            continue
        print(f"=== {image.name} ===")
        text = ask(key, args.model, image, prompt, args.timeout)
        print(text)
        found = verdict(text)
        if found is None:
            failures.append(f"{image.name}: no parseable verdict")
            print("-> no parseable verdict\n")
            continue
        bad = [flag for flag in required if found.get(flag) is not True]
        if found.get("artifacts") == "severe":
            bad.append("artifacts=severe")
        print(f"-> {'OK' if not bad else 'FAIL: ' + ', '.join(bad)} ({found.get('confidence')})\n")
        if bad:
            failures.append(f"{image.name}: {', '.join(bad)}")

    if failures:
        print("FAILED:")
        for line in failures:
            print(f"  - {line}")
        sys.exit(1)
    print("all renders passed")


if __name__ == "__main__":
    main()
