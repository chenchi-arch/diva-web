/* sweep_bright.js — 亮度扫描：找与 Max 参考渲染最接近的 bright 等效值（用于量化“同参数下的音色偏差”） */
const fs = require('fs'), path = require('path');
const PW = 'C:/Users/lenovo/AppData/Roaming/npm/node_modules/openclaw/node_modules/playwright-core';
const { chromium } = require(PW);
const OUT = 'D:/OpenClawTemp/diva-web/test';
const LIST = [0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.85];
(async () => {
  const b = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true, args: ['--allow-file-access-from-files', '--mute-audio'] });
  const p = await b.newPage({ viewport: { width: 1000, height: 700 } });
  p.on('pageerror', e => console.error('PAGEERROR', e.message));
  await p.goto('file:///D:/OpenClawTemp/diva-web/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(300);
  for (const br of LIST) {
    const r = await p.evaluate(async (v) => {
      const res = await window.DivaEngine.render({
        notes: window.__diva.state.notes,
        params: { breath: 0.28, bright: v, vib: 30, gain: -10, puff: 0.35, glitch: 0.2, glitchOn: 1 },
        loops: 1, leadMs: 150, tailMs: 800, sampleRate: 44100
      });
      const wav = window.DIVA_WAV.encodeWav(res.buffer);
      const b64 = await new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(fr.result.split(',')[1]); fr.readAsDataURL(wav); });
      const st = window.DIVA_WAV.rmsPeak(res.buffer);
      return { b64, rms: st.rms };
    }, br);
    const f = 'bright-' + br.toFixed(2) + '.wav';
    fs.writeFileSync(path.join(OUT, f), Buffer.from(r.b64, 'base64'));
    console.log('bright=' + br + '  rms=' + r.rms.toFixed(5) + ' -> ' + f);
  }
  await b.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
