/* n_analyze.js — 对 n 探测 WAV 做包络/频谱分析
 * 用法: node tools/n_analyze.js test/nprobe-cur-n_solo.wav [t0 t1]
 * 输出：10ms 粒度 RMS 包络摘要（含首 200ms 逐窗）、分带占比、谱重心
 * 另：node tools/n_analyze.js --pair <wavA> <wavB>  并排对比摘要
 */
const fs = require('fs');
function readWav(p) {
  const b = fs.readFileSync(p);
  let pos = 12, fmt = null, data = null;
  while (pos + 8 <= b.length) {
    const id = b.toString('ascii', pos, pos + 4);
    const sz = b.readUInt32LE(pos + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(pos + 10), sr: b.readUInt32LE(pos + 12), bits: b.readUInt16LE(pos + 22) };
    else if (id === 'data') data = b.slice(pos + 8, Math.min(pos + 8 + sz, b.length));
    pos += 8 + sz + (sz & 1);
  }
  const n = Math.floor(data.length / 2 / fmt.ch);
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = data.readInt16LE(i * 2 * fmt.ch) / 32768;
  return { x, fs: fmt.sr };
}
function fftPowers(frame) {
  const L = frame.length; const re = new Float64Array(L), im = new Float64Array(L);
  for (let i = 0; i < L; i++) re[i] = frame[i];
  for (let i = 1, j = 0; i < L; i++) { let bit = L >> 1; for (; j & bit; bit >>= 1)j ^= bit; j ^= bit; if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; } }
  for (let len = 2; len <= L; len <<= 1) { const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < L; i += len) { let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) { const ur = re[i + j], ui = im[i + j], jr = i + j + len / 2;
        const vr = re[jr] * cr - im[jr] * ci, vi = re[jr] * ci + im[jr] * cr;
        re[i + j] = ur + vr; im[i + j] = ui + vi; re[jr] = ur - vr; im[jr] = ui - vi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr; } } }
  const P = new Float64Array(L / 2);
  for (let i = 0; i < L / 2; i++) P[i] = re[i] * re[i] + im[i] * im[i];
  return P;
}
function analyze(p, a, b) {
  const { x, fs } = readWav(p);
  const W = 441; // 10ms
  const seg = [];
  for (let s = 0; s + W <= x.length; s += W) { let e = 0; for (let i = 0; i < W; i++) e += x[s + i] * x[s + i]; seg.push(Math.sqrt(e / W)); }
  console.log('== ' + p + ' == dur=' + (x.length / fs).toFixed(2) + 's');
  const i0 = a === undefined ? 0 : Math.round(a * 100), i1 = b === undefined ? seg.length : Math.round(b * 100);
  let head = [];
  for (let i = Math.max(0, i0); i < Math.min(seg.length, i0 + 30); i++) head.push(seg[i].toFixed(4));
  console.log('envelope[first 300ms of range]: ' + head.join(' '));
  // max step between consecutive windows in range
  let maxStep = 0, maxAt = 0;
  for (let i = Math.max(1, i0); i < Math.min(seg.length, i1); i++) { const d = Math.abs(seg[i] - seg[i - 1]); if (d > maxStep) { maxStep = d; maxAt = i; } }
  console.log('max |dRMS| between 10ms windows in range: ' + maxStep.toFixed(4) + ' @ ' + (maxAt / 100).toFixed(2) + 's');
  // spectrum over range (middle 60%)
  const A = Math.round(Math.max(0, i0) * W + (i1 - i0) * W * 0.2), B = Math.round(Math.min(seg.length, i1) * W - (i1 - i0) * W * 0.2);
  const Lf = 8192; const acc = new Float64Array(Lf / 2); let fr = 0;
  for (let s = A; s + Lf < B; s += Lf / 2) { const f = new Float64Array(Lf); for (let i = 0; i < Lf; i++) f[i] = x[s + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (Lf - 1))); const P = fftPowers(f); for (let i = 0; i < Lf / 2; i++) acc[i] += P[i]; fr++; }
  if (fr > 0) {
    const binHz = fs / Lf; const bands = [[0, 200], [200, 1000], [1000, 2000], [2000, 4000], [4000, 8000]];
    let tot = 0, num = 0; const be = bands.map(() => 0);
    for (let i = 1; i < Lf / 2; i++) { const fHz = i * binHz; if (fHz > 8000) break; const e = acc[i]; tot += e; num += fHz * e;
      for (let q = 0; q < bands.length; q++) if (fHz >= bands[q][0] && fHz < bands[q][1]) be[q] += e; }
    console.log('bands: ' + bands.map((bb, q) => bb[0] + '-' + bb[1] + ': ' + (100 * be[q] / tot).toFixed(1) + '%').join('  '));
    console.log('centroid: ' + (num / tot).toFixed(0) + ' Hz');
  }
}
const argv = process.argv.slice(2);
if (argv[0] === '--pair') {
  analyze(argv[1]); console.log(''); analyze(argv[2]);
} else {
  analyze(argv[0], argv[1] === undefined ? undefined : Number(argv[1]), argv[2] === undefined ? undefined : Number(argv[2]));
}
