/* ============================================================================
 * run_test1.js — 轮1 程序化自测（无头 Edge / playwright-core）
 *   ① 打开页面 → 抓全部 console 消息 + pageerror
 *   ② 真实鼠标点击：▶ 播放、五十音格试听、导出 WAV（拦截下载）
 *   ③ 抓屏（初始 / 播放中 / 点击后）
 *   ④ 导出 WAV 落盘 + 量 RMS/峰值/时长（非静音判据）
 * 用法：node tools/run_test1.js
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const PW = 'C:/Users/lenovo/AppData/Roaming/npm/node_modules/openclaw/node_modules/playwright-core';
const { chromium } = require(PW);

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PAGE = 'file:///D:/OpenClawTemp/diva-web/index.html';
const OUT = 'D:/OpenClawTemp/diva-web/test';
const URLBASE = 'file:///D:/OpenClawTemp/diva-web/';

function log(o) { console.log(JSON.stringify(o)); }

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: EDGE,
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--allow-file-access-from-files',
           '--hide-scrollbars', '--force-device-scale-factor=1', '--mute-audio']
  });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
  const page = await ctx.newPage();

  const logs = [];
  page.on('console', m => logs.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', e => logs.push({ type: 'pageerror', text: String(e && e.message || e) }));
  page.on('requestfailed', r => logs.push({ type: 'requestfailed', text: r.url() + ' :: ' + (r.failure() || {}).errorText }));

  const t0 = Date.now();
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForTimeout(600);

  // ---- 画布几何（设计坐标 -> 页面像素） ----
  const box = await page.evaluate(() => {
    const r = document.getElementById('panel').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const sx = box.w / 1280, sy = box.h / 800;
  const click = async (dx, dy) => {
    await page.mouse.move(box.x + dx * sx, box.y + dy * sy);
    await page.mouse.down();
    await page.waitForTimeout(40);
    await page.mouse.up();
  };

  // ---- ① 初始态 ----
  const init = await page.evaluate(() => ({
    version: window.__diva && window.__diva.version,
    notes: window.__diva.state.notes.length,
    total: window.__diva.state.total,
    params: window.__diva.state.params
  }));
  log({ step: 'init', box, init });
  await page.screenshot({ path: path.join(OUT, 'shot-1-initial.png') });

  // ---- 画布非空判据（像素统计：背景色以外的像素数） ----
  const px = await page.evaluate(() => {
    const cv = document.getElementById('panel');
    const g = cv.getContext('2d');
    const d = g.getImageData(0, 0, cv.width, cv.height).data;
    let nonBg = 0, teal = 0, pink = 0, tot = 0;
    for (let i = 0; i < d.length; i += 4 * 37) {           // 抽样
      tot++;
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      if (!(r === 10 && gg === 14 && b === 19)) nonBg++;
      if (Math.abs(r - 57) < 26 && Math.abs(gg - 197) < 26 && Math.abs(b - 187) < 26) teal++;
      if (Math.abs(r - 242) < 26 && Math.abs(gg - 169) < 26 && Math.abs(b - 218) < 26) pink++;
    }
    return { sampled: tot, nonBg, nonBgPct: nonBg / tot, teal, pink };
  });
  log({ step: 'pixels', px });

  // ---- ② 五十音格试听（真实点击：か = 第2行第1列） ----
  const cw = (304 - 8) / 5, chh = 556 / 11;
  const kx = 8 + 4 + 0 * cw + cw / 2, ky = 104 + 1 * chh + chh / 2;
  await click(kx, ky);
  await page.waitForTimeout(700);
  const afterKana = await page.evaluate(() => ({ status: window.__diva.state.status, lit: window.__diva.state.litKana }));
  log({ step: 'kana-audition', design: { x: kx, y: ky }, afterKana });
  await page.screenshot({ path: path.join(OUT, 'shot-2-kana-click.png') });

  // ---- ③ ▶ 播放（真实点击 310..354 / 12..50） ----
  await click(332, 31);
  await page.waitForTimeout(2500);
  const mid = await page.evaluate(() => ({ playing: window.__diva.state.playing, cur: window.__diva.state.curIdx, status: window.__diva.state.status, ctxState: window.__diva.ctx && window.__diva.ctx.state }));
  log({ step: 'playing', mid });
  await page.screenshot({ path: path.join(OUT, 'shot-3-playing.png') });
  await page.waitForTimeout(4500);
  const end = await page.evaluate(() => ({ playing: window.__diva.state.playing, status: window.__diva.state.status }));
  log({ step: 'play-done', end });

  // ---- ④ 导出 WAV（真实点击 652..790 / 674..704，拦截下载） ----
  let saved = null;
  const dl = page.waitForEvent('download', { timeout: 60000 }).catch(() => null);
  await click(652 + 138 / 2, 668 + 6 + 15);
  const download = await dl;
  if (download) {
    const p = path.join(OUT, 'export-' + download.suggestedFilename());
    await download.saveAs(p);
    saved = p;
    log({ step: 'download', path: p, size: fs.statSync(p).size, suggested: download.suggestedFilename() });
  } else {
    log({ step: 'download', error: 'no download event' });
  }
  await page.waitForTimeout(500);
  const expStats = await page.evaluate(() => ({ status: window.__diva.state.status, stats: window.__diva.state.lastStats }));
  log({ step: 'export-status', expStats });
  await page.screenshot({ path: path.join(OUT, 'shot-4-after-export.png') });

  // ---- ⑤ 参数交互（旋钮：在 BREATH 卡上向上拖 120px） ----
  var kx2 = box.x + (8 + 60) * sx, ky2 = box.y + (668 + 44 + 44) * sy;
  await page.mouse.move(kx2, ky2);
  await page.mouse.down();
  for (var s = 1; s <= 6; s++) { await page.mouse.move(kx2, ky2 - 20 * s * sy); await page.waitForTimeout(30); }
  await page.mouse.up();
  await page.waitForTimeout(200);
  const par = await page.evaluate(() => ({ breath: window.__diva.state.params.breath, bright: window.__diva.state.params.bright }));
  log({ step: 'param-drag', par });

  // ---- 汇总 console ----
  const errs = logs.filter(l => l.type === 'error' || l.type === 'pageerror' || l.type === 'requestfailed');
  const warns = logs.filter(l => l.type === 'warning');
  log({ step: 'console', total: logs.length, errors: errs.length, warnings: warns.length, errList: errs, warnList: warns, all: logs });
  log({ step: 'elapsedMs', ms: Date.now() - t0 });

  await browser.close();
  process.exit(errs.length ? 2 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
