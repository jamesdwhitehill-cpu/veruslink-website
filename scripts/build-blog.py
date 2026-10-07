#!/usr/bin/env python3
"""Render VerusLink's blog index from its checked-in post catalogue."""
import html
import json
from datetime import date
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parent.parent
BLOG = ROOT / "blog"
INDEX = BLOG / "index.html"
posts = json.loads((BLOG / "posts.json").read_text())
slugs = [p["slug"] for p in posts]
actual = {p.stem for p in BLOG.glob("*.html") if p.name != "index.html"}
if len(slugs) != len(set(slugs)) or set(slugs) != actual:
    raise SystemExit("posts.json and blog HTML files differ")
posts.sort(key=lambda p: (p["date"], p["slug"]), reverse=True)
pill = {"insight": ("Insight", "pill-insight"), "build": ("Build", "pill-build"), "client-story": ("Client Story", "pill-client"), "guide": ("Guide", "pill-guide")}
cards = []
for p in posts:
    label, cls = pill.get(p.get("category"), pill["insight"])
    day = date.fromisoformat(p["date"]).strftime("%-d %B %Y")
    read_time = f" &middot; {int(p['readTime'])} min read" if p.get("readTime") else ""
    cards.append(f'  <a class="blog-card" href="/blog/{html.escape(p["slug"])}">\n'
                 f'    <span class="pill {cls}">{label}</span>\n'
                 f'    <h2>{html.escape(p["title"])}</h2>\n'
                 f'    <p class="excerpt">{html.escape(p["excerpt"])}</p>\n'
                 f'    <div class="meta">{day}{read_time}</div>\n'
                 '  </a>')
source = INDEX.read_text()
source = re.sub(r'<main class="blog-grid" id="grid">.*?</main>',
                '<main class="blog-grid" id="grid">\n' + '\n'.join(cards) + '\n</main>', source, flags=re.S)
source = re.sub(r'<script>\s*\(function \(\) \{.*?\}\)\(\);\s*</script>\s*(?=</body>)', '', source, flags=re.S)
INDEX.write_text(source)

SITEMAP = ROOT / "sitemap.xml"
xml = SITEMAP.read_text()
def lastmod(match):
    url = match.group(1)
    path = url.split("veruslink.au/", 1)[-1]
    if not path or path == "blog":
        file = ROOT / ("blog/index.html" if path else "index.html")
    else:
        file = ROOT / path
        if not file.exists():
            file = ROOT / (path + ".html")
    if not file.exists():
        return match.group(0)
    rel = str(file.relative_to(ROOT))
    dirty = subprocess.run(["git", "status", "--porcelain", "--", rel], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    d = subprocess.run(["git", "log", "-1", "--format=%cs", "--", rel], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    if dirty or not d:
        d = date.today().isoformat()
    return match.group(0).replace(re.search(r"<lastmod>.*?</lastmod>", match.group(0)).group(0), f"<lastmod>{d}</lastmod>")
xml = re.sub(r"<url>\s*<loc>(.*?)</loc>.*?</url>", lastmod, xml, flags=re.S)
SITEMAP.write_text(xml)
print(f"rendered {len(posts)} crawlable blog links")
