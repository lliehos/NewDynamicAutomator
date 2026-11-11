"""Build the Persian tutorial slide deck (16:9 PPTX) from script.json.

Runs on the bundled Python (python-pptx + Pillow). Persian typography uses the
Vazirmatn font family, which is added to the session font table before PowerPoint
exports the slides to PNG.

Usage:
    python make_slides.py            # writes build/slides.pptx + assets/shots/*.png
"""

from __future__ import annotations

import json
import math
import os
import sys
from PIL import Image, ImageDraw, ImageFilter

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE, MSO_CONNECTOR
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Emu, Inches, Pt
from pptx.oxml import parse_xml
from pptx.oxml.ns import nsdecls

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEO_DIR = os.path.dirname(HERE)
PROJECT = os.path.dirname(os.path.dirname(VIDEO_DIR))

FONT = "Vazirmatn"

INK = "1F2430"
INK_SOFT = "3A4352"
MUTED = "64748B"
TEAL = "0D9488"
TEAL_DARK = "0F766E"
TEAL_LIGHT = "5EEAD4"
MINT = "E8F9F0"
MINT_2 = "F1FBF7"
BORDER = "E3E8EF"
BG = "F7F7FB"
WHITE = "FFFFFF"
DARK = "0B1B2B"
DARK_2 = "102A3E"
AMBER = "B45309"
AMBER_BG = "FEF6E7"
RED = "C2413B"
INDIGO = "4F46E5"

W, H = 13.333, 7.5
MX = 0.85                      # content margin (left/right)
CW = W - 2 * MX                # content width


# ---------------------------------------------------------------- text helpers
def set_run_font(run, name=FONT, size=20, bold=False, color=INK, italic=False):
    f = run.font
    f.name = name
    f.size = Pt(size)
    f.bold = bold
    f.italic = italic
    f.color.rgb = RGBColor.from_string(color)
    rPr = run._r.get_or_add_rPr()
    latin = rPr.find(qn("a:latin"))
    cs = rPr.find(qn("a:cs"))
    if cs is None:
        cs = parse_xml(f'<a:cs {nsdecls("a")} typeface="{name}"/>')
        latin.addnext(cs)
    cs.set("typeface", name)


def text_lines(shape, lines, align=PP_ALIGN.RIGHT, anchor=MSO_ANCHOR.TOP):
    """lines: list of dicts {text,size,bold,color,after,line,font,align,alpha}"""
    tf = shape.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = anchor
    for i, ln in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = ln.get("align", align)
        p.line_spacing = ln.get("line", 1.22)
        p.space_after = Pt(ln.get("after", 0))
        p.space_before = Pt(ln.get("before", 0))
        p._p.get_or_add_pPr().set("rtl", "1")
        r = p.add_run()
        r.text = ln["text"]
        set_run_font(
            r,
            name=ln.get("font", FONT),
            size=ln["size"],
            bold=ln.get("bold", False),
            color=ln["color"],
        )
        if ln.get("alpha"):
            rPr = r._r.get_or_add_rPr()
            fill = rPr.find(qn("a:solidFill"))
            if fill is not None:
                clr = fill.find(qn("a:srgbClr"))
                alpha = parse_xml(f'<a:alpha {nsdecls("a")} val="{int(ln["alpha"] * 100000)}"/>')
                clr.append(alpha)
    return shape


def tb(slide, x, y, w, h, lines, align=PP_ALIGN.RIGHT, anchor=MSO_ANCHOR.TOP):
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    return text_lines(box, lines, align=align, anchor=anchor)


# --------------------------------------------------------------- shape helpers
def _no_shadow(shape):
    shape.shadow.inherit = False


def solid(shape, hex_fill, alpha=None, line=None, line_w=1.0, line_alpha=None):
    shape.fill.solid()
    shape.fill.fore_color.rgb = RGBColor.from_string(hex_fill)
    if alpha is not None:
        spPr = shape._element.spPr
        fill = spPr.find(qn("a:solidFill"))
        clr = fill.find(qn("a:srgbClr"))
        clr.append(parse_xml(f'<a:alpha {nsdecls("a")} val="{int(alpha * 100000)}"/>'))
    if line is None:
        shape.line.fill.background()
    else:
        shape.line.color.rgb = RGBColor.from_string(line)
        shape.line.width = Pt(line_w)
        if line_alpha is not None:
            ln = shape._element.spPr.find(qn("a:ln"))
            clr = ln.find(qn("a:solidFill")).find(qn("a:srgbClr"))
            clr.append(parse_xml(f'<a:alpha {nsdecls("a")} val="{int(line_alpha * 100000)}"/>'))
    _no_shadow(shape)
    return shape


