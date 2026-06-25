# 9111bayave.com — static mirror clone

A high-fidelity static clone of **https://www.9111bayave.com/** (a Squarespace 7.1 vacation-rental
property guide for "9111 Bay Ave", North Beach, MD).

- **Live clone:** https://9111bayave-clone.vercel.app/
- **Source:** https://www.9111bayave.com/

## Approach

Raw-HTML **static mirror** of the JS-rendered pages:

1. Each page is loaded in headless Chromium (Playwright), fully rendered and scrolled, and the
   post-JS DOM is saved.
2. Every referenced asset (CSS, JS, images, fonts, favicon) is downloaded into
   `site/assets/<host>/<path>` (host directory structure preserved so relative `url()` inside CSS
   resolves), and all absolute URLs in the HTML/CSS are rewritten to local `/assets/...` paths.
3. Adobe **Typekit** and **Google Fonts** are self-hosted (Typekit blocks cross-origin by domain).
4. Squarespace's own client JS is kept, so client-side features render correctly — the mobile
   off-canvas **hamburger menu**, image rendering, and the embedded weather widget all work.
5. Third-party live embeds (weather widget, Matterport 3D tour, DocsBot chatbot) and analytics
   (GA `UA-40446179-2` / `G-92EN33TGPP`, GTM `GTM-P6NGPGR`) are kept pointing at their CDNs.

The clone is verified pixel-identical to the original at 1440px (desktop) and 390px (mobile).

## Pages (20 same-domain)

home, beach, before-you-arrive, check-in-and-out, connect-to-wifi, contact-us, elevator,
floor-plans, grocery-stores, house-guide, kitchen, restaurants, rooftop-deck, thermostats,
things-to-do, trash-days, tvs, wakefield-chatbot, what-is-included, cart.

`/home` also serves the homepage on the origin; the clone serves it at `/`.

## Repo layout

```
capture.js          Reusable capture engine: bounded/segmented screenshots (<=1500px longest side,
                    deviceScaleFactor=1, ignoreHTTPSErrors), page.html, styles.json, assets/fonts/
                    embeds/meta/links txt. EVERY screenshot is produced by this script.
batch_capture.js    Runs capture.js across every URL in urls.txt.
mirror.py           Download + URL-rewrite pipeline that builds site/ from captures/.
compare.js          Stitched full-page pixel-diff (clone vs saved originals).
compare_native.js   Native-resolution lockstep segment pixel-diff (authoritative measure).
audit.js            Loads every live clone page; logs >=400 responses + requestfailed events.
urls.txt            Deduplicated same-domain URL inventory.
links.txt           External links (recorded, not crawled).
captures/<slug>/    Per-page capture spec (page.html, screenshots, styles.json, *.txt).
site/               Deployable static mirror (one folder per page + shared assets/).
DISCREPANCIES.md    Final discrepancy table, manual-handling list, source-side issues.
```

## Build / deploy

```bash
npx playwright install chromium
node batch_capture.js            # capture all pages -> captures/
python3 mirror.py --all          # build site/ from captures/
cd site && npx vercel deploy --prod --yes --token "$VERCEL_TOKEN"
```

## Verify

```bash
node compare_native.js all       # native segment pixel-diff vs the live origin
node audit.js https://9111bayave-clone.vercel.app
```
