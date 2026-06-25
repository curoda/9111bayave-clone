#!/usr/bin/env node
/*
 * Native-resolution segment comparator (Phase 6 objective measure).
 * Loads ORIGINAL and CLONE simultaneously at the same viewport, scrolls in lockstep by
 * viewport HEIGHT, captures each viewport segment at native resolution (<=2000px, NO downscale),
 * and pixel-diffs matching segments. Avoids the stitch+downscale alignment artifact that
 * inflates tall-page diffs. Saves worst diff segment per page.
 *
 * Usage: node compare_native.js <slug|all> [maxSegs]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');

const ORIGIN = 'https://www.9111bayave.com';
const CLONE = 'https://9111bayave-clone.vercel.app';
const ROOT = __dirname;
const OUT = path.join(ROOT, 'compare_native');

function slugFor(u){ try{const p=new URL(u).pathname.replace(/^\/+|\/+$/g,'');return p===''?'home':p;}catch(e){return 'home';} }
function urlFor(base, slug){ return slug==='home'? base+'/' : base+'/'+slug; }

async function prep(ctx, url, step){
  const page = await ctx.newPage();
  await page.goto(url, {waitUntil:'networkidle', timeout:90000}).catch(async()=>{ await page.goto(url,{waitUntil:'domcontentloaded',timeout:90000}); });
  await page.waitForTimeout(1500);
  await page.evaluate(async (s)=>{ await new Promise(r=>{let t=0;const i=setInterval(()=>{const sh=document.body.scrollHeight;window.scrollBy(0,s);t+=s;if(t>=sh+s){clearInterval(i);r();}},100);}); }, step);
  await page.waitForTimeout(800);
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.waitForTimeout(500);
  return page;
}

function diffPng(aBuf, bBuf, w, h){
  const a = PNG.sync.read(aBuf); const b = PNG.sync.read(bBuf);
  const out = new PNG({width:w,height:h});
  const n = pixelmatch(a.data, b.data, out.data, w, h, {threshold:0.12});
  return {n, out, pct: 100*n/(w*h)};
}

async function comparePage(browser, slug, viewport, maxSegs){
  const vp = viewport;
  const ctxO = await browser.newContext({viewport:vp, deviceScaleFactor:1, ignoreHTTPSErrors:true,
    isMobile: vp.width<500, hasTouch: vp.width<500,
    userAgent: vp.width<500 ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'});
  const ctxC = await browser.newContext({viewport:vp, deviceScaleFactor:1, ignoreHTTPSErrors:true,
    isMobile: vp.width<500, hasTouch: vp.width<500,
    userAgent: vp.width<500 ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'});
  const pO = await prep(ctxO, urlFor(ORIGIN, slug), vp.height);
  const pC = await prep(ctxC, urlFor(CLONE, slug), vp.height);
  const hO = await pO.evaluate(()=>document.body.scrollHeight);
  const hC = await pC.evaluate(()=>document.body.scrollHeight);
  const total = Math.min(hO, hC);
  const od = path.join(OUT, slug); fs.mkdirSync(od, {recursive:true});
  let worst = {pct:0, i:-1};
  let sum=0, cnt=0;
  const nseg = Math.min(maxSegs, Math.ceil(total/vp.height));
  for (let i=0;i<nseg;i++){
    const y = i*vp.height;
    await pO.evaluate(yy=>window.scrollTo(0,yy), y); await pC.evaluate(yy=>window.scrollTo(0,yy), y);
    await pO.waitForTimeout(250); await pC.waitForTimeout(250);
    const remaining = total - y; const clipH = Math.min(vp.height, remaining);
    if (clipH < 30) break;
    const aBuf = await pO.screenshot();
    const bBuf = await pC.screenshot();
    // crop both to clipH from top
    const {n,out,pct} = diffPng(aBuf, bBuf, vp.width, vp.height);
    sum+=pct; cnt++;
    if (pct>worst.pct){ worst={pct, i}; fs.writeFileSync(path.join(od,`worst_${vp.width}.png`), PNG.sync.write(out)); }
  }
  await ctxO.close(); await ctxC.close();
  const mean = cnt? sum/cnt : 0;
  return {mean, worst:worst.pct, worstSeg:worst.i, segs:cnt, label: vp.width<500?'mobile':'desktop'};
}

(async()=>{
  const arg = process.argv[2]||'all';
  const maxSegs = parseInt(process.argv[3]||'30',10);
  let slugs;
  if (arg==='all'){
    slugs = fs.readFileSync(path.join(ROOT,'urls.txt'),'utf8').split('\n').map(s=>s.trim()).filter(s=>s&&!s.startsWith('#')).map(slugFor);
  } else { slugs = arg.split(','); }
  const browser = await chromium.launch();
  for (const slug of slugs){
    try {
      const d = await comparePage(browser, slug, {width:1440,height:900}, maxSegs);
      const m = await comparePage(browser, slug, {width:390,height:844}, maxSegs);
      console.log(`${slug.padEnd(20)} desktop mean ${d.mean.toFixed(2)}% worst ${d.worst.toFixed(2)}%(seg${d.worstSeg})  |  mobile mean ${m.mean.toFixed(2)}% worst ${m.worst.toFixed(2)}%(seg${m.worstSeg})`);
    } catch(e){ console.log(slug, 'ERR', e.message); }
  }
  await browser.close();
  console.log('NATIVE COMPARE DONE');
})();
