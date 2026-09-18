/* run_add.js — 卷帘「添加音符」专项测试：真实鼠标在空白处点击/拖拽，断言增量与参数
 * 用法: node tools/run_add.js
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
  const st = () => p.evaluate(() => { const S = window.__diva.state; return { n: S.notes.length, total: S.total, status: S.status }; });
  const res = [];
  const ok = (name, cond, detail) => { res.push((cond ? 'PASS ' : '**FAIL** ') + name + (detail ? '  [' + detail + ']' : '')); };
  async function click(dx, dy) { const [x, y] = D(dx, dy); await p.mouse.move(x, y); await p.mouse.down(); await p.waitForTimeout(35); await p.mouse.up(); await p.waitForTimeout(160); }
  async function drag(dx, dy, ddx, ddy, steps) {
    const [x, y] = D(dx, dy); await p.mouse.move(x, y); await p.mouse.down();
    const n = steps || 6;
    for (let s = 1; s <= n; s++) { await p.mouse.move(x + (ddx * sx) * s / n, y + (ddy * sy) * s / n); await p.waitForTimeout(28); }
    await p.mouse.up(); await p.waitForTimeout(180);
  }

  // 0) 初始 = 示例 13 音
  let s = await st(); ok('初始 13 音', s.n === 13, 'notes=' + s.n);

  // 1) 空白处单击 → +1 音（midi=75, t≈4625）
  await click(1020, 242);
  const n14 = await p.evaluate(() => {
    const S = window.__diva.state, nn = S.notes.filter(x => x.midi === 75);
    return { n: S.notes.length, add: nn.length, d: nn[0] && nn[0].d, t: nn[0] && nn[0].t, r: nn[0] && nn[0].r, status: S.status };
  });
  ok('空白单击 → +1 音', n14.n === 14 && n14.add === 1, 'notes=' + n14.n + ' midi75=' + n14.add);
  ok('新音符默认 500ms / 假名 a', n14.d === 500 && n14.r === 'a', 'd=' + n14.d + ' r=' + n14.r);
  ok('新音符 t 吸附 125ms 网格', n14.t % 125 === 0, 't=' + n14.t);
  ok('状态提示已添加', /已添加/.test(n14.status), n14.status);

  // 2) 空白处拖拽 → +1 音且长度 > 500
  await drag(700, 317, 120, 0);
  const n15 = await p.evaluate(() => {
    const S = window.__diva.state, nn = S.notes.filter(x => x.midi === 70);
    return { n: S.notes.length, d: nn[0] && nn[0].d, t: nn[0] && nn[0].t, status: S.status };
  });
  ok('空白拖拽 → +1 音', n15.n === 15 && n15.d, 'notes=' + n15.n + ' d=' + n15.d);
  ok('拖拽后长度 > 500', n15.d > 500, 'd=' + n15.d);

  // 3) 邻近已有音符（同音高同格）→ 不新增
  await click(654, 422);
  s = await st(); ok('占位处点击 → 不新增', s.n === 15, 'notes=' + s.n + ' status=' + s.status);

  // 4) 清空 → 空白添加（total 从 0 起步 → 默认 8000）
  await click(616, 683);
  let s0 = await st(); ok('清空 → 0 音', s0.n === 0 && s0.total === 0, JSON.stringify(s0));
  await click(800, 200);
  const s1 = await p.evaluate(() => { const S = window.__diva.state; return { n: S.notes.length, total: S.total, t: S.notes[0] && S.notes[0].t, midi: S.notes[0] && S.notes[0].midi }; });
  ok('清空后空白添加 → 1 音且 total=8000', s1.n === 1 && s1.total === 8000, JSON.stringify(s1));
  ok('新音符位置正确（midi=78 附近）', s1.midi === 78, 'midi=' + s1.midi);

  // 5) 示例恢复
  await click(504, 683);
  s = await st(); ok('示例恢复 → 13 音', s.n === 13, 'notes=' + s.n);

  // 6) 拖动音符 = 移位/音高（ba: t=3558, midi=68 → +30px/-15px → t=3750, midi=69）
  const g6 = await p.evaluate(() => {
    const S = window.__diva.state, tot = S.total || 1, GX = 372, GW = 900, ROWH = 15, TOP_MIDI = 84, GY = 100;
    const rowY = m => GY + (TOP_MIDI - m) * ROWH;
    const n = S.notes.find(x => x.r === 'ba');
    return { x: GX + n.t / tot * GW + Math.max(7, n.d / tot * GW - 2) * 0.5, yc: rowY(n.midi) + ROWH / 2 - 1 };
  });
  await drag(g6.x, g6.yc, 30, -15);
  const r6 = await p.evaluate(() => { const n = window.__diva.state.notes.find(x => x.r === 'ba'); return { midi: n.midi, t: n.t }; });
  ok('拖动音符 → 移位+音高', r6.midi === 69 && r6.t === 3750, JSON.stringify(r6));

  // 7) 拖右缘 = 调长度（hi: 572ms → 变长）
  const g7 = await p.evaluate(() => {
    const S = window.__diva.state, tot = S.total || 1, GX = 372, GW = 900, ROWH = 15, TOP_MIDI = 84, GY = 100;
    const rowY = m => GY + (TOP_MIDI - m) * ROWH;
    const n = S.notes.find(x => x.r === 'hi');
    return { x: GX + n.t / tot * GW + Math.max(7, n.d / tot * GW - 2) - 3, yc: rowY(n.midi) + ROWH / 2 - 1, d: n.d };
  });
  await drag(g7.x, g7.yc, 50, 0);
  const r7 = await p.evaluate(() => { const n = window.__diva.state.notes.find(x => x.r === 'hi'); return { d: n.d }; });
  ok('拖右缘 → 调长度', r7.d > g7.d, g7.d + ' → ' + r7.d);

  // 8) 选中音符 → 点五十音格 填词；Esc 取消后恢复试听
  const ci = await p.evaluate(() => window.__diva.state.notes.findIndex(x => x.r === 'chi'));
  const g8 = await p.evaluate(() => {
    const S = window.__diva.state, tot = S.total || 1, GX = 372, GW = 900, ROWH = 15, TOP_MIDI = 84, GY = 100;
    const rowY = m => GY + (TOP_MIDI - m) * ROWH;
    const n = S.notes.find(x => x.r === 'chi');
    return { x: GX + n.t / tot * GW + Math.max(7, n.d / tot * GW - 2) * 0.5, yc: rowY(n.midi) + ROWH / 2 - 1 };
  });
  await click(g8.x, g8.yc);                                    // 选中 chi
  await click(8 + 4 + ((304 - 8) / 5) * 0.5, 108 + (552 / 11) * 1.5);   // 点 か
  const r8 = await p.evaluate((i) => { const n = window.__diva.state.notes[i]; return { cons: n.cons, vowel: n.vowel, r: n.r }; }, ci);
  ok('选中音符→点五十音格 填词', r8.cons === 1 && r8.vowel === 0 && r8.r === 'ka', JSON.stringify(r8));
  await p.keyboard.press('Escape');
  await click(8 + 4 + ((304 - 8) / 5) * 1.5, 108 + (552 / 11) * 0.5);   // 点 い
  s = await st(); ok('Esc 取消选择 → 恢复试听', /试听/.test(s.status), s.status);

  // 9) 选中音符 → 拖音尾圆点 = 滑音（de +2）；同一圆点横拖 = 长度；音头圆点 = -1
  const g9 = await p.evaluate(() => {
    const S = window.__diva.state, tot = S.total || 1, GX = 372, GW = 900, ROWH = 15, TOP_MIDI = 84, GY = 100;
    const rowY = m => GY + (TOP_MIDI - m) * ROWH;
    const n = S.notes.find(x => x.r === 'de');
    return { x: GX + n.t / tot * GW, w: Math.max(7, n.d / tot * GW - 2), yc: rowY(n.midi) + ROWH / 2 - 1, d: n.d };
  });
  await click(g9.x + g9.w * 0.5, g9.yc);                        // 选中 de
  await drag(g9.x + g9.w, g9.yc, 0, -30);                       // 音尾圆点向上 → +2 半音
  const r9 = await p.evaluate(() => { const n = window.__diva.state.notes.find(x => x.r === 'de'); const c = n.curve; return { last: c && c[c.length - 1].semi }; });
  ok('拖音尾圆点 → 滑音 +2.00', r9.last === 2, JSON.stringify(r9));
  await drag(g9.x + g9.w, g9.yc - 30, 40, 0);                   // 同一圆点水平拖 → 调长度
  const r10 = await p.evaluate(() => { const n = window.__diva.state.notes.find(x => x.r === 'de'); return { d: n.d }; });
  ok('选中态尾圆点横拖 → 调长度', r10.d > g9.d, g9.d + ' → ' + r10.d);
  await drag(g9.x, g9.yc, 0, 15);                               // 音头圆点向下 → -1 半音
  const r11 = await p.evaluate(() => { const n = window.__diva.state.notes.find(x => x.r === 'de'); return { first: n.curve && n.curve[0] && n.curve[0].semi }; });
  ok('拖音头圆点 → 滑音 -1.00', r11.first === -1, JSON.stringify(r11));

  // 10) 拖中间圆点 → 滑音 +1.00
  const gm = await p.evaluate(() => {
    const S = window.__diva.state, tot = S.total || 1, GX = 372, GW = 900, ROWH = 15, TOP_MIDI = 84, GY = 100;
    const rowY = m => GY + (TOP_MIDI - m) * ROWH;
    const n = S.notes.find(x => x.r === 'de');
    const c = (n.curve && n.curve.length >= 2) ? n.curve : [{ u: 0.5, semi: 0 }];
    const mid = c[Math.floor((c.length - 1) / 2)];
    return { x: GX + n.t / tot * GW + Math.max(7, n.d / tot * GW - 2) * mid.u, y: rowY(n.midi + mid.semi) + ROWH / 2 - 1 };
  });
  await drag(gm.x, gm.y, 0, -15);
  const rm = await p.evaluate(() => { const n = window.__diva.state.notes.find(x => x.r === 'de'); return { mid: n.curve && n.curve[1] && n.curve[1].semi }; });
  ok('拖中间圆点 → 滑音 +1.00', rm.mid === 1, JSON.stringify(rm));

  // 11) Delete 键删除 + Ctrl+Z 撤回
  const io = await p.evaluate(() => window.__diva.state.notes.findIndex(x => x.r === 'o'));
  const go = await p.evaluate((i) => {
    const S = window.__diva.state, tot = S.total || 1, GX = 372, GW = 900, ROWH = 15, TOP_MIDI = 84, GY = 100;
    const rowY = m => GY + (TOP_MIDI - m) * ROWH;
    const n = S.notes[i];
    return { x: GX + n.t / tot * GW + Math.max(7, n.d / tot * GW - 2) * 0.5, yc: rowY(n.midi) + ROWH / 2 - 1 };
  }, io);
  await click(go.x, go.yc);
  await p.keyboard.press('Delete');
  await p.waitForTimeout(200);
  const rd = await p.evaluate(() => ({ n: window.__diva.state.notes.length, o: window.__diva.state.notes.findIndex(x => x.r === 'o') }));
  ok('Delete 键 → 删除选中音符', rd.n === 12 && rd.o === -1, JSON.stringify(rd));
  await p.keyboard.press('Control+z');
  await p.waitForTimeout(200);
  const ru = await p.evaluate(() => ({ n: window.__diva.state.notes.length, o: window.__diva.state.notes.findIndex(x => x.r === 'o') }));
  ok('Ctrl+Z → 撤回删除', ru.n === 13 && ru.o >= 0, JSON.stringify(ru));

  // 12) 「撤回」按钮：加一个音符 → 点撤回 → 没了
  await click(1020, 242);
  const ra = await p.evaluate(() => window.__diva.state.notes.length);
  ok('加音符 → 14', ra === 14, 'n=' + ra);
  await click(408, 689);
  const rb = await p.evaluate(() => ({ n: window.__diva.state.notes.length, m75: window.__diva.state.notes.filter(x => x.midi === 75).length }));
  ok('「撤回」按钮 → 回到 13', rb.n === 13 && rb.m75 === 0, JSON.stringify(rb));

  await p.screenshot({ path: path.join(OUT, 'add-note.png') });
  console.log(res.join('\n'));
  console.log('console errors/warnings: ' + errs.length + (errs.length ? ' :: ' + JSON.stringify(errs.slice(0, 6)) : ''));
  fs.writeFileSync(path.join(OUT, 'add-report.txt'), res.join('\n') + '\nconsole errors: ' + errs.length + '\n', 'utf8');
  await b.close();
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
