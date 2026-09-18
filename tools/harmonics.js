/* harmonics.js — 逐谐波对比（定位差异来自“声源频谱”还是“共振峰组”）
 * 用法: node tools/harmonics.js <ref.wav> <web.wav> --t0 4300 --t1 4480 --f0 349.23
 */
const fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');
const SR = 44100, N = 8192;
function readWav(p) {
  const b = fs.readFileSync(p); let off = 12, fmt = null, data = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4), sz = b.readUInt32LE(off + 4), body = off + 8;
    if (id === 'fmt ') fmt = { channels: b.readUInt16LE(body + 2), sr: b.readUInt32LE(body + 4), bits: b.readUInt16LE(body + 14) };
    else if (id === 'data') data = { off: body, len: Math.min(sz, b.length - body) };
    off = body + sz + (sz % 2);
  }
  const nch = fmt.channels, bytes = fmt.bits / 8, n = Math.floor(data.len / (bytes * nch));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let c = 0; c < nch; c++) s += b.readInt16LE(data.off + (i * nch + c) * bytes) / 32768; out[i] = s / nch; }
  return { sr: fmt.sr, x: out };
}
function load(p) {
  if (/\.wav$/i.test(p)) return readWav(p);
  const d = path.join(path.dirname(p), '_dec3_' + path.basename(p).replace(/\W+/g, '_') + '.wav');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', p, '-ac', '1', '-ar', String(SR), '-c:a', 'pcm_s16le', d]);
  return readWav(d);
}
const argv = process.argv.slice(2);
let t0 = 4300, t1 = 4480, f0 = 349.23;
const files = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--t0') t0 = +argv[++i]; else if (argv[i] === '--t1') t1 = +argv[++i];
  else if (argv[i] === '--f0') f0 = +argv[++i]; else files.push(argv[i]);
}
function goertzel(x, sr, freq, a, b) {
  const w = 2 * Math.PI * freq / sr, c = 2 * Math.cos(w);
  let s0 = 0, s1 = 0, s2 = 0;
  const n = b - a;
  for (let i = a; i < b; i++) { s0 = x[i] + c * s1 - s2; s2 = s1; s1 = s0; }
  return Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2) / n;
}
const A = load(files[0]), B = load(files[1]);
const a0 = Math.floor(t0 * SR / 1000), a1 = Math.floor(t1 * SR / 1000);
console.log('window ' + t0 + '-' + t1 + 'ms  f0=' + f0 + 'Hz');
console.log('  n    Hz     ref(dB)   web(dB)   d(dB)');
let sR = 0, sW = 0, nR = 0, nW = 0;
const rows = [];
for (let n = 1; n <= 24; n++) {
  const f = f0 * n;
  if (f > 16000) break;
  const R = goertzel(A.x, A.sr, f, a0, a1), W = goertzel(B.x, B.sr, f, a0, a1);
  sR += R * R; sW += W * W; nR++; nW++;
  const dR = 20 * Math.log10(R + 1e-12), dW = 20 * Math.log10(W + 1e-12);
  rows.push({ n, f: Math.round(f), R, W, d: dR - dW });
  console.log('  ' + String(n).padStart(2) + '  ' + String(Math.round(f)).padStart(6) + '  ' + dR.toFixed(1).padStart(7) + '  ' + dW.toFixed(1).padStart(7) + '  ' + (dR - dW).toFixed(1).padStart(6));
}
// 归一化到总谐波能量，看“相对”频谱是否一致
console.log('\n  归一化（各谐波占总谐波能量 dB）:');
for (const r of rows) {
  const nr = 20 * Math.log10(r.R / Math.sqrt(sR)), nw = 20 * Math.log10(r.W / Math.sqrt(sW));
  console.log('  n=' + String(r.n).padStart(2) + '  ref ' + nr.toFixed(1).padStart(6) + '   web ' + nw.toFixed(1).padStart(6) + '   Δ ' + (nr - nw).toFixed(1).padStart(5));
}
