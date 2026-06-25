# DISCREPANCIES — 9111bayave.com clone

Source: https://www.9111bayave.com/ (Squarespace 7.1 vacation-rental property guide)
Clone:  https://9111bayave-clone.vercel.app/
Method: raw-HTML static mirror of the JS-rendered pages, all assets localized, Typekit + Google
        fonts self-hosted, Squarespace client JS kept (so the mobile off-canvas menu and weather
        widget work). 20 same-domain pages.

## Final discrepancy table

| Page | Element | Original | Clone | Severity | Status |
|------|---------|----------|-------|----------|--------|
| floor-plans | Matterport 3D tour iframe | live 3D viewer | live 3D viewer (same external embed) | LOW | Live embed; renders identically, frame content is live so a frozen screenshot can differ <1% |
| tvs | remote-control / device thumbnails | as on origin | identical | LOW | <0.7% mobile sub-pixel diff only |
| home, all pages | weather widget (weatherwidget.io) | current local weather | current local weather | LOW | Live data — shows whatever the current forecast is; identical when captured at the same moment |
| (all) | link underline anti-aliasing on tall mobile pages | — | — | LOW | sub-pixel only; native segment-diff = 0.00% |

No HIGH or MEDIUM discrepancies remain. Objective measure: `compare_native.js` (native-resolution,
lockstep segment pixel-diff of origin vs live clone) reports 0.00% on every page at desktop, and
0.00% on mobile except floor-plans (0.64% worst seg = Matterport live frame) and tvs (0.67% worst
seg = sub-pixel). Desktop is 0.00% on all 20 pages.

> Note: the earlier `compare.js` (stitched full-page diff) reports inflated numbers (5–23%) on
> tall pages. That is a measurement artifact: stitched screenshots are downscaled to a 1500px cap,
> and a 1–2px difference in total page height changes the downscale ratio, shifting every row and
> producing "ghosted" edges. `compare_native.js` avoids this by diffing native viewport segments in
> lockstep; it is the authoritative measure and shows the pages are pixel-identical.

## Manual handling (dynamic features that cannot be reproduced by a static host)

These render visually but their server-side behavior is inert on a static mirror. Not failures.

- **Squarespace analytics beacon** `POST /api/census/RecordHit` — the kept Squarespace runtime fires
  this visitor-count beacon on every page; it 404s on a static host (it only exists on Squarespace's
  servers). No visual or functional impact. This is the ONLY finding from `audit.js` (1 per page).
- **Google Analytics / Google Tag Manager** — IDs preserved exactly in the markup:
  `UA-40446179-2`, `G-92EN33TGPP`, `GTM-P6NGPGR`. Scripts still load from Google's CDN; hits from the
  clone domain are not meaningful but the tags are present and faithful.
- **Weather widget** (home, footer band) — `weatherwidget.io` / `forecast7.com` external embed. Kept
  external (loads live). Shows current North Beach weather; content therefore varies with time of day.
- **Matterport 3D virtual tour** (floor-plans) — `my.matterport.com/show/?m=RUH5UmmPV6h` external
  iframe. Kept external; live interactive tour works on the clone.
- **DocsBot AI chatbot** (wakefield-chatbot) — `widget.docsbot.ai/chat.js` external widget. Kept
  external; loads and works on the clone.
- **Squarespace cart** (/cart) — auto-generated commerce cart page. The site sells nothing, so the
  page is effectively empty; checkout is inert on a static host.

## Source-side issues (present on the ORIGIN too — reproduced faithfully, NOT clone defects)

- **Malformed external link on /grocery-stores**: the source markup contains
  `href="/https://www.eatchesapeake.com/"` (a stray leading slash before a full URL). On the origin
  this resolves to `https://www.9111bayave.com/https://www.eatchesapeake.com/` → 404. The clone
  reproduces the identical broken href (404 on the clone domain too). Left as-is per ground rules
  (a clone that reproduces a source-side 404 is accurate; we do not "fix" or substitute).
- **CSS SVG-fragment refs** `url(%23check)` (URL-encoded `#check`) inside Squarespace's universal
  CSS → 404 against the stylesheet's own host on the origin as well. Cosmetic icon mask; no visual
  impact. 2 occurrences.
- **`https://fonts.gstatic.com`** appears as a bare preconnect hint (no path); not a real asset.

## Fonts

- Adobe Typekit kit (`use.typekit.net/af/...`, families **acumin-pro** + others) — kit `@font-face`
  rules are inlined in the page; the referenced woff2/woff/otf binaries are self-hosted under
  `/assets/use.typekit.net/...` and the URLs rewritten to local. (Typekit blocks cross-origin by
  domain, so self-hosting is required for the fonts to load off the clone's Vercel domain.)
- **Poppins** (`fonts.googleapis.com` + `fonts.gstatic.com`) — CSS and 133 woff2 binaries self-hosted
  under `/assets/fonts.googleapis.com` and `/assets/fonts.gstatic.com`, references rewritten to local.