def rect(slide, x, y, w, h, fill=WHITE, alpha=None, line=None, line_w=1.0,
         radius=None, line_alpha=None):
    kind = MSO_SHAPE.ROUNDED_RECTANGLE if radius else MSO_SHAPE.RECTANGLE
    sh = slide.shapes.add_shape(kind, Inches(x), Inches(y), Inches(w), Inches(h))
    if radius:
        sh.adjustments[0] = radius
    sh.text_frame.word_wrap = True
    return solid(sh, fill, alpha, line, line_w, line_alpha)


def oval(slide, x, y, w, h, fill=TEAL, alpha=None, line=None, line_w=2.0):
    sh = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(x), Inches(y), Inches(w), Inches(h))
    return solid(sh, fill, alpha, line, line_w)


def ring(slide, x, y, w, h, color=TEAL, alpha=0.26, line_w=2.0):
    """Circle outline with translucent stroke (decorative)."""
    sh = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(x), Inches(y), Inches(w), Inches(h))
    sh.fill.background()
    sh.line.color.rgb = RGBColor.from_string(color)
    sh.line.width = Pt(line_w)
    _no_shadow(sh)
    ln = sh._element.spPr.find(qn("a:ln"))
    clr = ln.find(qn("a:solidFill")).find(qn("a:srgbClr"))
    clr.append(parse_xml(f'<a:alpha {nsdecls("a")} val="{int(alpha * 100000)}"/>'))
    return sh


def soft_shadow(shape, blur=26, dist=6, alpha=0.14):
    spPr = shape._element.spPr
    old = spPr.find(qn("a:effectLst"))
    if old is not None:
        spPr.remove(old)
    effect = parse_xml(
        f'<a:effectLst {nsdecls("a")}><a:outerShdw blurRad="{int(blur * 12700)}" '
        f'dist="{int(dist * 12700)}" dir="5400000" algn="ctr" rotWithShape="0">'
        f'<a:srgbClr val="0B1B2B"><a:alpha val="{int(alpha * 100000)}"/></a:srgbClr>'
        f"</a:outerShdw></a:effectLst>"
    )
    spPr.append(effect)


def arrow(slide, x1, y1, x2, y2, color=TEAL, width=2.0, dashed=False):
    conn = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(x1), Inches(y1),
                                      Inches(x2), Inches(y2))
    conn.line.color.rgb = RGBColor.from_string(color)
    conn.line.width = Pt(width)
    ln = conn.line._get_or_add_ln()
    if dashed:
        ln.append(parse_xml(f'<a:prstDash {nsdecls("a")} val="dash"/>'))
    ln.append(parse_xml(f'<a:tailEnd {nsdecls("a")} type="triangle" w="med" len="med"/>'))
    return conn


def pic(slide, path, x, y, w=None, h=None):
    kw = {}
    if w:
        kw["width"] = Inches(w)
    if h:
        kw["height"] = Inches(h)
    return slide.shapes.add_picture(path, Inches(x), Inches(y), **kw)


# ------------------------------------------------------------- screenshot card
def shot_card(src, dst, target_w=1180, radius=20, bar=True):
    """Rounded browser-style card with a soft shadow baked in (transparent PNG)."""
    im = Image.open(src).convert("RGB")
    if im.width > target_w:
        im = im.resize((target_w, int(im.height * target_w / im.width)), Image.LANCZOS)

    top = 46 if bar else 0
    inner = im
    width = inner.width
    height = inner.height + top
    card = Image.new("RGB", (width, height), (255, 255, 255))
    card.paste(inner, (0, top))
    if bar:
        d = ImageDraw.Draw(card)
        d.rectangle([0, 0, width, top], fill="#EEF1F6")
        d.line([(0, top), (width, top)], fill="#E3E8EF", width=1)
        for i, c in enumerate(["#E88C86", "#EBC98A", "#94CFA9"]):
            cx = width - 26 - i * 22
            d.ellipse([cx - 6, top / 2 - 6, cx + 6, top / 2 + 6], fill=c)
        d.rounded_rectangle([18, top / 2 - 9, width - 110, top / 2 + 9], radius=9, fill="#FFFFFF")
        d.text((30, top / 2 - 6), "localhost:7201/Panel", fill="#9AA4B2")

    mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, width - 1, height - 1], radius=radius, fill=255)

    # shadow canvas
    pad = 46
    canvas = Image.new("RGBA", (width + pad * 2, height + pad * 2), (0, 0, 0, 0))
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle([pad, pad + 10, pad + width - 1, pad + height - 1],
                         radius=radius, fill=(11, 27, 43, 70))
    shadow = shadow.filter(ImageFilter.GaussianBlur(22))
    canvas.alpha_composite(shadow)

    body = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    body.paste(card, (0, 0))
    # 1px border through a slightly larger rounded rect
    bd = ImageDraw.Draw(body)
    bd.rounded_rectangle([0, 0, width - 1, height - 1], radius=radius,
                         outline=(214, 221, 230, 255), width=2)
    body.putalpha(mask)
    canvas.alpha_composite(body, (pad, pad))
    canvas.save(dst)
    return canvas.size


