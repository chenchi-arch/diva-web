/* ============================================================================
 * ab_bench.js — 稳态元音测试台 A/B：Max 录音 vs 网页版渲染（逐音对比）
 *   15 音顺序：D4[a i u e o] A4[a i u e o] C5[a i u e o]
 * 用法: node tools/ab_bench.js <maxBench.wav> <webBench.wav>
 * ========================================================================== */
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
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let c = 0; c < nch; c++) s += b.readInt16LE(data.off + (i * nch + c) * bytes) / 32768; x[i] = s / nch; }
  return { sr: fmt.sr, x };
}
function load(p) {
  if (/\.wav$/i.test(p)) return readWav(p);
  const d = path.join(path.dirname(p), '_dec4_' + path.basename(p).replace(/\W+/g, '_') + '.wav');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', p, '-ac', '1', '-ar', String(SR), '-c:a', 'pcm_s16le', d]); return readWav(d);
}
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let cw = 1, ci = 0; for (let k = 0; k < len / 2; k++) {
      const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cw - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cw;
      re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
      const nw = cw * wr - ci * wi; ci = cw * wi + ci * wr; cw = nw; } }
  }
}
const win = new Float64Array(N);
for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
function spec(x, a, b) {
  const acc = new Float64Array(N / 2 + 1); let fr = 0;
  for (let st = a; st + N <= b; st += N / 2) {
    const re = new Float64Array(N), im = new Float64Array(N);
    let e = 0; for (let i = 0; i < N; i++) { const v = x[st + i]; e += v * v; re[i] = v * win[i]; }
    if (Math.sqrt(e / N) < 1e-5) continue;
    fft(re, im); for (let k = 0; k <= N / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k]; fr++;
  }
  return { acc, fr: Math.max(1, fr) };
}
const DF = SR / N;
function stats(acc, fr) {
  const BANDS = [[20, 200], [200, 1000], [1000, 4000], [4000, 8000], [8000, 16000]];
  const band = BANDS.map(() => 0); let tot = 0, cn = 0;
  for (let k = 1; k <= N / 2; k++) { const f = k * DF, p = acc[k]; if (f < 20 || f > 16000) continue; tot += p; cn += f * p; for (let q = 0; q < 5; q++) if (f >= BANDS[q][0] && f < BANDS[q][1]) band[q] += p; }
  return { tot, centroid: tot ? cn / tot : 0, shares: band.map(v => (tot ? v / tot * 100 : 0)) };
}
function rms(x, a, b) { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / (b - a)); }
// 找音的起始：10ms 包络 + 上升沿跨阈 + 最小间隔（对连续底噪更鲁棒）
function onsets(x, minGapMs) {
  const w = Math.floor(0.01 * SR), e = [];
  for (let i = 0; i + w <= x.length; i += w) e.push(rms(x, i, i + w));
  const mx = Math.max.apply(null, e);
  const th = mx * 0.35;
  const out = [];
  let armed = true;
  for (let i = 0; i < e.length; i++) {
    if (armed && e[i] > th && (i === 0 || e[i - 1] <= th)) {
      const t = i * 10;
      if (!out.length || t - out[out.length - 1] >= (minGapMs || 600)) { out.push(t); armed = false; }
    }
    if (e[i] < mx * 0.15) armed = true;
  }
  return { list: out, max: mx };
}
const A = load(process.argv[2]), B = load(process.argv[3]);
const oa = onsets(A.x), ob = onsets(B.x);
console.log('Max  onsets=' + oa.list.length + ' [' + oa.list.slice(0, 16).join(',') + ']  dur=' + (A.x.length / SR).toFixed(2) + 's  lvl=' + oa.max.toFixed(4));
console.log('Web  onsets=' + ob.list.length + ' [' + ob.list.slice(0, 16).join(',') + ']  dur=' + (B.x.length / SR).toFixed(2) + 's  lvl=' + ob.max.toFixed(4));
const V = ['a', 'i', 'u', 'e', 'o'], P = ['D4', 'A4', 'C5'];
console.log('\n#  note      | Max  centroid  share200-1k/1-4k/4-8k  rms    | Web  centroid  share200-1k/1-4k/4-8k  rms');
const rows = [];
for (let i = 0; i < 15; i++) {
  const ta = oa.list[i], tb = ob.list[i];
  if (ta === undefined || tb === undefined) { console.log(i + ' MISSING (max=' + (ta !== undefined) + ' web=' + (tb !== undefined) + ')'); continue; }
  const a0 = Math.floor((ta + 300) * SR / 1000), a1 = Math.min(A.x.length, Math.floor((ta + 700) * SR / 1000));
  const b0 = Math.floor((tb + 300) * SR / 1000), b1 = Math.min(B.x.length, Math.floor((tb + 700) * SR / 1000));
  const sa = stats(spec(A.x, a0, a1).acc, 1), sb = stats(spec(B.x, b0, b1).acc, 1);
  const pr = rms(A.x, a0, a1), pw = rms(B.x, b0, b1);
  const lab = P[Math.floor(i / 5)] + '/' + V[i % 5];
  console.log(String(i).padStart(2) + ' ' + lab.padEnd(6) + ' | ' + sa.centroid.toFixed(0).padStart(6) + 'Hz  ' +
    sa.shares[1].toFixed(1).padStart(5) + '/' + sa.shares[2].toFixed(1).padStart(5) + '/' + sa.shares[3].toFixed(1).padStart(4) + '   ' + pr.toFixed(4) +
    ' | ' + sb.centroid.toFixed(0).padStart(6) + 'Hz  ' +
    sb.shares[1].toFixed(1).padStart(5) + '/' + sb.shares[2].toFixed(1).padStart(5) + '/' + sb.shares[3].toFixed(1).padStart(4) + '   ' + pw.toFixed(4));
  rows.push({ i, lab, ca: sa.centroid, cb: sb.centroid, a: sa.shares, b: sb.shares });
}
if (rows.length) {
  const avg = (f) => rows.reduce((s, r) => s + f(r), 0) / rows.length;
  console.log('\n平均: Max centroid ' + avg(r => r.ca).toFixed(0) + 'Hz  Web ' + avg(r => r.cb).toFixed(0) + 'Hz   Δ ' + (avg(r => r.cb) - avg(r => r.ca)).toFixed(0) + 'Hz');
  console.log('平均占比 200-1k: Max ' + avg(r => r.a[1]).toFixed(1) + '%  Web ' + avg(r => r.b[1]).toFixed(1) + '%');
  console.log('平均占比 1-4k : Max ' + avg(r => r.a[2]).toFixed(1) + '%  Web ' + avg(r => r.b[2]).toFixed(1) + '%');
  console.log('平均占比 4-8k : Max ' + avg(r => r.a[3]).toFixed(1) + '%  Web ' + avg(r => r.b[3]).toFixed(1) + '%');
}
