#!/usr/bin/env python3
"""Build the left-maid *work-state* sprite sets (WJ edition).

Three outfits ship for the left maid, each with five work states:

  swim   — 分体泳装（默认造型），以 assets/maid-atelier-maid-left-v5.webp 为身份参考重绘
  winter — 冬日洋装，与右女仆内置的 winter 立绘同套；以该立绘（铺上绿幕）为参考
  yukata — 夏日祭浴衣；以 winter 待机态（铺上绿幕）为参考换装成浴衣，再以该浴衣待机态
           为参考换四个姿势

Every render comes out of the image-edit model on a flat green chroma-key screen
(see assets/maid-atelier-maid-left-{swim,winter}-*-v1.webp). The screen is very
uniform (border std ~1.5/255), so keying is done in green-dominance space rather
than by connectivity: a border-connected flood leaves the background *pockets*
enclosed by hair strands behind (they are the same colour as the screen), while
dominance catches them all and still keeps interior greens (a lime garnish on
the serving tray) nearly opaque.

Pipeline per render:
  1. sample the screen colour and its green dominance D_bg from the frame edge;
  2. key in green-dominance space with a dead zone around D_bg: the flat backdrop
     lands on alpha 0 exactly (a plain ratio leaves a 2-5% haze from jpeg noise),
     mixed edge pixels keep a proportional ramp;
  3. de-matte the mixed pixels (P - (1 - a) * screen) / a to remove the green
     cast from hair strands instead of leaving a fringe;
  4. crop to the figure and normalise every state to the same pixel height, so
     `height: N%` in the skin CSS renders all five at the same body scale;
  5. write WebP with alpha and emit src/client/left-state-art.generated.ts.

The `--prep-green` mode flattens an existing transparent sprite onto the same
green screen, which is how the winter *and* yukata references were produced (the
right maid's bundled winter portrait, then the winter sprite itself) before
feeding them to the edit model.

Run:
  python scripts/build-maid-left-state-art.py [--set swim|winter|yukata|all] [--sheet out.png]
  python scripts/build-maid-left-state-art.py --prep-green in.webp out.png

Semantic QC lives in `scripts/review-maid-art.py`: the keying stats below prove
the *background* is right but say nothing about whether the model drew the outfit
it was asked for, so every new set should be reviewed there before wiring.
"""
from __future__ import annotations

import argparse
import base64
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

REPO = Path(__file__).resolve().parent.parent
OUT_DIR = REPO / "maid-atelier" / "assets"
MODULE = REPO / "maid-atelier" / "src" / "client" / "left-state-art.generated.ts"

# The green screen the edit model is asked for; --prep-green uses the same colour.
SCREEN_COLOUR = (0, 255, 0)

