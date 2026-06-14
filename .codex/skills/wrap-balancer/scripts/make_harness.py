#!/usr/bin/env python3
"""
make_harness.py — build a deterministic before/after rendering harness for
evaluating wrap-balancer on Korean (or any) text.

Why this exists
---------------
To judge whether balancing actually *improved* a title we need to render the
EXACT same text, at the EXACT same width and font, twice: once with the
browser's greedy default wrapping ("before") and once balanced ("after").
Doing that by hand is fiddly and easy to get subtly wrong (different width,
different font, fonts not loaded yet). This script stamps out a hermetic
harness so every evaluation is apples-to-apples.

It writes, into the output dir:
  - before.html   single page, plain greedy wrapping (the control)
  - after.html    single page, balanced via wrap-balancer (the treatment)
  - compare.html  side-by-side (before | balanced-JS | balanced-native) for humans
  - wrap-balancer.min.js   copied next to the pages so rendering needs no network
  - harness.config.json    the resolved config (for the record / re-runs)

Both before.html and after.html set <html data-ready="1"> only after web fonts
have loaded and (for after.html) balancing has settled, so a screenshot step
can wait on that attribute instead of guessing with a sleep.

The "after" page forces the JS binary-search path (preferNative=false) on
purpose: it makes the balanced result deterministic and identical across
browsers/CI, instead of depending on whether the screenshot browser happens to
support native CSS `text-wrap: balance`. Production integration uses the
default (native-or-JS); compare.html shows the native column too for honesty.

Usage
-----
  python3 make_harness.py --config harness.config.json --out ./harness_out
  python3 make_harness.py --title "모든 화면 크기에서 더 읽기 좋은 제목" \
      --title "복잡한 데이터를 한눈에 보여주는 대시보드" \
      --width 360 --font-size 28 --line-height 1.35 --out ./harness_out

Config JSON shape (all keys optional except titles):
  {
    "titles":     ["..."],                  # one or more strings, REQUIRED
    "widths":     [360],                     # container px widths; matrix per title
    "fontFamily": "\"Apple SD Gothic Neo\", \"Noto Sans KR\", system-ui, sans-serif",
    "fontSize":   28,                        # px
    "fontWeight": 700,
    "lineHeight": 1.35,
    "ratio":      1,                         # wrap-balancer ratio (0..1)
    "lang":       "ko",
    "keepAll":    true,                      # Korean: word-break:keep-all (+overflow-wrap:anywhere)
    "note":       ""                         # free context shown in compare.html
  }
"""

import argparse
import html
import json
import os
import shutil
import sys

SELF_DIR = os.path.dirname(os.path.abspath(__file__))
SKILL_DIR = os.path.dirname(SELF_DIR)
BUNDLED_MIN_JS = os.path.join(SKILL_DIR, "assets", "wrap-balancer.min.js")

DEFAULTS = {
    "titles": [],
    "widths": [360],
    "fontFamily": '"Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif',
    "fontSize": 28,
    "fontWeight": 700,
    "lineHeight": 1.35,
    "ratio": 1,
    "lang": "ko",
    "keepAll": True,
    "note": "",
}

# Readiness beacon: only flips <html data-ready> after fonts load (+ balancing
# settles on the "after" page). A screenshot step should wait for [data-ready].
READY_AFTER = """
  (function () {
    function mark() { document.documentElement.setAttribute('data-ready', '1'); }
    function afterFonts() {
      // wrap-balancer auto-inits on DOMContentLoaded and rebalances on
      // fonts.ready; give it two frames to finish writing max-width, then mark.
      requestAnimationFrame(function () { requestAnimationFrame(mark); });
    }
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(afterFonts);
    } else {
      window.addEventListener('load', afterFonts);
    }
  })();
"""

READY_BEFORE = """
  (function () {
    function mark() { document.documentElement.setAttribute('data-ready', '1'); }
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        requestAnimationFrame(function () { requestAnimationFrame(mark); });
      });
    } else {
      window.addEventListener('load', mark);
    }
  })();
"""


def esc(s):
    return html.escape(str(s), quote=True)


def title_word_break(keep_all):
    # Korean recipe: keep 어절 (words) whole, but still break a single token that
    # is wider than the container so it can never overflow.
    if keep_all:
        return "word-break: keep-all; overflow-wrap: anywhere;"
    return "word-break: normal; overflow-wrap: normal;"


