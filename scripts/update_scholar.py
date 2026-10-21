#!/usr/bin/env python3
"""
Fetch citation numbers from a public Google Scholar profile and save them to
data/scholar.js, which the website reads.

GitHub runs this every week (see .github/workflows/update-profile-data.yml).
You can also run it yourself:

    pip install requests beautifulsoup4
    python scripts/update_scholar.py

The Scholar ID is read from the Google Scholar link in index.html
(".../citations?user=XXXXXXXXXXXX"). Set the SCHOLAR_ID environment variable
to override it.

If Google Scholar refuses the request (it sometimes blocks automated traffic),
the script leaves data/scholar.js as it was and exits without an error, so the
site keeps showing the last good numbers.
"""

import datetime
import json
import os
import random
import re
import sys
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "scholar.js"
URL = "https://scholar.google.com/citations"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}
PAGE = 100


def warn(msg):
    # Shows up as a yellow warning on the GitHub Actions run page.
    print(f"::warning::{msg}" if os.environ.get("GITHUB_ACTIONS") else f"Warning: {msg}")


def find_scholar_id():
    env = os.environ.get("SCHOLAR_ID", "").strip()
    if env:
        return env
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    for m in re.finditer(r"scholar\.google\.[a-z.]+/citations\?[^\"'\s<>]*?user=([\w-]+)", html):
        if len(m.group(1)) == 12:
            return m.group(1)
    return None


def to_int(text):
    digits = re.sub(r"[^\d]", "", text or "")
    return int(digits) if digits else 0


def fetch(session, scholar_id, cstart):
    params = {"user": scholar_id, "hl": "en", "cstart": cstart, "pagesize": PAGE}
    r = session.get(URL, params=params, headers=HEADERS, timeout=30)
    if r.status_code == 429:
        raise RuntimeError("Google Scholar is rate-limiting this runner (HTTP 429).")
    r.raise_for_status()
    return BeautifulSoup(r.text, "html.parser")


def parse_stats(soup):
    cells = soup.select("td.gsc_rsb_std")
    if len(cells) < 6:
        raise RuntimeError(
            "Couldn't find the citation table. Google Scholar may have shown a CAPTCHA, "
            "or the profile isn't public."
        )
    vals = [to_int(c.get_text()) for c in cells[:6]]
    return {
        "citations": vals[0],
        "citations_recent": vals[1],
        "h_index": vals[2],
        "i10_index": vals[4],
    }


def parse_cites_per_year(soup):
    years = [to_int(t.get_text()) for t in soup.select("span.gsc_g_t")]
    counts = [0] * len(years)
    # Each bar's z-index counts from the most recent year (1 = last year shown).
    for bar in soup.select("a.gsc_g_a"):
        m = re.search(r"z-index:\s*(\d+)", bar.get("style", ""))
        label = bar.select_one(".gsc_g_al")
        if m and label:
            i = int(m.group(1))
            if 1 <= i <= len(years):
                counts[-i] = to_int(label.get_text())
    return {str(y): c for y, c in zip(years, counts) if y}


def parse_publications(soup):
    pubs = []
    for row in soup.select("tr.gsc_a_tr"):
        a = row.select_one("a.gsc_a_at")
        if not a:
            continue
        href = (a.get("href") or "") + " " + (a.get("data-href") or "")
        m = re.search(r"citation_for_view=([\w-]+:[\w-]+)", href)
        cited = row.select_one(".gsc_a_ac")
        year = row.select_one(".gsc_a_h")
        pubs.append({
            "title": a.get_text(" ", strip=True),
            "year": to_int(year.get_text()) if year else None,
            "citations": to_int(cited.get_text()) if cited else 0,
            "id": m.group(1) if m else None,
        })
    return pubs


def main():
    scholar_id = find_scholar_id()
    if not scholar_id:
        warn(
            "No Google Scholar ID found. Put your profile link "
            "(https://scholar.google.com/citations?user=XXXXXXXXXXXX) in index.html."
        )
        return 0

    session = requests.Session()
    try:
        soup = fetch(session, scholar_id, 0)
        data = parse_stats(soup)
        name = soup.select_one("#gsc_prf_in")
        cites_per_year = parse_cites_per_year(soup)
        pubs = parse_publications(soup)
        cstart = 0
        while True:
            more = soup.select_one("#gsc_bpf_more")
            if len(soup.select("tr.gsc_a_tr")) < PAGE or not more or more.has_attr("disabled"):
                break
            cstart += PAGE
            time.sleep(random.uniform(3, 7))
            soup = fetch(session, scholar_id, cstart)
            pubs.extend(parse_publications(soup))
    except Exception as exc:  # network errors, CAPTCHA pages, markup changes
        warn(f"Couldn't update Google Scholar stats: {exc} Keeping the previous numbers.")
        return 0

    result = {
        "updated": datetime.date.today().isoformat(),
        "name": name.get_text(strip=True) if name else None,
        "profile": f"https://scholar.google.com/citations?user={scholar_id}",
        **data,
        "cites_per_year": cites_per_year,
        "publications": pubs,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        "// Written by scripts/update_scholar.py. You can also edit these numbers by hand.\n"
        "window.SCHOLAR_DATA = " + json.dumps(result, indent=2, ensure_ascii=False) + ";\n",
        encoding="utf-8",
    )
    print(
        f"Updated {OUT.relative_to(ROOT)}: {data['citations']} citations, "
        f"h-index {data['h_index']}, {len(pubs)} publications."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