# set -> state -> (source file name, output file name, exported constant)
SOURCES = {
    "swim": {
        "idle": ("image-9f1c2def.png", "maid-atelier-maid-left-swim-idle-v1.webp", "MAID_ATELIER_LEFT_SWIM_IDLE"),
        "think": ("image-8b52f7f7.png", "maid-atelier-maid-left-swim-think-v1.webp", "MAID_ATELIER_LEFT_SWIM_THINK"),
        "tool": ("image-827c5d5a.png", "maid-atelier-maid-left-swim-tool-v1.webp", "MAID_ATELIER_LEFT_SWIM_TOOL"),
        "write": ("image-944b78fa.png", "maid-atelier-maid-left-swim-write-v1.webp", "MAID_ATELIER_LEFT_SWIM_WRITE"),
        "error": ("image-e46b1b2a.png", "maid-atelier-maid-left-swim-error-v1.webp", "MAID_ATELIER_LEFT_SWIM_ERROR"),
    },
    "winter": {
        "idle": ("winter-idle.png", "maid-atelier-maid-left-winter-idle-v1.webp", "MAID_ATELIER_LEFT_WINTER_IDLE"),
        "think": ("winter-think.png", "maid-atelier-maid-left-winter-think-v1.webp", "MAID_ATELIER_LEFT_WINTER_THINK"),
        "tool": ("winter-tool.png", "maid-atelier-maid-left-winter-tool-v1.webp", "MAID_ATELIER_LEFT_WINTER_TOOL"),
        "write": ("winter-write.png", "maid-atelier-maid-left-winter-write-v1.webp", "MAID_ATELIER_LEFT_WINTER_WRITE"),
        "error": ("winter-error.png", "maid-atelier-maid-left-winter-error-v1.webp", "MAID_ATELIER_LEFT_WINTER_ERROR"),
    },
    "yukata": {
        "idle": ("yukata-idle.png", "maid-atelier-maid-left-yukata-idle-v1.webp", "MAID_ATELIER_LEFT_YUKATA_IDLE"),
        "think": ("yukata-think.png", "maid-atelier-maid-left-yukata-think-v1.webp", "MAID_ATELIER_LEFT_YUKATA_THINK"),
        "tool": ("yukata-tool.png", "maid-atelier-maid-left-yukata-tool-v1.webp", "MAID_ATELIER_LEFT_YUKATA_TOOL"),
        "write": ("yukata-write.png", "maid-atelier-maid-left-yukata-write-v1.webp", "MAID_ATELIER_LEFT_YUKATA_WRITE"),
        "error": ("yukata-error.png", "maid-atelier-maid-left-yukata-error-v1.webp", "MAID_ATELIER_LEFT_YUKATA_ERROR"),
    },
}
DEFAULT_SRC = Path(r"H:\DeepSeek-Harness-Plugin\dsh-image-gen")

# Prompt template used for every state (DashScope qwen-image-3.0 image edit):
#
#   swim, from assets/maid-atelier-maid-left-v5.webp as the identity reference:
#   "Keep this exact anime character: same face, blue eyes, long wavy deep-blue
#    hair with light-blue gradient tips, whale-fin headdress, whale tail, white
#    lace headpiece, same cel-shaded style and line weight, identical full-body
#    framing head-to-toe, same scale. Replace the maid dress with a sexy
#    two-piece deep navy bikini with white lace trim, thin straps, a small gold
#    anchor charm and lace-edged bottoms with tiny hip bows, plus a thin
#    translucent pearl-white pareo tied low on the hips; pearl shell hair
#    ornaments, barefoot with gold anklets, whale tail uncovered.
#    BACKGROUND: one flat uniform pure green #00FF00 chroma screen, no gradient,
#    no shadow on the background, no floor, no frame.
#    <STATE> : idle  = calm smile, hand on hip, other hand waving
#              think = head tilted, finger on chin, eyes up, arm folded
#              tool  = leaning in, holding a round silver tray with a drink
#              write = winking, big smile, peace sign, sparkles
#              error = startled, tiny pupils, sweat drop, both hands up"
#
#   winter, from the same frame with the right maid's bundled winter portrait as
#   the outfit reference (--prep-green output):
#   "Keep everything identical to the reference image: the same anime character,
#    face, hair, whale-fin headdress, whale tail, white lace headpiece, the same
#    deep navy winter coat with white fur trim, the same white apron with the
#    whale emblem, the same white-frilled skirt and navy fur-topped boots, the
#    same cel-shaded style and full-body framing at the same scale, and the same
#    flat uniform pure green #00FF00 chroma-key background.
#    Change ONLY the pose and expression to the <STATE> state: …"
#
#   yukata, in two passes. Pass 1 dresses the *winter* idle state (prepped onto
#   green) in the yukata and settles the idle pose; pass 2 feeds that yukata idle
#   back in and asks for pose/expression only, so the outfit is settled once and
#   the four remaining states cannot drift out of it:
#   "Keep everything about this anime character identical: … the same full-body
#    head-to-toe framing at exactly the same scale and position, and the same flat
#    uniform pure green #00FF00 chroma-key background … Replace ONLY her clothing
#    with a Japanese summer festival yukata: a deep navy cotton yukata with a
#    subtle light-blue whale-and-wave print, white lace trim along the collar and
#    the hem, and a soft gold obi sash tied at the front in a neat bow with a thin
#    gold cord. The yukata is left open at the lower front so her whale tail stays
#    fully visible and uncovered. White tabi socks with navy-strapped wooden geta
#    sandals, a small gold whale-tail hairpin, keeping the white lace headpiece
#    and pearl shell ornaments. Change the prop: instead of a mug of hot cocoa she
#    holds a small round paper fan (uchiwa) printed with a whale."
#   (pass 2) "Change ONLY the pose and expression to: …", with the pose wording
#   identical to the other two outfits so a given state reads the same way
#   whichever outfit she wears.


