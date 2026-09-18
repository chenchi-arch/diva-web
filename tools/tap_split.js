/* tap_split.js — 用 Max 自己的抽头把差异拆成「声源」vs「共振峰组」
 *   tap1 = SRCS（声源总线）  tap2 = VTRIM（共振峰组输出 ×0.5）
 *   ① Max 声源逐谐波谱  vs  我方声源（解析合成）
 *   ② Max 共振峰组传递函数（tap2/tap1） vs 我方 reson2 解析响应
 * 用法: node tools/tap_split.js <tap1.wav> <tap2.wav> [--pitches 293.66,440,523.25]
 */
const fs = require('fs'), path = require('path');
const SR = 44100;
function readWav(p) {
  const b = fs.readFileSync(p); let off = 12, fmt = null, data = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4), sz = b.readUInt32LE(off + 4), body = off + 8;
    if (id === 'fmt ') fmt = { channels: b.readUInt16LE(body + 2), sr: b.readUInt32LE(body + 4), bits: b.readUInt16LE(body + 14) };
    else if (id === 'data') data = { off: body, len: Math.min(sz, b.length - body) };
    off = body + sz + (sz % 2);
  }
  const nch = fmt.channels, bytes = fmt.bits / 8, n = Math.floor(data.len / (bytes * nch));
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let c = 0; c < nch; c++) s += b.readInt16LE(data.off + (i * nch + c) * bytes) / 32768; x[i] = s / nch; }
  return { sr: fmt.sr, x };
}
function g(x, f, a, b) { const w = 2 * Math.PI * f / SR, c = 2 * Math.cos(w); let s0 = 0, s1 = 0, s2 = 0; const n = b - a; for (let i = a; i < b; i++) { s0 = x[i] + c * s1 - s2; s2 = s1; s1 = s0; } return Math.sqrt(Math.abs(s1 * s1 + s2 * s2 - c * s1 * s2)) / n; }
function rms(x, a, b) { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / (b - a)); }
function onsets(x, gap) {
  const w = Math.floor(0.01 * SR), e = [];
  for (let i = 0; i + w <= x.length; i += w) e.push(rms(x, i, i + w));
  const mx = Math.max.apply(null, e), th = mx * 0.35, out = []; let armed = true;
  for (let i = 0; i < e.length; i++) { if (armed && e[i] > th && (i === 0 || e[i - 1] <= th)) { const t = i * 10; if (!out.length || t - out[out.length - 1] >= gap) { out.push(t); armed = false; } } if (e[i] < mx * 0.15) armed = true; }
  return out;
}
// ---- Max reson~ 解析响应（官方公式）----
function resonMag(cf, q, gain, f) {
  const bw = cf / Math.max(0.01, q), r = Math.exp(-Math.PI * bw / SR);
  const b = [gain * (1 - r), 0, -gain * (1 - r) * r];
  const a = [1, -2 * r * Math.cos(2 * Math.PI * cf / SR), r * r];
  const w = 2 * Math.PI * f / SR;
  let nr = 0, ni = 0, dr = 0, di = 0;
  for (let k = 0; k < 3; k++) { nr += b[k] * Math.cos(-w * k); ni += b[k] * Math.sin(-w * k); dr += a[k] * Math.cos(-w * k); di += a[k] * Math.sin(-w * k); }
  return Math.hypot(nr, ni) / Math.hypot(dr, di);
}
const P = { 0: [[850, 70], [1200, 90], [2800, 120], [3500, 150]], 1: [[300, 70], [2300, 90], [3000, 120], [3600, 150]], 2: [[350, 70], [1250, 90], [2300, 120], [3200, 150]], 3: [[550, 70], [2000, 90], [2600, 120], [3400, 150]], 4: [[500, 70], [900, 90], [2600, 120], [3300, 150]] };
const GT = [0.9, 0.95, 0.9, 0.8];
function bankResp(vowel, f) { let s = 0; for (let k = 0; k < 4; k++) s += resonMag(P[vowel][k][0], P[vowel][k][0] / P[vowel][k][1], GT[k], f); return s * 0.5; }
// ---- 我方声源解析（saw 0.2 + 窄脉冲 1.0 -> tilt(+presence)）----
function mySourceMag(n, f0, sawLev, trainLev) {
  const twoNpi = 2 / (n * Math.PI);
  const saw = sawLev * twoNpi;                  // band-limited saw 谐波
  const duty = 0.03 / 2.2727;
  const pulse = trainLev * Math.abs(2 * Math.sin(n * Math.PI * duty) / (n * Math.PI));
  const sum = saw + pulse;
  // tilt: onepole~ 6230 (Max 公式) -> |H|=a/|1-(1-a)e^-jw|
  const a = Math.sin(2 * Math.PI * 6230 / (SR / 2)), w = 2 * Math.PI * f0 * n / SR;
  const tilt = a / Math.hypot(1 - (1 - a) * Math.cos(w), (1 - a) * Math.sin(w));
  // 存在感：press = tilt*(1 + 3.4*HP700)
  const a2 = Math.sin(2 * Math.PI * 700 / (SR / 2));
  const lp = a2 / Math.hypot(1 - (1 - a2) * Math.cos(w), (1 - a2) * Math.sin(w));
  return sum * tilt * (1 + 3.4 * (1 - lp));
}
const argv = process.argv.slice(2);
const A = readWav(argv[0]), B = readWav(argv[1]);
const pitches = [293.66, 440.0, 523.25], V = ['a', 'i', 'u', 'e', 'o'];
const oa = onsets(A.x, 600), ob = onsets(B.x, 600);
console.log('tap1 onsets=' + oa.length + '  tap2 onsets=' + ob.length);
console.log('\n== ① 声源逐谐波（Max tap1 实测 dB  vs  我方解析 dB，各自以 h8 归一）==');
for (let note = 0; note < 3; note++) {
  const t = oa[note * 5 + 0]; if (t === undefined) continue;
  const a0 = Math.floor((t + 300) * SR / 1000), a1 = Math.floor((t + 700) * SR / 1000);
  const f0 = pitches[note];
  let line = '  ' + ['D4', 'A4', 'C5'][note] + '/a  n:';
  const rows = [];
  for (let n = 1; n <= 10; n++) rows.push({ n, max: g(A.x, f0 * n, a0, a1), my: mySourceMag(n, f0, 0.2, 1.0) });
  const ref = rows[7] ? rows[7] : rows[0];
  for (const r of rows) line += ' ' + r.n + ':' + (20 * Math.log10(r.max / ref.max)).toFixed(1) + '/' + (20 * Math.log10(r.my / ref.my)).toFixed(1);
  console.log(line);
}
console.log('\n== ② 共振峰组传递函数（Max tap2-tap1 实测 dB  vs  我方 reson2 解析 dB）==');
for (let note = 0; note < 3; note++) for (let v = 0; v < 5; v++) {
  const idx = note * 5 + v, t1 = oa[idx], t2 = ob[idx];
  if (t1 === undefined || t2 === undefined) continue;
  const a0 = Math.floor((t1 + 300) * SR / 1000), a1 = Math.floor((t1 + 700) * SR / 1000);
  const b0 = Math.floor((t2 + 300) * SR / 1000), b1 = Math.floor((t2 + 700) * SR / 1000);
  const f0 = pitches[note];
  let line = '  ' + ['D4', 'A4', 'C5'][note] + '/' + V[v] + '  n:';
  for (let n = 1; n <= 8; n++) {
    const m1 = g(A.x, f0 * n, a0, a1), m2 = g(B.x, f0 * n, b0, b1);
    const meas = 20 * Math.log10((m2 + 1e-12) / (m1 + 1e-12));
    const my = 20 * Math.log10(bankResp(v, f0 * n) + 1e-12);
    line += ' ' + n + ':' + meas.toFixed(1) + '/' + my.toFixed(1);
  }
  console.log(line);
}
