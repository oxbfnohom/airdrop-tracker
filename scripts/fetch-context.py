"""Fetch konteks halaman pakai Scrapling (identitas Chrome asli).

Dipanggil dari Node (enrich/fact-check) sebagai fallback kalau fetch biasa
kena block. Output ke stdout persis format yang dipake app:
TITLE: ...
DESC: ...
PAGE_TEXT: ...
Gagal = print "ERROR: ..." + exit 1.
"""
import sys

def main() -> int:
    if len(sys.argv) < 2:
        print("ERROR: pakai: fetch-context.py <url>")
        return 1
    url = sys.argv[1]
    try:
        from scrapling.fetchers import Fetcher
        page = Fetcher.get(
            url,
            impersonate="chrome",
            stealthy_headers=True,
            timeout=20,
        )
    except Exception as e:  # gagal koneksi/timeout/library
        print(f"ERROR: {type(e).__name__}: {e}")
        return 1

    if page.status >= 400:
        print(f"ERROR: HTTP {page.status}")
        return 1

    try:
        title = page.css_first("title::text") or ""
        desc = (
            page.css_first("meta[name='description']::attr(content)") or ""
        )
        if not desc:
            desc = page.css_first("meta[property='og:description']::attr(content)") or ""
    except Exception:
        title, desc = "", ""

    try:
        text = page.get_all_text() or ""
    except Exception:
        text = ""
    text = " ".join(text.split())[:3000]

    print(f"TITLE: {title.strip()[:300]}")
    print(f"DESC: {desc.strip()[:500]}")
    print(f"PAGE_TEXT: {text}")
    return 0


if __name__ == "__main__":
    sys.exit(main())