def base_css(cfg):
    return f"""
    * {{ box-sizing: border-box; }}
    html, body {{ margin: 0; padding: 0; background: #ffffff; }}
    body {{
      font-family: {cfg['fontFamily']};
      color: #111827;
      padding: 32px;
      -webkit-font-smoothing: antialiased;
    }}
    .grid {{ display: flex; flex-direction: column; gap: 28px; align-items: flex-start; }}
    .group {{ display: flex; flex-direction: column; gap: 10px; }}
    .group > .row {{ display: flex; gap: 24px; flex-wrap: wrap; align-items: flex-start; }}
    .caption {{
      font: 600 12px/1.4 system-ui, sans-serif;
      letter-spacing: .04em; text-transform: uppercase; color: #6b7280;
    }}
    .card {{
      border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px;
      background: #fafafa;
    }}
    .wbox {{ /* the measured container — exactly N px wide */ }}
    .title {{
      margin: 0;
      font-size: {cfg['fontSize']}px;
      font-weight: {cfg['fontWeight']};
      line-height: {cfg['lineHeight']};
      {title_word_break(cfg['keepAll'])}
    }}
    .meta {{ font: 12px/1.4 system-ui, sans-serif; color: #9ca3af; }}
    h2.page-title {{ font: 700 18px/1.3 system-ui, sans-serif; margin: 0 0 20px; color:#111827; }}
    """


def render_boxes(cfg, mode):
    """mode: 'plain' | 'js' | 'native'"""
    out = []
    for ti, title in enumerate(cfg["titles"]):
        rows = []
        for w in cfg["widths"]:
            attrs = ""
            if mode == "js":
                attrs = f' data-br-balance data-br-prefer-native="false" data-br-ratio="{cfg["ratio"]}"'
            elif mode == "native":
                attrs = f' data-br-balance data-br-ratio="{cfg["ratio"]}"'
            rows.append(
                f'<div class="card"><div class="wbox" style="width:{w}px">'
                f'<h1 class="title" lang="{esc(cfg["lang"])}"{attrs}>{esc(title)}</h1>'
                f'</div><div class="meta">{w}px</div></div>'
            )
        out.append(
            f'<div class="group"><div class="row">{"".join(rows)}</div></div>'
        )
    return "\n".join(out)


def page(cfg, *, mode, page_caption, ready_script, include_script):
    script_tag = (
        '<script src="./wrap-balancer.min.js"></script>' if include_script else ""
    )
    return f"""<!DOCTYPE html>
<html lang="{esc(cfg['lang'])}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>wrap-balancer harness · {esc(page_caption)}</title>
<style>{base_css(cfg)}</style>
</head>
<body>
<h2 class="page-title">{esc(page_caption)}</h2>
<div class="grid">
{render_boxes(cfg, mode)}
</div>
{script_tag}
<script>{ready_script}</script>
</body>
</html>
"""


def compare_page(cfg):
    cols = []
    for ti, title in enumerate(cfg["titles"]):
        before_boxes = []
        js_boxes = []
        native_boxes = []
        for w in cfg["widths"]:
            before_boxes.append(
                f'<div class="card"><div class="wbox" style="width:{w}px">'
                f'<h1 class="title" lang="{esc(cfg["lang"])}">{esc(title)}</h1>'
                f'</div><div class="meta">{w}px</div></div>'
            )
            js_boxes.append(
                f'<div class="card"><div class="wbox" style="width:{w}px">'
                f'<h1 class="title" lang="{esc(cfg["lang"])}" data-br-balance '
                f'data-br-prefer-native="false" data-br-ratio="{cfg["ratio"]}">{esc(title)}</h1>'
                f'</div><div class="meta">{w}px</div></div>'
            )
            native_boxes.append(
                f'<div class="card"><div class="wbox" style="width:{w}px">'
                f'<h1 class="title" lang="{esc(cfg["lang"])}" data-br-balance '
                f'data-br-ratio="{cfg["ratio"]}">{esc(title)}</h1>'
                f'</div><div class="meta">{w}px</div></div>'
            )
        cols.append(f"""
        <div class="group">
          <div class="caption">제목 {ti + 1}</div>
          <div class="row">
            <div class="group"><div class="caption">적용 전 (기본 줄바꿈)</div><div class="row">{"".join(before_boxes)}</div></div>
            <div class="group"><div class="caption">적용 후 (밸런싱 · JS)</div><div class="row">{"".join(js_boxes)}</div></div>
            <div class="group"><div class="caption">적용 후 (밸런싱 · 네이티브 우선)</div><div class="row">{"".join(native_boxes)}</div></div>
          </div>
        </div>""")
    note = (
        f'<p class="meta">{esc(cfg["note"])}</p>' if cfg.get("note") else ""
    )
    return f"""<!DOCTYPE html>
<html lang="{esc(cfg['lang'])}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>wrap-balancer harness · 비교</title>
<style>{base_css(cfg)}</style>
</head>
<body>
<h2 class="page-title">전 / 후 비교 · ratio={cfg['ratio']} · {cfg['fontSize']}px / {cfg['lineHeight']}</h2>
{note}
<div class="grid">
{"".join(cols)}
</div>
<script src="./wrap-balancer.min.js"></script>
<script>{READY_AFTER}</script>
</body>
</html>
"""


