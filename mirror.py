#!/usr/bin/env python3
"""
Mirror pipeline for 9111bayave.com (Squarespace static site).

For each captured page (captures/<slug>/page.html), this:
  1. Parses the rendered HTML.
  2. Collects every referenced asset URL (css, js, img src/srcset, source, background-image,
     fonts, favicon, inline @font-face url()).
  3. Downloads each asset into site/assets/<host>/<path...> (directory structure preserved so
     relative url() inside CSS resolves). Query strings collapse to a short hash suffix.
  4. Recursively processes downloaded CSS for url(...) and @import.
  5. Rewrites all absolute URLs in the HTML + CSS to local /assets/... paths.
  6. Writes site/<slug>/index.html  (home -> site/index.html).

Usage: python3 mirror.py <slug> <url>
       python3 mirror.py --all   (process every captures/* using urls.txt mapping)
"""
import os, sys, re, ssl, hashlib, urllib.request, urllib.parse, json

ROOT = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(ROOT, 'site')
ASSETS = os.path.join(SITE, 'assets')
CAPTURES = os.path.join(ROOT, 'captures')

CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

ORIGIN_HOSTS = ('9111bayave.com', 'www.9111bayave.com')
# Hosts whose assets we localize:
ASSET_HOSTS = (
    'images.squarespace-cdn.com', 'static1.squarespace.com', 'assets.squarespace.com',
    'use.typekit.net', 'p.typekit.net', 'fonts.googleapis.com', 'fonts.gstatic.com',
    'definitions.sqspcdn.com', 'static.squarespace.com',
)
# Third-party hosts we keep external (do not localize):
KEEP_EXTERNAL = ('weatherwidget.io', 'forecast7.com', 'google-analytics.com',
                 'googletagmanager.com', 'google.com', 'gstatic.com/recaptcha')

_downloaded = {}  # url -> local abs path (or None if failed)
_failed = {}

def log(*a):
    print(*a, flush=True)

