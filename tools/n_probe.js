/* n_probe.js — 渲染"ん/な行"专项探测（当前引擎 → test/nprobe-*.wav）
 * 用法: node tools/n_probe.js [tag]
 * 探测：① ん单音 ② な ③ い→ん 接缝 ④ いちばん 片段（demo 同款）
 */
const fs = require('fs'), path = require('path');
const PW = 'C:/Users/lenovo/AppData/Roaming/npm/node_modules/openclaw/node_modules/playwright-core';
const { chromium } = require(PW);
const OUT = 'D:/OpenClawTemp/diva-web/test';
const TAG = process.argv[2] || 'cur';

const PROBES = {
  n_solo: [{ t: 0, d: 700, midi: 65, cons: 10, vowel: null, glide: 0 }],
  na: [{ t: 0, d: 700, midi: 65, cons: 9, vowel: 0, glide: 0 }],
  i_n: [
    { t: 0, d: 450, midi: 67, cons: 0, vowel: 1, glide: 0 },
    { t: 560, d: 450, midi: 65, cons: 10, vowel: null, glide: 0 }
  ],
  ichiban: [
    { t: 0, d: 500, midi: 65, cons: 0, vowel: 1, glide: 0 },
    { t: 530, d: 204, midi: 67, cons: 2, vowel: 1, glide: 0 },
    { t: 744, d: 337, midi: 68, cons: 17, vowel: 0, glide: 0 },
    { t: 1189, d: 93, midi: 67, cons: 10, vowel: null, glide: 0 },
    { t: 1330, d: 400, midi: 65, cons: 0, vowel: 4, glide: 0 }
  ]
};

(async () => {
  const b = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true, args: ['--allow-file-access-from-files', '--mute-audio'] });
  const p = await b.newPage({ viewport: { width: 1000, height: 700 } });
  p.on('pageerror', e => console.error('PAGEERROR', e.message));
  await p.goto('file:///D:/OpenClawTemp/diva-web/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(300);
  for (const name of Object.keys(PROBES)) {
    const r = await p.evaluate(async (notes) => {
      const res = await window.DivaEngine.render({
        notes, params: { breath: 0.28, bright: 0.55, vib: 0, gain: -10, puff: 0.35, glitch: 0.2, glitchOn: 0 },
        loops: 1, leadMs: 300, tailMs: 700, sampleRate: 44100
      });
      const blob = window.DIVA_WAV.encodeWav(res.buffer);
      const b64 = await new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(fr.result.split(',')[1]); fr.readAsDataURL(blob); });
      const st = window.DIVA_WAV.rmsPeak(res.buffer);
      return { b64, st };
    }, PROBES[name]);
    const f = 'nprobe-' + TAG + '-' + name + '.wav';
    fs.writeFileSync(path.join(OUT, f), Buffer.from(r.b64, 'base64'));
    console.log(JSON.stringify({ file: f, rms: r.st.rms, peak: r.st.peak, sec: r.st.seconds }));
  }
  await b.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