TARGET_HEIGHT = 1400          # px; displayed at <= ~96% of a ~800 px chat column
KEY_HIGH = 0.86               # green dominance >= 86% of the screen -> fully clear
KEY_LOW = 0.30                # <= 30% of the screen -> fully opaque (keeps the lime garnish)
MIN_ALPHA = 0.15              # de-matte floor (avoids dividing a clear pixel)


def screen_sample(rgb: np.ndarray) -> tuple[np.ndarray, float]:
    """Screen colour + its green dominance, read off the frame edge."""
    edge = np.concatenate(
        [
            rgb[0:3].reshape(-1, rgb.shape[-1]),
            rgb[-3:].reshape(-1, rgb.shape[-1]),
            rgb[:, 0:3].reshape(-1, rgb.shape[-1]),
            rgb[:, -3:].reshape(-1, rgb.shape[-1]),
        ]
    ).astype(np.float64)
    colour = np.median(edge, axis=0)
    dominance = float(colour[1] - max(colour[0], colour[2]))
    return colour, dominance


def build(source: Path) -> tuple[Image.Image, dict]:
    rgb = np.asarray(Image.open(source).convert("RGB")).astype(np.uint8)
    h, w = rgb.shape[:2]
    screen, dominance = screen_sample(rgb)
    if dominance < 40:
        raise SystemExit(f"{source.name}: frame edge is not a green screen ({screen.round(0).tolist()})")

    work = rgb.astype(np.float64)
    green = work[..., 1] - np.maximum(work[..., 0], work[..., 2])
    # A dead zone around the measured screen dominance: the flat backdrop lands on
    # alpha 0 exactly (a plain ratio leaves a 2-5% haze from jpeg noise), while the
    # partly-transparent hair-strand pixels keep a proportional ramp.
    high = KEY_HIGH * dominance
    low = KEY_LOW * dominance
    alpha = np.clip((high - green) / (high - low), 0.0, 1.0)

    # De-matte: P = a * C + (1 - a) * screen  ->  C = (P - (1 - a) * screen) / a
    mixed = (alpha > 0.001) & (alpha < 0.999)
    safe = np.maximum(alpha, MIN_ALPHA)[..., None]
    unmixed = (work - (1.0 - safe) * screen) / safe
    work = np.where(mixed[..., None], unmixed, work)
    work = np.clip(work, 0, 255)

    sprite = Image.fromarray(work.astype(np.uint8), "RGB")
    sprite.putalpha(Image.fromarray((alpha * 255).round().astype(np.uint8), "L"))

    box = sprite.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    if box is None:
        raise SystemExit(f"{source.name}: the whole frame keyed out — bad chroma screen")
    sprite = sprite.crop(box)

    scale = TARGET_HEIGHT / sprite.height
    sprite = sprite.resize((max(1, round(sprite.width * scale)), TARGET_HEIGHT), Image.LANCZOS)

    stats = {
        "source": source.name,
        "source_size": (w, h),
        "screen": screen.round(0).astype(int).tolist(),
        "clear_pct": round(100.0 * (alpha < 0.02).mean(), 1),
        "mixed_pct": round(100.0 * mixed.mean(), 2),
        "crop": box,
        "out_size": sprite.size,
    }
    return sprite, stats


