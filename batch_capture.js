#!/usr/bin/env node
// Batch-capture every URL in urls.txt using capture.js capturePage.
const fs = require('fs');
const path = require('path');
const { capturePage } = require('./capture.js');

function slugFor(u) {
  try {
    const p = new URL(u).pathname.replace(/^\/+|\/+$/g, '');
    return p === '' ? 'home' : p;
  } catch (e) { return 'home'; }
}

(async () => {
  const urls = fs.readFileSync(path.join(__dirname, 'urls.txt'), 'utf8')
    .split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'));
  const only = process.argv[2]; // optional: capture only this slug
  for (const u of urls) {
    const slug = slugFor(u);
    if (only && slug !== only) continue;
    const outdir = path.join(__dirname, 'captures', slug);
    if (fs.existsSync(path.join(outdir, 'page.html')) && process.env.SKIP_EXISTING === '1') {
      console.log('SKIP (exists)', slug);
      continue;
    }
    console.log('=== CAPTURING', slug, u, '===');
    try {
      await capturePage(u, outdir);
      console.log('OK', slug);
    } catch (e) {
      console.error('FAILED', slug, e.message);
    }
  }
  console.log('ALL DONE');
})();
