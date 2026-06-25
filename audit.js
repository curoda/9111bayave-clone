#!/usr/bin/env node
/*
 * Audit: load every clone page in Playwright and log every response with status >= 400
 * and every requestfailed event. Helps separate clone defects from source-side breakage.
 * Usage: node audit.js <cloneBaseUrl>
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = (process.argv[2] || 'https://9111bayave-clone.vercel.app').replace(/\/$/, '');
const ROOT = __dirname;

function slugFor(u){ try{const p=new URL(u).pathname.replace(/^\/+|\/+$/g,'');return p===''?'home':p;}catch(e){return 'home';} }
// Ignore noise from third-party analytics/widgets that we intentionally keep external.
const IGNORE = [/google-analytics/, /googletagmanager/, /doubleclick/, /weatherwidget\.io/, /forecast7/,
  /docsbot\.ai/, /matterport/, /stats\.g/, /\/collect\b/, /google\.com\/ccm/, /typekit\.net\/ik\//];

(async () => {
  const urls = fs.readFileSync(path.join(ROOT,'urls.txt'),'utf8').split('\n').map(s=>s.trim()).filter(s=>s&&!s.startsWith('#'));
  const browser = await chromium.launch();
  const findings = [];
  for (const u of urls) {
    const slug = slugFor(u);
    const cloneUrl = slug==='home'? BASE+'/' : BASE+'/'+slug;
    const ctx = await browser.newContext({ ignoreHTTPSErrors:true, viewport:{width:1440,height:900}, deviceScaleFactor:1 });
    const page = await ctx.newPage();
    const bad = [];
    page.on('response', (r)=>{ const s=r.status(); if (s>=400){ const url=r.url(); if(!IGNORE.some(re=>re.test(url))) bad.push({type:'response',status:s,url}); } });
    page.on('requestfailed', (req)=>{ const url=req.url(); if(!IGNORE.some(re=>re.test(url))) bad.push({type:'requestfailed',url,err:req.failure()&&req.failure().errorText}); });
    await page.goto(cloneUrl, {waitUntil:'networkidle', timeout:90000}).catch(()=>{});
    await page.waitForTimeout(1500);
    await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight)).catch(()=>{});
    await page.waitForTimeout(1500);
    if (bad.length) findings.push({slug, cloneUrl, bad});
    console.log(`${slug.padEnd(20)} issues: ${bad.length}`);
    for (const b of bad) console.log('   ', b.type, b.status||'', b.url, b.err||'');
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(ROOT,'audit-results.json'), JSON.stringify(findings,null,1));
  console.log('\nAUDIT DONE. pages with issues:', findings.length);
})();
