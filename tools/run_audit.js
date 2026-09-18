/* run_audit.js — 全控件实机巡检：真实鼠标逐个操作，报 PASS/FAIL + 证据截图
 * 用法: node tools/run_audit.js
 */
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
  const st = () => p.evaluate(() => ({ tab: window.__diva.state.tab, sel: window.__diva.state.sel, lit: window.__diva.state.litKana, playing: window.__diva.state.playing, status: window.__diva.state.status, params: window.__diva.state.params, notes: window.__diva.state.notes.length, curve2: window.__diva.state.notes[2] && window.__diva.state.notes[2].curve, glide11: window.__diva.state.notes[11] && window.__diva.state.notes[11].glide }));
  const res = [];
  const ok = (name, cond, detail) => { res.push((cond ? 'PASS ' : '**FAIL** ') + name + (detail ? '  [' + detail + ']' : '')); };
  async function click(dx, dy) { const [x, y] = D(dx, dy); await p.mouse.move(x, y); await p.mouse.down(); await p.waitForTimeout(35); await p.mouse.up(); await p.waitForTimeout(160); }
  async function drag(dx, dy, ddx, ddy, steps) {
    const [x, y] = D(dx, dy); await p.mouse.move(x, y); await p.mouse.down();
    const n = steps || 6;
    for (let s = 1; s <= n; s++) { await p.mouse.move(x + (ddx * sx) * s / n, y + (ddy * sy) * s / n); await p.waitForTimeout(28); }
    await p.mouse.up(); await p.waitForTimeout(180);
  }

  // ---------- 1. 五十音页签（含上边缘命中） ----------
  const TAB_L = 8, LW = 304, tw = (LW - 16) / 4;
  await click(TAB_L + 8 + tw * 1.5, 98);                      // 页签中部 → 浊音
  let s = await st(); ok('tab 中部点击 → 切到 1', s.tab === 1, 'tab=' + s.tab);
  await click(TAB_L + 8 + tw * 2.5, 80);                      // 页签上边缘
  s = await st(); ok('tab 上边缘(y=80) → 切到 2', s.tab === 2, 'tab=' + s.tab);
  await click(TAB_L + 8 + tw * 3.5, 88);                      // 拗音
  s = await st(); ok('tab 拗音 → 3', s.tab === 3, 'tab=' + s.tab);
  await click(TAB_L + 8 + tw * 0.5, 98);                      // 回清音
  s = await st(); ok('tab 回清音 → 0', s.tab === 0, 'tab=' + s.tab);

  // ---------- 2. 五十音格试听 ----------
  const cwx = (LW - 8) / 5, chx = 552 / 11;
  await click(8 + 4 + cwx * 0.5, 108 + chx * 1.5);            // か
  s = await st(); ok('点 か → 试听', /か/.test(s.status) && /cons=1/.test(s.status), s.status);
  await click(8 + 4 + cwx * 3.5, 108 + chx * 0.5);            // え
  s = await st(); ok('点 え → 试听', /え/.test(s.status), s.status);

  // ---------- 3. 卷帘音符试听 ----------
  const geo = await p.evaluate(() => {
    const S = window.__diva.state, tot = S.total || 1, GX = 372, GW = 900, ROWH = 15, TOP_MIDI = 84, GY = 100;
    const rowY = m => GY + (TOP_MIDI - m) * ROWH;
    return S.notes.map(n => ({ x: GX + n.t / tot * GW, w: Math.max(7, n.d / tot * GW - 2), yc: rowY(n.midi) + ROWH / 2 - 1, r: n.r }));
  });
  await click(geo[4].x + geo[4].w * 0.5, geo[4].yc);
  s = await st(); ok('点卷帘音符 #4 → 试听', s.sel === 4, 'sel=' + s.sel);

  // ---------- 4. 弯音：拖线中段 ----------
  await drag(geo[2].x + geo[2].w * 0.5, geo[2].yc, 0, -30);
  s = await st(); ok('拖线中段 → 生成弯音 +2.00', s.curve2 && s.curve2[1] && s.curve2[1].semi === 2, JSON.stringify(s.curve2));
  // 双击清除
  const chp = await p.evaluate(() => {
    const S = window.__diva.state, tot = S.total || 1, GX = 372, GW = 900, ROWH = 15, TOP_MIDI = 84, GY = 100;
    const n = S.notes[2], semi = (n.curve && n.curve[1]) ? n.curve[1].semi : 0;
    const rowY = m => GY + (TOP_MIDI - m) * ROWH;
    return { x: GX + n.t / tot * GW + Math.max(7, n.d / tot * GW - 2) * 0.5, y: rowY(n.midi + semi) + ROWH / 2 - 1 };
  });
  await click(chp.x, chp.y); await click(chp.x, chp.y);
  s = await st(); ok('双击控制点 → 清除', s.curve2 === null, JSON.stringify(s.curve2));

  // ---------- 5. 滑音手柄 ----------
  const gh = await p.evaluate(() => {
    const S = window.__diva.state, tot = S.total || 1, GX = 372, GW = 900, ROWH = 15, TOP_MIDI = 84, GY = 100;
    const rowY = m => GY + (TOP_MIDI - m) * ROWH;
    const g = S.notes[11], pv = S.notes[10], gp = g.glide / tot * GW;
    return { hx: GX + g.t / tot * GW - gp / 2, hy: (rowY(pv.midi) + rowY(g.midi)) / 2 + ROWH / 2 - 1 };
  });
  const before = (await st()).glide11;
  await drag(gh.hx, gh.hy, -30, 0);
  s = await st(); ok('拖滑音手柄(向左) → 变长', s.glide11 > before, before + ' → ' + s.glide11);

  // ---------- 6. 四个旋钮 ----------
  const PARX = [8, 192, 376, 560], PARW = 176, PARY = 712, PARH = 88;
  for (let i = 0; i < 4; i++) {
    const b0 = (await st()).params;
    await drag(PARX[i] + 46, PARY + PARH / 2, 0, -40);
    const b1 = (await st()).params;
    const ids = ['breath', 'bright', 'vib', 'gain'];
    ok('旋钮 ' + ids[i] + ' 上拖 → 变大', b1[ids[i]] > b0[ids[i]], b0[ids[i]] + ' → ' + b1[ids[i]]);
  }

  // ---------- 7. GLITCH 开关 + 量 ----------
  const b2 = (await st()).params;
  await click(748 + 23, 712 + 25);
  let g2 = (await st()).params; ok('GLITCH 开关 → 翻转', g2.glitchOn !== b2.glitchOn, b2.glitchOn + ' → ' + g2.glitchOn);
  await click(748 + 23, 712 + 25);                             // 翻回来
  await drag(748 + 100, 712 + 66, -80, 0);                     // 绝对定位：释放点 x=768 → u=(768-760)/176=0.045
  g2 = (await st()).params; ok('GLITCH 量条 → 跟随释放点', Math.abs(g2.glitch - (768 - 760) / 176) < 0.03, '0.2 → ' + g2.glitch);

  // ---------- 8. 传输 / 按钮 ----------
  await click(332, 31);                                        // ▶
  await p.waitForTimeout(900);
  s = await st(); ok('▶ 播放', s.playing === 1, 'playing=' + s.playing);
  await click(382, 31);                                        // ■
  await p.waitForTimeout(300);
  s = await st(); ok('■ 停止', s.playing === 0, 'playing=' + s.playing);
  await click(616, 683);                                       // 清空
  s = await st(); ok('清空 → 0 音', s.notes === 0, 'notes=' + s.notes);
  await click(504, 683);                                       // 示例
  s = await st(); ok('示例 → 13 音', s.notes === 13, 'notes=' + s.notes);

  // ---------- 9. 五十音拗音格（滑音音节） ----------
  await click(TAB_L + 8 + tw * 3.5, 98);                       // 拗音页
  await click(8 + 4 + ((LW - 8) / 3) * 0.5, 108 + chx * 0.5);  // きゃ
  s = await st(); ok('拗音格 きゃ → 试听', /きゃ|kya/.test(s.status), s.status);

  // ---------- 10. 卷帘空白处添加音符 ----------
  await click(616, 683);                                       // 清空
  await click(1020, 242);                                      // 空白处（默认 8s 画布上添加）
  s = await st(); ok('清空后空白添加 → 1 音', s.notes === 1, 'notes=' + s.notes);
  await click(504, 683);                                       // 示例恢复
  s = await st(); ok('示例恢复 → 13 音', s.notes === 13, 'notes=' + s.notes);

  await p.screenshot({ path: path.join(OUT, 'audit-final.png') });
  console.log(res.join('\n'));
  console.log('console errors/warnings: ' + errs.length + (errs.length ? ' :: ' + JSON.stringify(errs.slice(0, 6)) : ''));
  fs.writeFileSync(path.join(OUT, 'audit-report.txt'), res.join('\n') + '\nconsole errors: ' + errs.length + '\n', 'utf8');
  await b.close();
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
