/* ============================================================================
 * run_test2.js — 轮2 A/B 自测：网页版 vs Max 版参考渲染（同句 = 世界で一番お姫様 第一句）
 *   ① 页面内离线渲染 1 遍（对齐 Max 单遍导出）→ 落盘 web-line1.wav
 *   ② 页面内离线渲染 2 遍 + 收尾（交付用导出）→ 落盘 web-export-2loops.wav
 *   ③ 输出两者与参考的统计（由 analyze.js 另行汇总）
 * 用法：node tools/run_test2.js
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const PW = 'C:/Users/lenovo/AppData/Roaming/npm/node_modules/openclaw/node_modules/playwright-core';
const { chromium } = require(PW);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PAGE = 'file:///D:/OpenClawTemp/diva-web/index.html';
const OUT = 'D:/OpenClawTemp/diva-web/test';

(async () => {
  const browser = await chromium.launch({
    executablePath: EDGE, headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--allow-file-access-from-files', '--mute-audio']
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e && e.message || e)));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForTimeout(400);

  async function render(loops, file) {
    const r = await page.evaluate(async (lp) => {
      const res = await window.__diva.renderWav(lp);
      const b64 = await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result.split(',')[1]); fr.readAsDataURL(res.blob); });
      return { stats: res.stats, name: res.name, loops: res.loops, duration: res.duration, b64 };
    }, loops);
    fs.writeFileSync(path.join(OUT, file), Buffer.from(r.b64, 'base64'));
    console.log(JSON.stringify({ step: 'render', loops, file, size: fs.statSync(path.join(OUT, file)).size, stats: r.stats }));
    return r;
  }

  await render(1, 'web-line1.wav');
  await render(2, 'web-export-2loops.wav');
  console.log(JSON.stringify({ step: 'console', errors: errs.length, errs }));
  await browser.close();
  process.exit(errs.length ? 2 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