# ------------------------------------------------------------------ page chrome
def bg(slide, color=BG):
    rect(slide, 0, 0, W, H, fill=color)


def page_base(slide, beat, page, dark=False):
    if dark:
        bg(slide, DARK)
        return
    bg(slide, BG)
    # right-hand accent rail (RTL reading edge)
    rect(slide, W - 0.14, 0, 0.14, H, fill=TEAL, alpha=0.85)

    # footer
    tb(slide, MX, H - 0.62, 6.0, 0.3, [
        {"text": f"وباتومیتور  ·  {beat.get('section', '')}", "size": 11.5, "color": "94A3B8", "bold": True},
    ])
    tb(slide, W - MX - 1.2, H - 0.62, 1.2, 0.3, [
        {"text": persian_digits(f"{page:02d}"), "size": 11.5, "color": "94A3B8", "bold": True},
    ])


def persian_digits(s: str) -> str:
    table = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")
    return s.translate(table)


def header(slide, beat, kicker_color=TEAL, title_size=40, width=None):
    width = width or CW - 0.4
    if beat.get("kicker"):
        tb(slide, MX, 0.62, width, 0.35, [
            {"text": beat["kicker"], "size": 15, "bold": True, "color": kicker_color},
        ])
    tb(slide, MX, 0.98, width, 1.0, [
        {"text": beat["title"], "size": title_size, "bold": True, "color": INK, "line": 1.12},
    ])
    # short rule under the headline
    rect(slide, W - MX - 1.05, 1.95, 1.05, 0.055, fill=TEAL)


# --------------------------------------------------------------- slide builders
def slide_cover(prs, beat, page):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    bg(s, DARK)
    # decorative rings
    ring(s, -1.55, -2.25, 6.4, 6.4, color=TEAL, alpha=0.28)
    ring(s, -0.55, -1.25, 4.4, 4.4, color=TEAL, alpha=0.14)
    oval(s, 10.2, 4.6, 4.6, 4.6, fill=TEAL, alpha=0.07)

    tb(s, W - MX - 3.0, 0.62, 3.0, 0.4, [
        {"text": "وباتومیتور", "size": 15, "bold": True, "color": TEAL_LIGHT},
    ])

    tb(s, MX, 1.95, CW, 0.4, [
        {"text": beat.get("kicker", ""), "size": 17, "bold": True, "color": TEAL_LIGHT},
    ])
    tb(s, MX, 2.42, CW, 1.55, [
        {"text": beat["title"], "size": 80, "bold": True, "color": WHITE, "line": 1.0},
    ])
    tb(s, MX, 4.28, CW - 1.0, 1.0, [
        {"text": beat["subtitle"], "size": 26, "color": "C7D2DE", "line": 1.35},
    ])
    rect(s, W - MX - 0.9, 5.38, 0.9, 0.055, fill=TEAL)
    if beat.get("badge"):
        tb(s, MX, 5.58, CW, 0.4, [
            {"text": beat["badge"], "size": 15, "color": "7C8CA1"},
        ])
    return s


def slide_section(prs, beat, page):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    bg(s, DARK)
    # decorative: faint ring + rule on the open side
    ring(s, -1.1, 4.15, 3.4, 3.4, color=TEAL, alpha=0.16)
    rect(s, MX, 5.05, 2.6, 0.012, fill="2C4256")
    rect(s, W - 0.14, 0, 0.14, H, fill=TEAL)

    tb(s, MX, 2.35, CW - 0.6, 0.4, [
        {"text": beat.get("section", ""), "size": 16, "bold": True, "color": TEAL_LIGHT},
    ])
    tb(s, MX, 2.85, CW - 0.6, 1.3, [
        {"text": beat["title"], "size": 62, "bold": True, "color": WHITE, "line": 1.05},
    ])
    tb(s, MX, 4.22, CW - 0.6, 0.7, [
        {"text": beat.get("subtitle", ""), "size": 24, "color": "9FB0C3"},
    ])
    return s


