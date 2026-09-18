/* ============================================================================
 * probe_variants.js — 变体探针：在页面内离线渲染若干参数组合，用于定位音色差异来源
 *   V0 默认（glitch 0.2 开）  V1 毛刺关  V2 毛刺关+亮度 0.85  V3 毛刺全湿(1.0)
 * 用法：node tools/probe_variants.js
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const PW = 'C:/Users/lenovo/AppData/Roaming/npm/node_modules/openclaw/node_modules/playwright-core';
const { chromium } = require(PW);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = 'D:/OpenClawTemp/diva-web/test';

const VARIANTS = [
  ['v0-default', { breath: 0.28, bright: 0.85, vib: 30, gain: -10, puff: 0.35, glitch: 0.2, glitchOn: 1, presG: 3.4 }],
  ['p15', { breath: 0.28, bright: 0.85, vib: 30, gain: -10, puff: 0.35, glitch: 0.2, glitchOn: 1, presG: 1.5 }],
  ['p00', { breath: 0.28, bright: 0.85, vib: 30, gain: -10, puff: 0.35, glitch: 0.2, glitchOn: 1, presG: 0.0 }]
];

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--allow-file-access-from-files', '--mute-audio'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.on('pageerror', e => console.error('PAGEERROR', e.message));
  await page.goto('file:///D:/OpenClawTemp/diva-web/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(300);
  for (const [name, params] of VARIANTS) {
    const r = await page.evaluate(async (p) => {
      const res = await window.DivaEngine.render({ notes: window.__diva.state.notes, params: p, loops: 1, leadMs: 150, tailMs: 800, sampleRate: 44100 });
      const b64 = await new Promise(ok => { const b = window.DIVA_WAV.encodeWav(res.buffer); const fr = new FileReader(); fr.onload = () => ok(fr.result.split(',')[1]); fr.readAsDataURL(b); });
      const st = window.DIVA_WAV.rmsPeak(res.buffer);
      return { b64, rms: st.rms, peak: st.peak, sec: st.seconds };
    }, params);
    fs.writeFileSync(path.join(OUT, name + '.wav'), Buffer.from(r.b64, 'base64'));
    console.log(name + '  rms=' + r.rms.toFixed(5) + ' peak=' + r.peak.toFixed(5) + ' dur=' + r.sec.toFixed(3));
  }
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
