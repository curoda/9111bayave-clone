#!/usr/bin/env node
/*
 * Reusable capture script for website cloning.
 * Usage:
 *   node capture.js <url> <outdir> [--full]
 *
 * Produces in <outdir>:
 *   screenshot-desktop.png  (segmented scroll-capture, 1440x900 viewport, segments <=1500px tall, downscaled to <=1500px longest side)
 *   screenshot-mobile.png   (390x844 viewport, same rules)
 *   page.html               (fully rendered HTML after JS)
 *   styles.json             (computed styles for visible elements)
 *   assets.txt              (every media URL)
 *   fonts.txt               (font-family names + sources)
 *   embeds.txt              (iframes/embeds)
 *   meta.txt                (title, meta, OG, twitter, canonical, analytics)
 *   links.txt               (every link, INTERNAL/EXTERNAL)
 *
 * HARD RULE: every screenshot's longest side <= 1500px (downscaled via ImageMagick after save).
 * deviceScaleFactor=1, ignoreHTTPSErrors=true always.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ORIGIN_HOST = '9111bayave.com';

async function autoScroll(page, step) {
  // Scroll to bottom in increments to trigger lazy-loaded content, then back to top
  await page.evaluate(async (stepPx) => {
    await new Promise((resolve) => {
      let total = 0;
      const timer = setInterval(() => {
        const sh = document.body.scrollHeight;
        window.scrollBy(0, stepPx);
        total += stepPx;
        if (total >= sh + stepPx) {
          clearInterval(timer);
          resolve();
        }
      }, 120);
    });
  }, step);
  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
}

function downscale(file) {
  // Downscale longest side to <=1500px (never enlarge). Then print dimensions.
  try {
    execSync(`mogrify -resize 1500x1500\\> "${file}"`);
  } catch (e) {
    console.error('mogrify failed for', file, e.message);
  }
  try {
    const dim = execSync(`identify -format "%wx%h" "${file}"`).toString().trim();
    console.log(`  saved ${path.basename(file)} -> ${dim}`);
  } catch (e) {}
}

async function segmentedCapture(page, viewport, outPath) {
  // Capture page in vertical viewport-sized segments, advancing scroll by viewport HEIGHT
  // (critical: step by HEIGHT, not width). Screenshot the current viewport each time
  // (clip coords are viewport-relative, so no clip is used). Crop overlap from the final
  // clamped segment, then stitch vertically with ImageMagick. Each segment <= viewport.height
  // (<=1500px), final stitched image downscaled so longest side <= 1500px.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  const totalHeight = await page.evaluate(() => document.body.scrollHeight);
  const vh = viewport.height; // step by HEIGHT (critical!)
  const segDir = outPath + '.segs';
  if (!fs.existsSync(segDir)) fs.mkdirSync(segDir, { recursive: true });
  const segs = []; // {file, y}
  const maxSegs = 80;
  let prevActual = -1;
  for (let i = 0; i < maxSegs; i++) {
    const target = i * vh;
    if (i > 0 && target >= totalHeight) break;
    await page.evaluate((yy) => window.scrollTo(0, yy), target);
    await page.waitForTimeout(300);
    const actualY = await page.evaluate(() => Math.round(window.pageYOffset));
    if (i > 0 && actualY === prevActual) break; // cannot scroll further
    const f = path.join(segDir, `seg_${String(i).padStart(2, '0')}.png`);
    await page.screenshot({ path: f }); // current viewport = width x height
    segs.push({ file: f, y: actualY });
    prevActual = actualY;
  }
  // Crop overlap: segment i top overlaps previous bottom by (prev.y + vh - cur.y)
  const finalFiles = [];
  for (let i = 0; i < segs.length; i++) {
    if (i === 0) { finalFiles.push(segs[i].file); continue; }
    const overlap = (segs[i - 1].y + vh) - segs[i].y;
    if (overlap > 0 && overlap < vh) {
      const cropped = path.join(segDir, `crop_${String(i).padStart(2, '0')}.png`);
      execSync(`convert "${segs[i].file}" -crop ${viewport.width}x${vh - overlap}+0+${overlap} +repage "${cropped}"`);
      finalFiles.push(cropped);
    } else if (overlap >= vh) {
      // fully overlapping, skip
    } else {
      finalFiles.push(segs[i].file);
    }
  }
  if (finalFiles.length === 1) {
    fs.copyFileSync(finalFiles[0], outPath);
  } else if (finalFiles.length > 1) {
    execSync(`convert ${finalFiles.map((s) => `"${s}"`).join(' ')} -append "${outPath}"`);
  }
  try { fs.rmSync(segDir, { recursive: true, force: true }); } catch (e) {}
  downscale(outPath);
}

async function extractSpec(page, outdir, url) {
  // ---- styles.json: computed styles for visible elements ----
  const styles = await page.evaluate(() => {
    const props = ['font-family','font-size','font-weight','line-height','letter-spacing','color',
      'background-color','background-image','text-align','margin','padding','display',
      'flex-direction','justify-content','align-items','flex-wrap','grid-template-columns',
      'gap','max-width','width','height','border-radius','box-shadow','position','text-transform'];
    const out = [];
    const els = document.querySelectorAll('body, body *');
    let count = 0;
    for (const el of els) {
      if (count > 4000) break;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      // only visible-ish
      const rec = { tag: el.tagName.toLowerCase() };
      if (el.id) rec.id = el.id;
      if (el.className && typeof el.className === 'string') rec.class = el.className.slice(0,200);
      const s = {};
      for (const p of props) s[p] = cs.getPropertyValue(p);
      rec.styles = s;
      rec.rect = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      out.push(rec);
      count++;
    }
    return out;
  });
  fs.writeFileSync(path.join(outdir, 'styles.json'), JSON.stringify(styles, null, 1));

  // ---- assets.txt: every media URL ----
  const assets = await page.evaluate(() => {
    const urls = new Set();
    const abs = (u) => { try { return new URL(u, location.href).href; } catch (e) { return null; } };
    document.querySelectorAll('img[src]').forEach((i) => { const u = abs(i.getAttribute('src')); if (u) urls.add(u); });
    document.querySelectorAll('img[data-src]').forEach((i) => { const u = abs(i.getAttribute('data-src')); if (u) urls.add(u); });
    document.querySelectorAll('[srcset]').forEach((i) => {
      (i.getAttribute('srcset')||'').split(',').forEach((part) => {
        const u0 = part.trim().split(/\s+/)[0]; const u = abs(u0); if (u) urls.add(u);
      });
    });
    document.querySelectorAll('source[src]').forEach((i) => { const u = abs(i.getAttribute('src')); if (u) urls.add(u); });
    document.querySelectorAll('video[src],audio[src]').forEach((i) => { const u = abs(i.getAttribute('src')); if (u) urls.add(u); });
    document.querySelectorAll('video[poster]').forEach((i) => { const u = abs(i.getAttribute('poster')); if (u) urls.add(u); });
    // background-image on every element
    document.querySelectorAll('body, body *').forEach((el) => {
      const bg = getComputedStyle(el).getPropertyValue('background-image');
      if (bg && bg !== 'none') {
        const re = /url\((['"]?)(.*?)\1\)/g; let m;
        while ((m = re.exec(bg)) !== null) { const u = abs(m[2]); if (u) urls.add(u); }
      }
      // data-src / data-image (squarespace lazy)
      ['data-src','data-image','data-load-src'].forEach((a) => {
        if (el.hasAttribute && el.hasAttribute(a)) { const u = abs(el.getAttribute(a)); if (u) urls.add(u); }
      });
    });
    // favicons / app icons
    document.querySelectorAll('link[rel*="icon"], link[rel="apple-touch-icon"], link[rel="mask-icon"]').forEach((l) => {
      const u = abs(l.getAttribute('href')); if (u) urls.add(u);
    });
    return Array.from(urls);
  });
  fs.writeFileSync(path.join(outdir, 'assets.txt'), assets.join('\n'));

  // ---- fonts.txt ----
  const fonts = await page.evaluate(() => {
    const fams = new Set();
    document.querySelectorAll('body, body *').forEach((el) => {
      const ff = getComputedStyle(el).getPropertyValue('font-family');
      if (ff) fams.add(ff.trim());
    });
    const sheets = [];
    document.querySelectorAll('link[rel="stylesheet"]').forEach((l) => sheets.push(l.href));
    return { families: Array.from(fams), stylesheets: sheets };
  });
  fs.writeFileSync(path.join(outdir, 'fonts.txt'),
    'FAMILIES:\n' + fonts.families.join('\n') + '\n\nSTYLESHEETS:\n' + fonts.stylesheets.join('\n'));

  // ---- embeds.txt ----
  const embeds = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('iframe, embed, object').forEach((e) => {
      out.push((e.tagName.toLowerCase()) + '\t' + (e.getAttribute('src') || e.getAttribute('data') || ''));
    });
    return out;
  });
  fs.writeFileSync(path.join(outdir, 'embeds.txt'), embeds.join('\n'));

  // ---- meta.txt ----
  const meta = await page.evaluate(() => {
    const lines = [];
    lines.push('TITLE: ' + document.title);
    document.querySelectorAll('meta').forEach((m) => {
      const n = m.getAttribute('name') || m.getAttribute('property') || m.getAttribute('http-equiv');
      const c = m.getAttribute('content');
      if (n && c) lines.push(`META ${n}: ${c}`);
    });
    const can = document.querySelector('link[rel="canonical"]');
    if (can) lines.push('CANONICAL: ' + can.href);
    // analytics / tag ids
    const html = document.documentElement.outerHTML;
    const ids = new Set();
    [/UA-\d{4,}-\d+/g, /G-[A-Z0-9]{6,}/g, /GTM-[A-Z0-9]+/g, /AW-\d+/g].forEach((re) => {
      let m; while ((m = re.exec(html)) !== null) ids.add(m[0]);
    });
    if (ids.size) lines.push('ANALYTICS_IDS: ' + Array.from(ids).join(', '));
    return lines.join('\n');
  });
  fs.writeFileSync(path.join(outdir, 'meta.txt'), meta);

  // ---- links.txt ----
  const links = await page.evaluate((host) => {
    const out = [];
    document.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href');
      let abs; try { abs = new URL(href, location.href).href; } catch (e) { abs = href; }
      let kind = 'EXTERNAL';
      try {
        const u = new URL(abs);
        if (u.hostname.endsWith(host) || href.startsWith('/') || href.startsWith('#')) kind = 'INTERNAL';
        if (u.protocol === 'mailto:' || u.protocol === 'tel:' || u.protocol === 'sms:') kind = 'EXTERNAL';
      } catch (e) {}
      out.push(kind + '\t' + href + '\t' + abs);
    });
    return Array.from(new Set(out));
  }, ORIGIN_HOST);
  fs.writeFileSync(path.join(outdir, 'links.txt'), links.join('\n'));
}

async function capturePage(url, outdir, opts = {}) {
  if (!fs.existsSync(outdir)) fs.mkdirSync(outdir, { recursive: true });
  const browser = await chromium.launch();
  try {
    // DESKTOP
    const ctxD = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      ignoreHTTPSErrors: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    });
    const pageD = await ctxD.newPage();
    await pageD.goto(url, { waitUntil: 'networkidle', timeout: 90000 }).catch(async () => {
      await pageD.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    });
    await pageD.waitForTimeout(1500);
    await autoScroll(pageD, 700);
    await pageD.waitForTimeout(1000);
    // Save rendered HTML + full spec from desktop
    const html = await pageD.content();
    fs.writeFileSync(path.join(outdir, 'page.html'), html);
    await extractSpec(pageD, outdir, url);
    await segmentedCapture(pageD, { width: 1440, height: 900 }, path.join(outdir, 'screenshot-desktop.png'));
    await ctxD.close();

    // MOBILE
    const ctxM = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      ignoreHTTPSErrors: true,
      isMobile: true,
      hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
    });
    const pageM = await ctxM.newPage();
    await pageM.goto(url, { waitUntil: 'networkidle', timeout: 90000 }).catch(async () => {
      await pageM.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    });
    await pageM.waitForTimeout(1500);
    await autoScroll(pageM, 600);
    await pageM.waitForTimeout(1000);
    await segmentedCapture(pageM, { width: 390, height: 844 }, path.join(outdir, 'screenshot-mobile.png'));
    await ctxM.close();
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  const [,, url, outdir] = process.argv;
  if (!url || !outdir) {
    console.error('Usage: node capture.js <url> <outdir>');
    process.exit(1);
  }
  capturePage(url, outdir).then(() => console.log('DONE', url)).catch((e) => { console.error('ERR', e); process.exit(1); });
}

module.exports = { capturePage, segmentedCapture, downscale };
