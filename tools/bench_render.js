/* ============================================================================
 * bench_render.js — 在我方引擎里渲染与 Max 测试台完全相同的 15 个稳态元音
 *   测试台定义（build_diva02.js startTimbre）：
 *     pitches [293.66 D4, 440 A4, 523.25 C5] × vowel [a i u e o]
 *     顺序 for p for v ；gate 1100ms，间隔 140ms（周期 1240ms）
 *     参数：cons=0, vib=0, scoop=0, puff=0.35, bright=0.85, breath=0.28, gain=-10
 * 用法: node tools/bench_render.js [glitchOn 0|1]
 * ========================================================================== */
const fs = require('fs'), path = require('path');
const PW = 'C:/Users/lenovo/AppData/Roaming/npm/node_modules/openclaw/node_modules/playwright-core';
const { chromium } = require(PW);
const OUT = 'D:/OpenClawTemp/diva-web/test';
const gOn = process.argv[2] === '1' ? 1 : 0;
(async () => {
  const b = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true, args: ['--allow-file-access-from-files', '--mute-audio'] });
  const p = await b.newPage({ viewport: { width: 1000, height: 700 } });
  p.on('pageerror', e => console.error('PAGEERROR', e.message));
  await p.goto('file:///D:/OpenClawTemp/diva-web/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(300);
  const r = await p.evaluate(async (gOn) => {
    const pitches = [293.66, 440.0, 523.25], midiOf = [62, 69, 72];
    const notes = [];
    for (let q = 0; q < 3; q++) for (let v = 0; v < 5; v++)
      notes.push({ t: (q * 5 + v) * 1240, d: 1100, midi: midiOf[q], cons: 0, vowel: v, glide: 0 });
    const res = await window.DivaEngine.render({
      notes, params: { breath: 0.28, bright: 0.85, vib: 0, gain: -10, puff: 0.35, glitch: 0.2, glitchOn: gOn },
      loops: 1, leadMs: 400, tailMs: 900, sampleRate: 44100
    });
    const blob = window.DIVA_WAV.encodeWav(res.buffer);
    const b64 = await new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(fr.result.split(',')[1]); fr.readAsDataURL(blob); });
    const st = window.DIVA_WAV.rmsPeak(res.buffer);
    return { b64, st, notes };
  }, gOn);
  const f = 'bench-web-glitch' + gOn + '.wav';
  fs.writeFileSync(path.join(OUT, f), Buffer.from(r.b64, 'base64'));
  console.log(JSON.stringify({ file: f, rms: r.st.rms, peak: r.st.peak, sec: r.st.seconds, notes: r.notes.length }));
  await b.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