def fetch_bytes(url):
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': '*/*',
        'Referer': 'https://www.9111bayave.com/',
    })
    with urllib.request.urlopen(req, context=CTX, timeout=60) as r:
        return r.read(), r.headers.get('Content-Type', '')

def guess_ext(url, content_type):
    path = urllib.parse.urlparse(url).path
    ext = os.path.splitext(path)[1].lower()
    if ext:
        return ext
    ct = (content_type or '').lower()
    table = {
        'css': '.css', 'javascript': '.js', 'json': '.json',
        'woff2': '.woff2', 'woff': '.woff', 'ttf': '.ttf', 'otf': '.otf',
        'opentype': '.otf', 'png': '.png', 'jpeg': '.jpg', 'jpg': '.jpg',
        'gif': '.gif', 'svg': '.svg', 'webp': '.webp', 'ico': '.ico',
    }
    for k, v in table.items():
        if k in ct:
            return v
    return ''

def local_path_for(url, content_type=''):
    """Map a remote URL to a local file path under ASSETS, preserving host+path."""
    p = urllib.parse.urlparse(url)
    host = p.hostname or 'misc'
    path = p.path
    if not path or path.endswith('/'):
        path = path + 'index'
    # filesystem-safe
    rel = path.lstrip('/')
    ext = guess_ext(url, content_type)
    base, cur_ext = os.path.splitext(rel)
    if not cur_ext and ext:
        rel = base + ext
    # incorporate query as short hash to disambiguate
    if p.query:
        h = hashlib.md5(p.query.encode()).hexdigest()[:8]
        b, e = os.path.splitext(rel)
        rel = f"{b}__{h}{e}"
    # cap any single path segment to a safe length (filesystem limit ~255)
    segs = rel.split('/')
    capped = []
    for s in segs:
        if len(s) > 100:
            b, e = os.path.splitext(s)
            hh = hashlib.md5(s.encode()).hexdigest()[:10]
            s = b[:60] + '__' + hh + e
        capped.append(s)
    rel = '/'.join(capped)
    return os.path.join(ASSETS, host, rel)

def local_url_for(url, content_type=''):
    lp = local_path_for(url, content_type)
    rel = os.path.relpath(lp, SITE)
    return '/' + rel.replace(os.sep, '/')

def should_localize(url):
    p = urllib.parse.urlparse(url)
    host = (p.hostname or '')
    if any(host == h or host.endswith('.' + h) for h in ORIGIN_HOSTS):
        return False  # same-domain page links handled separately
    for ke in KEEP_EXTERNAL:
        if ke in (host + p.path):
            return False
    return any(host == h or host.endswith('.' + h) for h in ASSET_HOSTS)

def download(url, content_type_hint=''):
    if url in _downloaded:
        return _downloaded[url]
    try:
        data, ct = fetch_bytes(url)
    except Exception as e:
        log('  FAIL download', url[:90], str(e)[:60])
        _downloaded[url] = None
        _failed[url] = str(e)[:80]
        return None
    lp = local_path_for(url, ct or content_type_hint)
    os.makedirs(os.path.dirname(lp), exist_ok=True)
    with open(lp, 'wb') as f:
        f.write(data)
    _downloaded[url] = lp
    # process CSS recursively
    if lp.endswith('.css') or 'css' in (ct or '').lower():
        process_css_file(lp, url)
    return lp

CSS_URL_RE = re.compile(r'url\(\s*([\'"]?)([^\'")]+)\1\s*\)')
CSS_IMPORT_RE = re.compile(r'@import\s+(?:url\()?\s*([\'"])([^\'"]+)\1')

def process_css_file(path, base_url):
    try:
        with open(path, 'r', encoding='utf-8', errors='ignore') as f:
            css = f.read()
    except Exception:
        return
    changed = False
    def repl_url(m):
        nonlocal changed
        raw = m.group(2).strip()
        if raw.startswith('data:') or raw.startswith('#'):
            return m.group(0)
        absu = urllib.parse.urljoin(base_url, raw)
        if should_localize(absu):
            lp = download(absu)
            if lp:
                changed = True
                # relative path from this css file to target
                rel = os.path.relpath(lp, os.path.dirname(path))
                return f'url({rel.replace(os.sep, "/")})'
        return m.group(0)
    def repl_import(m):
        nonlocal changed
        raw = m.group(2).strip()
        absu = urllib.parse.urljoin(base_url, raw)
        if should_localize(absu):
            lp = download(absu)
            if lp:
                changed = True
                rel = os.path.relpath(lp, os.path.dirname(path))
                return f'@import "{rel.replace(os.sep, "/")}"'
        return m.group(0)
    new = CSS_IMPORT_RE.sub(repl_import, css)
    new = CSS_URL_RE.sub(repl_url, new)
    if changed or new != css:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(new)

def rewrite_html(html, page_url):
    """Rewrite asset + internal-page URLs in HTML to local paths."""
    # 1) inline <style> @font-face / url() -> download + rewrite to absolute /assets path
    def repl_style_block(m):
        block = m.group(0)
        def ru(mm):
            raw = mm.group(2).strip()
            if raw.startswith('data:') or raw.startswith('#'):
                return mm.group(0)
            absu = urllib.parse.urljoin(page_url, raw)
            if should_localize(absu):
                lp = download(absu)
                if lp:
                    return f'url({local_url_for_existing(absu)})'
            return mm.group(0)
        return CSS_URL_RE.sub(ru, block)
    html = re.sub(r'<style[^>]*>.*?</style>', repl_style_block, html, flags=re.DOTALL)

    # 2) attributes: src, href, srcset, data-src, data-image, content (og:image), poster
    # generic absolute URL replacement for asset hosts
    def repl_attr(m):
        attr = m.group(1)
        quote = m.group(2)
        val = m.group(3)
        absu = urllib.parse.urljoin(page_url, val)
        if should_localize(absu):
            lp = download(absu)
            if lp:
                return f'{attr}={quote}{local_url_for_existing(absu)}{quote}'
        return m.group(0)
    # match attr="...host..." for the asset hosts
    host_alt = '|'.join(re.escape(h) for h in ASSET_HOSTS)
    attr_re = re.compile(r'(src|href|data-src|data-image|data-load-src|poster|content)=("|\')((?:https?:)?//(?:' + host_alt + r')[^"\']*)\2')
    html = attr_re.sub(repl_attr, html)

    # 3) srcset attributes (comma-separated)
    def repl_srcset(m):
        attr = m.group(1); quote = m.group(2); val = m.group(3)
        parts = []
        for piece in val.split(','):
            piece = piece.strip()
            if not piece:
                continue
            bits = piece.split()
            u = bits[0]
            absu = urllib.parse.urljoin(page_url, u)
            if should_localize(absu):
                lp = download(absu)
                if lp:
                    bits[0] = local_url_for_existing(absu)
            parts.append(' '.join(bits))
        return f'{attr}={quote}' + ', '.join(parts) + f'{quote}'
    srcset_re = re.compile(r'(srcset|data-srcset)=("|\')([^"\']*)\2')
    html = srcset_re.sub(repl_srcset, html)

    return html

def local_url_for_existing(url):
    """Return the /assets path for an already-downloaded URL (uses its saved local path)."""
    lp = _downloaded.get(url)
    if lp:
        rel = os.path.relpath(lp, SITE)
        return '/' + rel.replace(os.sep, '/')
    return local_url_for(url)

def rewrite_internal_links(html):
    """Squarespace internal page links are root-relative (/beach etc). With trailingSlash
    folder structure they already work. Normalize /home -> / for the homepage link."""
    html = html.replace('href="https://www.9111bayave.com/"', 'href="/"')
    html = html.replace('href="https://www.9111bayave.com', 'href="')
    html = html.replace('href="http://www.9111bayave.com', 'href="')
    html = re.sub(r'href="/home"', 'href="/"', html)
    return html

def process_page(slug, url):
    cap_dir = os.path.join(CAPTURES, slug)
    html_path = os.path.join(cap_dir, 'page.html')
    if not os.path.exists(html_path):
        log('  no page.html for', slug)
        return
    with open(html_path, 'r', encoding='utf-8', errors='ignore') as f:
        html = f.read()
    log('Processing', slug, '...')
    html = rewrite_html(html, url)
    html = rewrite_internal_links(html)
    # output
    if slug == 'home':
        out_dir = SITE
    else:
        out_dir = os.path.join(SITE, slug)
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, 'index.html'), 'w', encoding='utf-8') as f:
        f.write(html)
    log('  wrote', os.path.relpath(os.path.join(out_dir, 'index.html'), ROOT))

def slug_for(url):
    p = urllib.parse.urlparse(url).path.strip('/')
    return p if p else 'home'

def main():
    os.makedirs(ASSETS, exist_ok=True)
    if len(sys.argv) >= 2 and sys.argv[1] == '--all':
        urls = [l.strip() for l in open(os.path.join(ROOT, 'urls.txt')) if l.strip() and not l.startswith('#')]
        for u in urls:
            process_page(slug_for(u), u)
    else:
        slug, url = sys.argv[1], sys.argv[2]
        process_page(slug, url)
    # save failure log
    with open(os.path.join(ROOT, 'download_failures.json'), 'w') as f:
        json.dump(_failed, f, indent=1)
    log('\nDownloaded assets:', len([v for v in _downloaded.values() if v]),
        'Failed:', len(_failed))

if __name__ == '__main__':
    main()
