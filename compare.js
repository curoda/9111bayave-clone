#!/usr/bin/env node
/*
 * Phase 6 comparator: capture the LIVE clone at desktop+mobile using the same segmented
 * method as capture.js, then pixel-diff against the saved ORIGINAL screenshots.
 *
 * Usage: node compare.js <cloneBaseUrl>
 * Reads urls.txt for slugs. Writes compare/<slug>/{clone-desktop,clone-mobile,diff-*}.png
 * and prints a per-page diff percentage table.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');
const { execSync } = require('child_process');
const { segmentedCapture } = require('./capture.js');

const CLONE_BASE = (process.argv[2] || 'https://9111bayave-clone.vercel.app').replace(/\/$/, '');
const ROOT = __dirname;
const CAP = path.join(ROOT, 'captures');
const OUT = path.join(ROOT, 'compare');

function slugFor(u) {
  try { const p = new URL(u).pathname.replace(/^\/+|\/+$/g, ''); return p === '' ? 'home' : p; }
  catch (e) { return 'home'; }
}

async function snap(page, url, viewport, outPath, scrollStep) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 }).catch(async () => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  });
  await page.waitForTimeout(1500);
  // scroll to trigger lazy
  await page.evaluate(async (step) => {
    await new Promise((res) => { let t=0; const i=setInterval(()=>{const sh=document.body.scrollHeight;window.scrollBy(0,step);t+=step;if(t>=sh+step){clearInterval(i);res();}},120); });
  }, scrollStep);
  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await segmentedCapture(page, viewport, outPath);
}

function diffImages(origPath, clonePath, diffPath) {
  if (!fs.existsSync(origPath) || !fs.existsSync(clonePath)) return null;
  const dimO = execSync(`identify -format "%wx%h" "${origPath}"`).toString().trim().split('x').map(Number);
  const dimC = execSync(`identify -format "%wx%h" "${clonePath}"`).toString().trim().split('x').map(Number);
  // Resize clone to the ORIGINAL width preserving aspect ratio (no vertical stretch),
  // then top-align crop both to the common height. This keeps content vertically aligned
  // so the diff reflects real differences, not cumulative offset from height normalization.
  const w = dimO[0];
  const tmpO = origPath + '.norm.png';
  const tmpC = clonePath + '.norm.png';
  execSync(`convert "${origPath}" -resize ${w} "${tmpO}"`);
  execSync(`convert "${clonePath}" -resize ${w} "${tmpC}"`);
  const hO = execSync(`identify -format "%h" "${tmpO}"`).toString().trim() | 0;
  const hC = execSync(`identify -format "%h" "${tmpC}"`).toString().trim() | 0;
  const h = Math.min(hO, hC);
  execSync(`convert "${tmpO}" -crop ${w}x${h}+0+0 +repage "${tmpO}"`);
  execSync(`convert "${tmpC}" -crop ${w}x${h}+0+0 +repage "${tmpC}"`);
  const a = PNG.sync.read(fs.readFileSync(tmpO));
  const b = PNG.sync.read(fs.readFileSync(tmpC));
  const diff = new PNG({ width: w, height: h });
  const n = pixelmatch(a.data, b.data, diff.data, w, h, { threshold: 0.12 });
  fs.writeFileSync(diffPath, PNG.sync.write(diff));
  fs.rmSync(tmpO); fs.rmSync(tmpC);
  return { pct: (100 * n / (w * h)), heightOrig: dimO[1], heightClone: dimC[1], w, h };
}

(async () => {
  const only = process.argv[3];
  const urls = fs.readFileSync(path.join(ROOT, 'urls.txt'), 'utf8').split('\n').map(s=>s.trim()).filter(s=>s&&!s.startsWith('#'));
  const browser = await chromium.launch();
  const rows = [];
  for (const u of urls) {
    const slug = slugFor(u);
    if (only && slug !== only) continue;
    const od = path.join(OUT, slug);
    fs.mkdirSync(od, { recursive: true });
    const cloneUrl = slug === 'home' ? CLONE_BASE + '/' : CLONE_BASE + '/' + slug;
    // desktop
    const ctxD = await browser.newContext({ viewport:{width:1440,height:900}, deviceScaleFactor:1, ignoreHTTPSErrors:true,
      userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' });
    const pD = await ctxD.newPage();
    await snap(pD, cloneUrl, {width:1440,height:900}, path.join(od,'clone-desktop.png'), 700);
    await ctxD.close();
    // mobile
    const ctxM = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:1, ignoreHTTPSErrors:true, isMobile:true, hasTouch:true,
      userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1' });
    const pM = await ctxM.newPage();
    await snap(pM, cloneUrl, {width:390,height:844}, path.join(od,'clone-mobile.png'), 600);
    await ctxM.close();
    // diff
    const dd = diffImages(path.join(CAP,slug,'screenshot-desktop.png'), path.join(od,'clone-desktop.png'), path.join(od,'diff-desktop.png'));
    const dm = diffImages(path.join(CAP,slug,'screenshot-mobile.png'), path.join(od,'clone-mobile.png'), path.join(od,'diff-mobile.png'));
    rows.push({slug, dd, dm});
    const f = (x)=> x? `${x.pct.toFixed(2)}% (oH${x.heightOrig}/cH${x.heightClone})` : 'n/a';
    console.log(`${slug.padEnd(20)} desktop ${f(dd).padEnd(28)} mobile ${f(dm)}`);
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT,'summary.json'), JSON.stringify(rows,null,1));
  console.log('\nCOMPARE DONE');
})();