def contact_sheet(sprites: dict[str, Image.Image], path: Path, cell: int = 420) -> None:
    sheet = Image.new("RGB", (cell * len(sprites), cell), (24, 26, 32))
    draw = ImageDraw.Draw(sheet)
    for column, (state, sprite) in enumerate(sprites.items()):
        thumb = sprite.copy()
        thumb.thumbnail((cell - 16, cell - 40), Image.LANCZOS)
        sheet.paste(thumb, (column * cell + 8, cell - 32 - thumb.height), thumb)
        draw.text((column * cell + 10, cell - 24), state, fill=(240, 240, 240))
    sheet.save(path)
    print(f"contact sheet -> {path}")


def prep_green(source: Path, target: Path) -> None:
    """Flatten a transparent sprite onto the edit model's green screen.

    The winter set is derived from the right maid's bundled portrait, which is
    already a transparent WebP; the edit model needs an opaque green backdrop, so
    the alpha is composited over exactly the screen colour the pipeline keys out.
    """
    sprite = Image.open(source).convert("RGBA")
    screen = Image.new("RGBA", sprite.size, SCREEN_COLOUR + (255,))
    screen.alpha_composite(sprite)
    screen.convert("RGB").save(target, "PNG")
    print(f"green screen -> {target} ({sprite.width}x{sprite.height}, {screen.size[0]}x{screen.size[1]})")


def emit_module(data_urls: dict[str, dict[str, str]], sets: list[str]) -> None:
    """Write the committed art module (same shape as the other generated ones)."""
    lines = [
        "/**",
        " * Generated left-maid work-state layers (WJ edition outfits).",
        " * Rebuild from the committed WebP assets:",
        " *   python scripts/build-maid-left-state-art.py",
        " */",
    ]
    for name in sets:
        for state, (_, _, constant) in SOURCES[name].items():
            lines.append(f"export const {constant} = '{data_urls[name][state]}'")
    MODULE.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"module -> {MODULE} ({MODULE.stat().st_size / 1024:.0f} KB)")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--src", type=Path, default=DEFAULT_SRC)
    parser.add_argument("--set", default="all", choices=[*SOURCES, "all"], help="which outfit set to build")
    parser.add_argument("--sheet", type=Path, default=None)
    parser.add_argument("--prep-green", nargs=2, metavar=("IN", "OUT"), help="flatten a sprite onto the green screen and exit")
    parser.add_argument("--no-module", action="store_true", help="skip left-state-art.generated.ts")
    args = parser.parse_args()

    if args.prep_green:
        prep_green(Path(args.prep_green[0]), Path(args.prep_green[1]))
        return

    sets = list(SOURCES) if args.set == "all" else [args.set]
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    data_urls: dict[str, dict[str, str]] = {}
    for name in sets:
        sprites: dict[str, Image.Image] = {}
        data_urls[name] = {}
        print(f"--- {name} ---")
        for state, (source_name, out_name, _) in SOURCES[name].items():
            sprite, stats = build(args.src / source_name)
            target = OUT_DIR / out_name
            sprite.save(target, "WEBP", quality=82, method=6)
            sprites[state] = sprite
            data_urls[name][state] = "data:image/webp;base64," + base64.b64encode(target.read_bytes()).decode("ascii")
            print(
                f"{state:5s} {stats['source']} {stats['source_size'][0]}x{stats['source_size'][1]}"
                f" screen={stats['screen']} clear={stats['clear_pct']}% mixed={stats['mixed_pct']}%"
                f" crop={stats['crop']} out={sprite.width}x{sprite.height}"
                f" {target.stat().st_size / 1024:.0f} KB"
            )
        if args.sheet:
            contact_sheet(sprites, args.sheet.with_name(f"{args.sheet.stem}-{name}{args.sheet.suffix}"))
    if not args.no_module:
        emit_module(data_urls, sets)
    total = sum(len(url) for group in data_urls.values() for url in group.values())
    print(f"embedded data URLs {total / 1024 / 1024:.2f} MB (base64 of {sum(len(g) for g in data_urls.values())} sprites)")


if __name__ == "__main__":
    main()