def card_block(s, x, y, w, h, num, title, body, title_size=22, body_size=16):
    c = rect(s, x, y, w, h, fill=WHITE, line=BORDER, radius=0.06)
    soft_shadow(c, blur=22, dist=5, alpha=0.07)
    # number badge
    b = rect(s, x + w - 0.92, y + 0.34, 0.56, 0.56, fill=MINT, radius=0.5)
    text_lines(b, [{"text": num, "size": 19, "bold": True, "color": TEAL_DARK,
                    "align": PP_ALIGN.CENTER}], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    tb(s, x + 0.38, y + 1.02, w - 0.72, 0.72, [
        {"text": title, "size": title_size, "bold": True, "color": INK, "line": 1.2},
    ])
    tb(s, x + 0.38, y + 1.76, w - 0.7, h - 2.05, [
        {"text": body, "size": body_size, "color": MUTED, "line": 1.5},
    ])


def slide_points(prs, beat, page):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    page_base(s, beat, page)
    header(s, beat)
    cards = beat["cards"]
    gap = 0.34
    n = len(cards)
    cw = (CW - gap * (n - 1)) / n
    y = 2.34
    ch = 3.86
    for i, c in enumerate(cards):
        x = W - MX - cw - i * (cw + gap)
        card_block(s, x, y, cw, ch, c["num"], c["title"], c["body"])
    return s


def slide_steps(prs, beat, page):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    page_base(s, beat, page)
    header(s, beat)
    steps = beat["steps"]
    y0 = 2.38
    row_h = 1.06
    for i, st in enumerate(steps):
        y = y0 + i * row_h
        if i:
            rect(s, MX + 0.75, y - 0.13, CW - 0.9, 0.012, fill=BORDER)
        circ = rect(s, W - MX - 0.68, y + 0.12, 0.62, 0.62, fill=MINT, radius=0.5)
        text_lines(circ, [{"text": st["num"], "size": 22, "bold": True, "color": TEAL_DARK,
                           "align": PP_ALIGN.CENTER}], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
        tb(s, MX + 0.2, y + 0.10, CW - 1.15, 0.45, [
            {"text": st["title"], "size": 23, "bold": True, "color": INK},
        ])
        tb(s, MX + 1.6, y + 0.55, CW - 2.55, 0.4, [
            {"text": st["body"], "size": 17, "color": MUTED},
        ])
    return s


def slide_chips(prs, beat, page):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    page_base(s, beat, page)
    header(s, beat)

    chips = beat["chips"]
    per_row = 4
    cw, ch, gap = 2.72, 0.78, 0.3
    x_right = W - MX
    y = 2.55
    for i, label in enumerate(chips):
        r, c = divmod(i, per_row)
        x = x_right - cw - c * (cw + gap)
        ci = rect(s, x, y + r * (ch + 0.24), cw, ch, fill=WHITE, line="CFE9E3", radius=0.5)
        text_lines(ci, [{"text": label, "size": 17.5, "bold": True, "color": TEAL_DARK,
                         "align": PP_ALIGN.CENTER}], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)

    note = rect(s, MX, 5.55, CW, 1.15, fill=AMBER_BG, radius=0.05)
    rect(s, W - MX - 0.07, 5.55, 0.07, 1.15, fill=AMBER)
    tb(s, MX + 0.35, 5.62, CW - 0.75, 0.28, [
        {"text": "نکته", "size": 12.5, "bold": True, "color": AMBER},
    ])
    tb(s, MX + 0.35, 5.92, CW - 0.75, 0.7, [
        {"text": beat["note"], "size": 17, "color": "7C4A0B", "line": 1.45},
    ])
    return s


def slide_shot(prs, beat, page):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    page_base(s, beat, page)
    header(s, beat)

    img_path = os.path.join(VIDEO_DIR, "assets", "shots", f"{beat['id']}.png")
    src = os.path.join(PROJECT, beat["image"].replace("/", os.sep))
    if not os.path.exists(img_path):
        shot_card(src, img_path)

    PAD, BAR, RAD = 46, 46, 20
    total_w, total_h = Image.open(img_path).size
    inner_w, inner_h = total_w - 2 * PAD, total_h - 2 * PAD - BAR

    box_w = 5.95
    card_left, card_top = MX - 0.26, 2.0
    card_h = box_w * total_h / total_w
    pic(s, img_path, card_left, card_top, w=box_w)
    card_w = box_w

    def to_x(rx, rw=0.0):
        return card_left + card_w * (PAD + rx * inner_w) / total_w, card_w * rw * inner_w / total_w

    def to_y(ry, rh=0.0):
        return card_top + card_h * (PAD + BAR + ry * inner_h) / total_h, card_h * rh * inner_h / total_h

    # callouts: either a thin frame around a region, or a dot marker on a point
    for co in beat.get("callouts", []):
        if co.get("legend_only"):
            continue
        if "dot" in co:
            dx, dy = co["dot"]
            x, _ = to_x(dx)
            y, _ = to_y(dy)
            badge = rect(s, x - 0.17, y - 0.17, 0.34, 0.34, fill=TEAL, line=WHITE, line_w=1.5, radius=0.5)
            text_lines(badge, [{"text": co["n"], "size": 12, "bold": True, "color": WHITE,
                                "align": PP_ALIGN.CENTER}], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
            continue
        rx, ry, rw, rh = co["rect"]
        x, w = to_x(rx, rw)
        y, h = to_y(ry, rh)
        rect(s, x, y, w, h, fill=WHITE, alpha=0.001, line=TEAL, line_w=2.0, radius=0.03)
        where = co.get("badge_at", "tr")
        if "l" in where:
            bx = x + 0.04
        else:
            bx = x + w - 0.4
        bx = min(max(bx, card_left + 0.04), card_left + card_w - 0.42)
        if "b" in where:
            by = y + h - 0.4
        else:
            by = y - 0.19
        by = min(max(by, card_top + 0.04), card_top + card_h - 0.42)
        badge = rect(s, bx, by, 0.36, 0.36, fill=TEAL, radius=0.5)
        text_lines(badge, [{"text": co["n"], "size": 12.5, "bold": True, "color": WHITE,
                            "align": PP_ALIGN.CENTER}], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)

    # legend on the right
    lx = card_left + card_w + 0.3
    lw = W - MX - lx - 0.1
    ly = 2.06
    for co in beat.get("callouts", []):
        if co.get("legend_only"):
            dot = rect(s, lx + lw - 0.26, ly + 0.14, 0.12, 0.12, fill=TEAL, radius=0.5)
        else:
            b = rect(s, lx + lw - 0.4, ly + 0.02, 0.4, 0.4, fill=MINT, radius=0.5)
            text_lines(b, [{"text": co["n"], "size": 13, "bold": True, "color": TEAL_DARK,
                            "align": PP_ALIGN.CENTER}], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
        tb(s, lx, ly, lw - 0.52, 0.36, [
            {"text": co["label"], "size": 17.5, "bold": True, "color": INK},
        ])
        step = 0.62
        if co.get("text"):
            tb(s, lx, ly + 0.38, lw - 0.5, 0.62, [
                {"text": co["text"], "size": 13.5, "color": MUTED, "line": 1.4},
            ])
            step = 0.94
        ly += step
    return s


def slide_shapes(prs, beat, page):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    page_base(s, beat, page)
    header(s, beat)

    items = beat["shapes"]
    th = 3.1
    gap = 0.26
    tw = (CW - gap * (len(items) - 1)) / len(items)
    y = 2.5
    for i, it in enumerate(items):
        x = W - MX - tw - i * (tw + gap)
        tile = rect(s, x, y, tw, th, fill=WHITE, line=BORDER, radius=0.07)
        soft_shadow(tile, blur=18, dist=4, alpha=0.06)
        kind = it["kind"]
        cx = x + tw / 2
        if kind == "start":
            sh = rect(s, cx - 0.52, y + 0.62, 1.04, 0.6, fill=MINT, line=TEAL, line_w=1.5, radius=0.5)
        elif kind == "group":
            sh = rect(s, cx - 0.72, y + 0.52, 1.44, 0.8, fill="EEF2FF", line="6366F1", line_w=1.5, radius=0.12)
            rect(s, cx - 1.06, y + 0.74, 0.34, 0.34, fill="E0E7FF", line="6366F1", line_w=1.2, radius=0.2)
        elif kind == "cond":
            sh = s.shapes.add_shape(MSO_SHAPE.DIAMOND, Inches(cx - 0.62), Inches(y + 0.42),
                                    Inches(1.24), Inches(0.96))
            solid(sh, "FEF3C7", line="D97706", line_w=1.5)
        else:
            sh = rect(s, cx - 0.64, y + 0.6, 1.28, 0.64, fill="E6F4F1", line=TEAL, line_w=1.5, radius=0.1)
        tb(s, x + 0.2, y + 1.72, tw - 0.4, 0.4, [
            {"text": it["title"], "size": 21, "bold": True, "color": INK, "align": PP_ALIGN.CENTER},
        ], align=PP_ALIGN.CENTER)
        tb(s, x + 0.24, y + 2.12, tw - 0.48, 0.8, [
            {"text": it["body"], "size": 14.5, "color": MUTED, "line": 1.45, "align": PP_ALIGN.CENTER},
        ], align=PP_ALIGN.CENTER)
    return s


def slide_edges(prs, beat, page):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    page_base(s, beat, page)
    header(s, beat)

    colors = {"next": TEAL, "success": "15803D", "fail": RED}
    y = 2.36
    row_h = 1.16
    box_w, box_h = 2.25, 0.74
    for i, e in enumerate(beat["edges"]):
        row_y = y + i * row_h
        col = colors[e["kind"]]
        src = rect(s, W - MX - box_w, row_y, box_w, box_h, fill=WHITE, line=BORDER, radius=0.5)
        text_lines(src, [{"text": "نود مبدا", "size": 15, "color": MUTED, "align": PP_ALIGN.CENTER}],
                   align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
        dst = rect(s, MX, row_y, box_w, box_h, fill=WHITE, line=BORDER, radius=0.5)
        text_lines(dst, [{"text": "نود مقصد", "size": 15, "color": MUTED, "align": PP_ALIGN.CENTER}],
                   align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
        mid_y = row_y + box_h / 2
        arrow(s, W - MX - box_w - 0.06, mid_y, MX + box_w + 0.06, mid_y, color=col, width=3.0)
        pill_w = 2.5
        pill = rect(s, (MX + box_w + W - MX - box_w) / 2 - pill_w / 2, mid_y - 0.28, pill_w, 0.56,
                    fill=WHITE, line=col, line_w=1.5, radius=0.5)
        text_lines(pill, [{"text": e["title"], "size": 16, "bold": True, "color": col,
                           "align": PP_ALIGN.CENTER}], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
        tb(s, MX + box_w + 0.15, mid_y + 0.32, W - 2 * MX - 2 * box_w - 0.3, 0.34, [
            {"text": e["body"], "size": 14.5, "color": MUTED, "align": PP_ALIGN.CENTER},
        ], align=PP_ALIGN.CENTER)

    note = rect(s, MX, 6.02, CW, 0.76, fill=AMBER_BG, radius=0.05)
    rect(s, W - MX - 0.07, 6.02, 0.07, 0.76, fill=AMBER)
    tb(s, MX + 0.35, 6.08, CW - 0.7, 0.64, [
        {"text": beat["note"], "size": 16, "color": "7C4A0B", "line": 1.4},
    ], anchor=MSO_ANCHOR.MIDDLE)
    return s


def node_box(s, x, y, w, h, title, kind="action", sub=None):
    fills = {
        "start": (MINT, TEAL),
        "group": ("EEF2FF", "6366F1"),
        "cond": ("FEF3C7", "D97706"),
        "action": ("FFFFFF", BORDER),
        "end": ("F1F5F9", "94A3B8"),
    }
    fill, line = fills.get(kind, ("FFFFFF", BORDER))
    if kind == "cond":
        sh = s.shapes.add_shape(MSO_SHAPE.DIAMOND, Inches(x), Inches(y), Inches(w), Inches(h))
        solid(sh, fill, line=line, line_w=1.6)
    else:
        sh = rect(s, x, y, w, h, fill=fill, line=line, line_w=1.6, radius=0.5 if kind == "start" else 0.12)
    text_lines(sh, [{"text": title, "size": 14.5, "bold": True, "color": INK, "align": PP_ALIGN.CENTER}],
               align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    return sh


def slide_flow(prs, beat, page):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    page_base(s, beat, page)
    header(s, beat)

    bw, bh = 1.95, 0.8
    gap = 0.55
    y = 3.05
    x_start = W - MX - bw
    node_box(s, x_start, y, bw, bh, "شروع", "start")
    x2 = x_start - gap - bw
    node_box(s, x2, y, bw, bh, "اقدام ۱", "action")
    arrow(s, x_start - 0.05, y + bh / 2, x2 + bw + 0.05, y + bh / 2)

    dx, dy, dw, dh = 1.3, 0.78, 1.3, 0.78
    x3 = x2 - gap - dw
    node_box(s, x3, y + (bh - dh) / 2, dw, dh, "شرط", "cond")
    arrow(s, x2 - 0.05, y + bh / 2, x3 + dw + 0.05, y + bh / 2)

    bx, by, bws, bhs = MX + 2.55, 0.68, 2.1, 0.62
    node_box(s, bx, y - 1.05, bws, bhs, "موفق: اقدام ۲", "action")
    node_box(s, bx, y + 1.35, bws, bhs, "ناموفق: اقدام ۳", "action")
    arrow(s, x3 - 0.04, y + 0.38, bx + bws + 0.06, y - 0.78, color="15803D", width=2.0)
    arrow(s, x3 - 0.04, y + 0.42, bx + bws + 0.06, y + 1.62, color=RED, width=2.0)
    tb(s, bx + bws + 0.12, y - 0.86, 0.95, 0.3, [{"text": "موفق", "size": 11.5, "bold": True, "color": "15803D"}])
    tb(s, bx + bws + 0.12, y + 1.55, 0.95, 0.3, [{"text": "ناموفق", "size": 11.5, "bold": True, "color": RED}])

    note = rect(s, MX, 5.96, CW, 0.72, fill=MINT_2, radius=0.05)
    rect(s, W - MX - 0.07, 5.96, 0.07, 0.72, fill=TEAL)
    tb(s, MX + 0.35, 6.0, CW - 0.75, 0.64, [
        {"text": beat["note"], "size": 16, "color": TEAL_DARK, "line": 1.4},
    ], anchor=MSO_ANCHOR.MIDDLE)
    return s


def slide_pipeline(prs, beat, page):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    page_base(s, beat, page)
    header(s, beat)

    items = beat["pipeline"]
    n = len(items)
    gap = 0.62
    bw = (CW - gap * (n - 1)) / n
    bh = 1.95
    y = 2.85
    for i, it in enumerate(items):
        x = W - MX - bw - i * (bw + gap)
        tile = rect(s, x, y, bw, bh, fill=WHITE, line=BORDER, radius=0.08)
        soft_shadow(tile, blur=16, dist=4, alpha=0.07)
        rect(s, x, y, bw, 0.075, fill=TEAL if i < n - 1 else "94A3B8")
        num = rect(s, x + bw - 0.52, y + 0.26, 0.36, 0.36, fill=MINT, radius=0.5)
        text_lines(num, [{"text": persian_digits(str(i + 1)), "size": 13, "bold": True,
                          "color": TEAL_DARK, "align": PP_ALIGN.CENTER}],
                   align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
        tb(s, x + 0.2, y + 0.72, bw - 0.4, 0.5, [
            {"text": it["title"], "size": 18.5, "bold": True, "color": INK, "align": PP_ALIGN.CENTER},
        ], align=PP_ALIGN.CENTER)
        tb(s, x + 0.22, y + 1.22, bw - 0.44, 0.6, [
            {"text": it["body"], "size": 14, "color": MUTED, "line": 1.4, "align": PP_ALIGN.CENTER},
        ], align=PP_ALIGN.CENTER)
        if i < n - 1:
            arrow(s, x - 0.1, y + bh / 2, x - gap + 0.1, y + bh / 2, color=TEAL_LIGHT, width=2.5)

    note = rect(s, MX, 5.55, CW, 0.95, fill=AMBER_BG, radius=0.05)
    rect(s, W - MX - 0.07, 5.55, 0.07, 0.95, fill=AMBER)
    tb(s, MX + 0.35, 5.6, CW - 0.75, 0.85, [
        {"text": beat["note"], "size": 16.5, "color": "7C4A0B", "line": 1.4},
    ], anchor=MSO_ANCHOR.MIDDLE)
    return s


def slide_checklist(prs, beat, page):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    page_base(s, beat, page)
    header(s, beat)

    rows = beat["rows"]
    y = 2.3
    rh = 1.0
    gap = 0.1
    for i, r in enumerate(rows):
        row_y = y + i * (rh + gap)
        bgc = WHITE if i % 2 == 0 else "FBFCFE"
        rect(s, MX, row_y, CW, rh, fill=bgc, line=BORDER, radius=0.05)
        # divider between problem and solution columns
        rect(s, 7.85, row_y + 0.16, 0.012, rh - 0.32, fill=BORDER)
        # problem (right column): headline + small marker line in one flow
        tb(s, W - MX - 4.35, row_y + 0.16, 4.05, 0.86, [
            {"text": r["problem"], "size": 17.5, "bold": True, "color": RED, "after": 5},
            {"text": "پیام یا نشانه", "size": 11.5, "color": "A3AEBD"},
        ])
        # solution (left column): label + text in one flow
        tb(s, MX + 0.32, row_y + 0.12, 6.1, 0.9, [
            {"text": "راه‌حل", "size": 11.5, "bold": True, "color": TEAL, "after": 4},
            {"text": r["solution"], "size": 14.5, "color": INK_SOFT, "line": 1.4},
        ])
        # small chevron at the divider
        ch = s.shapes.add_shape(MSO_SHAPE.LEFT_ARROW, Inches(7.42), Inches(row_y + rh / 2 - 0.1),
                                Inches(0.36), Inches(0.2))
        solid(ch, TEAL_LIGHT)
    return s


def slide_recap(prs, beat, page):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    page_base(s, beat, page)
    header(s, beat)

    y = 2.42
    for i, item in enumerate(beat["items"]):
        row_y = y + i * 0.86
        num = rect(s, W - MX - 0.72, row_y, 0.6, 0.6, fill=MINT, radius=0.5)
        text_lines(num, [{"text": persian_digits(str(i + 1)), "size": 18, "bold": True,
                          "color": TEAL_DARK, "align": PP_ALIGN.CENTER}],
                   align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
        tb(s, MX + 0.4, row_y + 0.08, CW - 1.5, 0.5, [
            {"text": item, "size": 24, "bold": True, "color": INK},
        ])
    return s


def slide_end(prs, beat, page):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    bg(s, DARK)
    oval(s, 11.0, -1.9, 4.6, 4.6, fill=TEAL, alpha=0.08)
    rect(s, W - 0.14, 0, 0.14, H, fill=TEAL)

    tb(s, MX, 2.05, CW, 0.5, [
        {"text": "پایان ویدیو", "size": 17, "bold": True, "color": TEAL_LIGHT},
    ])
    tb(s, MX, 2.5, CW, 1.2, [
        {"text": beat["title"], "size": 76, "bold": True, "color": WHITE, "line": 1.05},
    ])
    tb(s, MX, 3.85, CW, 0.6, [
        {"text": beat.get("subtitle", ""), "size": 26, "color": "C7D2DE"},
    ])
    tb(s, MX, 4.85, CW, 0.4, [
        {"text": "مستندات پروژه:", "size": 14, "bold": True, "color": "7C8CA1"},
    ])
    x_right = W - MX
    for i, link in enumerate(beat.get("links", [])):
        w = 2.5
        x = x_right - (i + 1) * (w + 0.2) + 0.2
        chip = rect(s, x, 5.28, w, 0.56, fill=DARK_2, line="24455F", radius=0.4)
        text_lines(chip, [{"text": link, "size": 13, "color": "9FB0C3", "align": PP_ALIGN.CENTER}],
                   align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    return s


BUILDERS = {
    "cover": slide_cover,
    "section": slide_section,
    "points": slide_points,
    "steps": slide_steps,
    "chips": slide_chips,
    "shot": slide_shot,
    "shapes": slide_shapes,
    "edges": slide_edges,
    "flow": slide_flow,
    "pipeline": slide_pipeline,
    "checklist": slide_checklist,
    "recap": slide_recap,
    "end": slide_end,
}


def main():
    script_path = os.path.join(VIDEO_DIR, "script.json")
    data = json.load(open(script_path, encoding="utf-8"))
    prs = Presentation()
    prs.slide_width = Inches(W)
    prs.slide_height = Inches(H)

    os.makedirs(os.path.join(VIDEO_DIR, "assets", "shots"), exist_ok=True)
    for i, beat in enumerate(data["beats"], start=1):
        builder = BUILDERS[beat["kind"]]
        builder(prs, beat, i)
        print(f"{i:02d} {beat['id']:<22} {beat['kind']}")

    out = os.path.join(HERE, "slides.pptx")
    prs.save(out)
    print("saved", out, "slides:", len(prs.slides))


if __name__ == "__main__":
    main()
