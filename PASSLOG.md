# Phase 6 — iterate-until-it-matches log

Objective measure: `compare_native.js` — loads the live ORIGIN and the live CLONE side by side at
the same viewport, scrolls in lockstep by viewport height, and pixel-diffs each native-resolution
segment (no downscale). This is the authoritative number. `compare.js` (stitched full-page diff) is
also run but its tall-page numbers are inflated by the 1500px downscale-ratio artifact (documented
in DISCREPANCIES.md), so it is used only as a coarse screen.

## Pass 1
- Deployed first full mirror; ran `compare.js` (stitched). Saw inflated diffs on tall, image-heavy
  pages (e.g. things-to-do mobile 22.93%, check-in-and-out mobile 19.26%, home desktop 2.22%).
- Root-caused: NOT defects. Direct screenshot comparison showed identical content/layout/images;
  the diff came from stitched screenshots being downscaled to the 1500px cap, where a 1–2px total
  height difference shifts every row ("ghosting").
- Built `compare_native.js` (native lockstep segment diff). Result: **0.00% desktop on all pages**,
  mobile 0.00% except floor-plans 0.62% (Matterport live frame) and check-in/tvs <0.7% (sub-pixel).
- Found one real defect by inspecting markup: the homepage `<link rel="canonical">` was emptied to
  `href=""` by an over-aggressive same-domain href strip in `mirror.py`. Severity MEDIUM (metadata).
- Fix: `rewrite_internal_links()` now restores an empty canonical to `/`; did a clean from-scratch
  rebuild of `site/` (the earlier in-place re-run had double-processed cached CSS — discarded).
  Redeployed.

## Pass 2 (verification after fix)
- Canonical now correct on live clone: home `/`, beach `/beach`, etc.
- `compare_native.js` re-run on representative + full set: desktop 0.00% on all 20 pages; mobile
  0.00% except floor-plans 0.64% and tvs 0.67% (both LOW — live external embed / sub-pixel).
- Self-hosted fonts verified live: Typekit woff2 (font/woff2, 200) and Poppins gstatic woff2
  (font/woff2, 200) both serve from the clone domain.
- `audit.js` across all 20 live pages: the only finding is `POST /api/census/RecordHit` → 404, the
  Squarespace visitor-analytics beacon, inert on a static host (no visual/functional impact).
- No HIGH or MEDIUM discrepancies remain.

## Stopping condition
**Met: "no HIGH or MEDIUM remain (only LOW)."** Reached after 2 passes (well under the 8-pass cap).
The clone is visually faithful to the original at both 1440px and 390px.

## Counts
- Pass 1: defects found — 1 MEDIUM (canonical), 0 HIGH. Artifacts dismissed: ~8 inflated stitched-diff
  pages (all confirmed pixel-identical natively). Fixed: 1/1.
- Pass 2: HIGH 0, MEDIUM 0, LOW (live embeds / sub-pixel) — left as-is.
- Unfixable: none. Manual-handling (dynamic) items listed separately in DISCREPANCIES.md.
