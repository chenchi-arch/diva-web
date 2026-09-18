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

  await p.screenshot({ path: path.join(OUT, 'add-note.png') });
  console.log(res.join('\n'));
  console.log('console errors/warnings: ' + errs.length + (errs.length ? ' :: ' + JSON.stringify(errs.slice(0, 6)) : ''));
  fs.writeFileSync(path.join(OUT, 'add-report.txt'), res.join('\n') + '\nconsole errors: ' + errs.length + '\n', 'utf8');
  await b.close();
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
