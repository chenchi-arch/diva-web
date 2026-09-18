/* run_test3.js — D-1 音高曲线编辑器专项：真实鼠标拖拽 → 数据/播放/导出验证 */
const fs = require('fs'), path = require('path');
const PW = 'C:/Users/lenovo/AppData/Roaming/npm/node_modules/openclaw/node_modules/playwright-core';
const { chromium } = require(PW);
const OUT = 'D:/OpenClawTemp/diva-web/test';

(async () => {
  const b = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--allow-file-access-from-files', '--mute-audio']
  });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await p.goto('file:///D:/OpenClawTemp/diva-web/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(500);

  const box = await p.evaluate(() => { const r = document.getElementById('panel').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const sx = box.w / 1280, sy = box.h / 800;
  const D = (dx, dy) => [box.x + dx * sx, box.y + dy * sy];

  // 几何（与 app.js 保持一致）
  const geo = await p.evaluate(() => {
    const S = window.__diva.state, tot = S.total || 1;
    const GX = 372, GW = 900, ROWH = 15, TOP_MIDI = 84, GY = 100;
    const rowY = m => GY + (TOP_MIDI - m) * ROWH;
    return S.notes.map((n, i) => ({ i, r: n.r, t: n.t, d: n.d, midi: n.midi, glide: n.glide,
      x: GX + n.t / tot * GW, w: Math.max(7, n.d / tot * GW - 2), yc: rowY(n.midi) + ROWH / 2 - 1 }));
  });
  const log = o => console.log(JSON.stringify(o));

  // ① 选中 #2 ka → 拖「音尾圆点」上滑 30px → 期望尾端 +2.00 半音
  const g2 = geo[2];
  const [c2x, c2y] = D(g2.x + g2.w * 0.5, g2.yc);
  await p.mouse.click(c2x, c2y);            // 先单击选中（=试听+选中）
  await p.waitForTimeout(220);
  const [mx, my] = D(g2.x + g2.w, g2.yc);
  await p.mouse.move(mx, my); await p.mouse.down();
  for (let s = 1; s <= 6; s++) { await p.mouse.move(mx, my - s * 5 * sy); await p.waitForTimeout(25); }
  await p.mouse.up(); await p.waitForTimeout(200);
  log({ step: 'bend-drag', after: await p.evaluate(() => ({ curve: window.__diva.state.notes[2].curve, status: window.__diva.state.status })) });

  // ② 拖接缝滑音手柄：#11 sa（glide 260）向左 40px → 期望 ms 增大（10ms 步进，≤600）
  const g11 = geo[11];
  const gp = await p.evaluate(() => {
    const S = window.__diva.state, tot = S.total || 1, GX = 372, GW = 900;
    const gx = GX + S.notes[11].t / tot * GW;
    return { hx: gx - (S.notes[11].glide / tot * GW) / 2, hy: 0 };
  });
  // 用 yc 中点近似（与绘制一致：两音中点）——取 note11 与 note10 的 yc 平均
  const hy = (geo[11].yc + geo[10].yc) / 2;
  const [hx2, hy2] = D(gp.hx, hy);
  await p.mouse.move(hx2, hy2); await p.mouse.down();
  for (let s = 1; s <= 5; s++) { await p.mouse.move(hx2 - s * 10 * sx, hy2); await p.waitForTimeout(25); }
  await p.mouse.up(); await p.waitForTimeout(200);
  log({ step: 'glide-drag', after: await p.evaluate(() => ({ glide: window.__diva.state.notes[11].glide, status: window.__diva.state.status })) });

  // ③ 播放（带弯音+新滑音）+ 导出
  await p.mouse.click(box.x + 332 * sx, box.y + 31 * sy);
  await p.waitForTimeout(2600);
  log({ step: 'play', st: await p.evaluate(() => ({ playing: window.__diva.state.playing, cur: window.__diva.state.curIdx })) });
  await p.waitForTimeout(4600);
  const r = await p.evaluate(async () => {
    const res = await window.__diva.renderWav(1);
    return { stats: res.stats };
  });
  log({ step: 'render-with-curve', stats: r.stats });

  // ④ 双击音尾圆点 → 清除曲线
  const ch = await p.evaluate(() => {
    const S = window.__diva.state, tot = S.total || 1, GX = 372, GW = 900, ROWH = 15, TOP_MIDI = 84, GY = 100;
    const n = S.notes[2], pts = (n.curve && n.curve.length >= 2) ? n.curve : [{ u: 1, semi: 0 }];
    const semi = pts[pts.length - 1].semi;
    const rowY = m => GY + (TOP_MIDI - m) * ROWH;
    return { x: GX + n.t / tot * GW + Math.max(7, n.d / tot * GW - 2), y: rowY(n.midi + semi) + ROWH / 2 - 1 };
  });
  const [cx, cy] = D(ch.x, ch.y);
  await p.mouse.click(cx, cy); await p.waitForTimeout(120);
  await p.mouse.click(cx, cy); await p.waitForTimeout(250);
  log({ step: 'dbl-click-clear', after: await p.evaluate(() => ({ curve: window.__diva.state.notes[2].curve, status: window.__diva.state.status })) });

  await p.screenshot({ path: path.join(OUT, 'd1-editor.png') });
  log({ step: 'console', errors: errs.length, errs: errs.slice(0, 5) });
  fs.writeFileSync(path.join(OUT, 'd1-geo.json'), JSON.stringify(geo, null, 1));
  await b.close();
  process.exit(errs.length ? 2 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