def load_config(args):
    cfg = dict(DEFAULTS)
    if args.config:
        with open(args.config, "r", encoding="utf-8") as f:
            cfg.update(json.load(f))
    # CLI overrides
    if args.title:
        cfg["titles"] = list(args.title)
    if args.width:
        cfg["widths"] = [int(w) for w in args.width.split(",") if w.strip()]
    if args.font is not None:
        cfg["fontFamily"] = args.font
    if args.font_size is not None:
        cfg["fontSize"] = args.font_size
    if args.font_weight is not None:
        cfg["fontWeight"] = args.font_weight
    if args.line_height is not None:
        cfg["lineHeight"] = args.line_height
    if args.ratio is not None:
        cfg["ratio"] = args.ratio
    if args.lang is not None:
        cfg["lang"] = args.lang
    if args.no_keep_all:
        cfg["keepAll"] = False
    if args.note is not None:
        cfg["note"] = args.note

    if not cfg["titles"]:
        sys.exit("error: at least one --title (or titles[] in --config) is required")
    if not cfg["widths"]:
        cfg["widths"] = [360]
    return cfg


def main():
    ap = argparse.ArgumentParser(description="Build a before/after wrap-balancer harness.")
    ap.add_argument("--config", help="path to a harness config JSON")
    ap.add_argument("--title", action="append", help="a title string (repeatable)")
    ap.add_argument("--width", help="container width(s) in px, comma-separated (e.g. 320,375)")
    ap.add_argument("--font", help="CSS font-family")
    ap.add_argument("--font-size", type=int)
    ap.add_argument("--font-weight", type=int)
    ap.add_argument("--line-height", type=float)
    ap.add_argument("--ratio", type=float)
    ap.add_argument("--lang", help="lang attribute (default ko)")
    ap.add_argument("--no-keep-all", action="store_true", help="disable Korean word-break:keep-all")
    ap.add_argument("--note", help="free context note shown in compare.html")
    ap.add_argument("--out", required=True, help="output directory")
    args = ap.parse_args()

    cfg = load_config(args)
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)

    # Copy the bundled library next to the pages so rendering is hermetic.
    if not os.path.exists(BUNDLED_MIN_JS):
        sys.exit(f"error: bundled library not found at {BUNDLED_MIN_JS}")
    shutil.copyfile(BUNDLED_MIN_JS, os.path.join(out, "wrap-balancer.min.js"))

    with open(os.path.join(out, "before.html"), "w", encoding="utf-8") as f:
        f.write(page(cfg, mode="plain", page_caption="적용 전 (기본 줄바꿈)",
                     ready_script=READY_BEFORE, include_script=False))
    with open(os.path.join(out, "after.html"), "w", encoding="utf-8") as f:
        f.write(page(cfg, mode="js", page_caption="적용 후 (wrap-balancer 밸런싱)",
                     ready_script=READY_AFTER, include_script=True))
    with open(os.path.join(out, "compare.html"), "w", encoding="utf-8") as f:
        f.write(compare_page(cfg))
    with open(os.path.join(out, "harness.config.json"), "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)

    print(json.dumps({
        "out": out,
        "before": os.path.join(out, "before.html"),
        "after": os.path.join(out, "after.html"),
        "compare": os.path.join(out, "compare.html"),
        "titles": len(cfg["titles"]),
        "widths": cfg["widths"],
        "ready_attr": "document.documentElement[data-ready]=='1'",
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
