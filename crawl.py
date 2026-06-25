import urllib.request, ssl, re
from urllib.parse import urljoin, urlparse

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
HOST = '9111bayave.com'
seen = set()
to_visit = ['https://www.9111bayave.com/']
# seed from sitemap + known nav
seeds = ['/home','/wakefield-chatbot','/beach','/before-you-arrive','/check-in-and-out',
'/connect-to-wifi','/contact-us','/floor-plans','/grocery-stores','/house-guide',
'/restaurants','/things-to-do']
for s in seeds:
    to_visit.append('https://www.9111bayave.com'+s)

internal = {}
external = set()
def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0'})
    with urllib.request.urlopen(req, context=ctx, timeout=30) as r:
        return r.read().decode('utf-8','ignore'), r.status

while to_visit:
    url = to_visit.pop(0)
    norm = url.split('#')[0].rstrip('/')
    if norm in seen: continue
    seen.add(norm)
    try:
        html, status = fetch(url)
    except Exception as e:
        internal[url] = 'ERR '+str(e)[:60]
        continue
    internal[url] = status
    for m in re.findall(r'href="([^"]+)"', html):
        if m.startswith('mailto:') or m.startswith('tel:') or m.startswith('#'): 
            continue
        absu = urljoin(url, m)
        p = urlparse(absu)
        if p.hostname and HOST in p.hostname:
            clean = absu.split('#')[0].split('?')[0]
            if clean.rstrip('/') not in seen and clean not in to_visit:
                to_visit.append(clean)
        elif p.scheme in ('http','https'):
            external.add(absu)

print('=== INTERNAL PAGES ===')
for k in sorted(internal): print(internal[k], k)
print('\n=== EXTERNAL (count) ===', len(external))
for e in sorted(external)[:40]: print(e)
