#!/usr/bin/env python3
"""Regenerate e2e/fixtures/*.pdf. Requires Google Chrome (headless print-to-pdf).
Usage: python3 scripts/make-fixtures.py"""
import os, struct, subprocess, zlib, tempfile, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "scripts/fixtures-src"; OUT = ROOT / "e2e/fixtures"
CHROME = os.environ.get("CHROME_PATH", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")

def write_png_rgba(path, w, h, pixel):
    raw = b"".join(b"\x00" + b"".join(bytes(pixel(x, y)) for x in range(w)) for y in range(h))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)

def line_art(x, y):  # transparent background, dark grid + diagonal strokes
    on = (x % 60 < 3) or (y % 60 < 3) or abs(x - y) < 3 or abs((400 - x) - y) < 3
    return (20, 20, 20, 255) if on else (0, 0, 0, 0)

def print_pdf(html, out):
    with tempfile.NamedTemporaryFile("w", suffix=".html", dir=SRC, delete=False) as f:
        f.write(html); tmp = f.name
    try:
        subprocess.run([CHROME, "--headless", "--disable-gpu", "--no-pdf-header-footer", f"--print-to-pdf={out}", "file://" + tmp],
                       check=True, stderr=subprocess.DEVNULL, stdout=subprocess.DEVNULL)
    finally:
        os.unlink(tmp)

PARA = " ".join(["The quick brown fox jumps over the lazy dog; sum x^2 = integral f(t) dt."] * 10)
VECTOR = """<svg width="600" height="120"><rect x="10" y="10" width="160" height="70" rx="8" fill="#e53935"/>
<rect x="220" y="10" width="160" height="70" rx="8" fill="#1e88e5"/><rect x="430" y="10" width="160" height="70" rx="8" fill="#43a047"/>
<path d="M170 45 L220 45 M380 45 L430 45" stroke="#333" stroke-width="3"/></svg>"""
PAGE = '<section style="page-break-after:always">{}</section>'
BODY = '<html><body style="font-family:Georgia,serif;margin:0;padding:0">{}</body></html>'

write_png_rgba(SRC / "lineart-transparent.png", 400, 400, line_art)
OUT.mkdir(parents=True, exist_ok=True)

mixed = [
    f"<h1>1. Vector diagram</h1><p>{PARA}</p>{VECTOR}<p>{PARA}</p>",
    f"<h1>2. Photo</h1><p>{PARA}</p><img id=photo src='photo.jpg' style='width:420px;height:420px;object-fit:cover'><p>{PARA}</p>",
    f"<h1>3. Raster diagram on white</h1><p>{PARA}</p><img src='diagram-white.png' style='width:600px'><p>{PARA}</p>",
    f"<h1>4. Transparent line art</h1><p>{PARA}</p><img src='lineart-transparent.png' style='width:400px'><p>{PARA}</p>",
]
print_pdf(BODY.format("".join(PAGE.format(p) for p in mixed)), OUT / "mixed.pdf")

scan = '<html><head><style>@page{size:letter;margin:0} body{margin:0} img{display:block;width:8.5in;height:11in;page-break-after:always}</style></head><body>' + \
       "<img src='scan-page.png'>" * 2 + "</body></html>"
print_pdf(scan, OUT / "scan.pdf")

long = "".join(PAGE.format(f"<h1>Chapter {i}</h1><p>{PARA}</p>{VECTOR}<p>{PARA}</p><p>{PARA}</p>") for i in range(1, 41))
print_pdf(BODY.format(long), OUT / "long.pdf")
print("ok")
