/* ============================================================================
 * ab_detail.js — A/B 细诊断：逐 100ms 包络对齐 + 指定时窗的频带占比/频谱对比
 *   用法: node tools/ab_detail.js <ref.wav> <web.wav> [--w1 a,b --w2 c,d ...]
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const SR = 44100, N = 4096;

function readWav(p) {
  const b = fs.readFileSync(p);
  let off = 12, fmt = null, data = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4), sz = b.readUInt32LE(off + 4), body = off + 8;
    if (id === 'fmt ') fmt = { channels: b.readUInt16LE(body + 2), sr: b.readUInt32LE(body + 4), bits: b.readUInt16LE(body + 14) };
    else if (id === 'data') data = { off: body, len: Math.min(sz, b.length - body) };
    off = body + sz + (sz % 2);
  }
  const nch = fmt.channels, bytes = fmt.bits / 8, n = Math.floor(data.len / (bytes * nch));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < nch; c++) s += fmt.bits === 16 ? b.readInt16LE(data.off + (i * nch + c) * bytes) / 32768 : 0;
    out[i] = s / nch;
  }
  return { sr: fmt.sr, x: out };
}
function load(p) {
  if (/\.wav$/i.test(p)) return readWav(p);
  const d = path.join(path.dirname(p), '_dec2_' + path.basename(p).replace(/\W+/g, '_') + '.wav');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', p, '-ac', '1', '-ar', String(SR), '-c:a', 'pcm_s16le', d]);
  return readWav(d);
}
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cwr = 1, cwi = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cwr - im[i + k + len / 2] * cwi;
        const vi = re[i + k + len / 2] * cwi + im[i + k + len / 2] * cwr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nwr = cwr * wr - cwi * wi; cwi = cwr * wi + cwi * wr; cwr = nwr;
      }
    }
  }
}
function spectrum(x, sr, t0, t1) {
  const a = Math.max(0, Math.floor(t0 * sr / 1000)), b = Math.min(x.length, Math.floor(t1 * sr / 1000));
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
  const acc = new Float64Array(N / 2 + 1);
  let frames = 0;
  for (let st = a; st + N <= b; st += N / 2) {
    const re = new Float64Array(N), im = new Float64Array(N);
    let e = 0;
    for (let i = 0; i < N; i++) { const v = x[st + i]; e += v * v; re[i] = v * win[i]; }
    if (Math.sqrt(e / N) < 1e-5) continue;
    fft(re, im);
    for (let k = 0; k <= N / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
  }
  if (!frames) frames = 1;
  const df = sr / N, BANDS = [[20, 200], [200, 1000], [1000, 4000], [4000, 8000], [8000, 16000]];
  const band = BANDS.map(() => 0); let tot = 0, cn = 0;
  for (let k = 1; k <= N / 2; k++) {
    const f = k * df, p = acc[k];
    if (f < 20 || f > 16000) continue;
    tot += p; cn += f * p;
    for (let q = 0; q < BANDS.length; q++) if (f >= BANDS[q][0] && f < BANDS[q][1]) band[q] += p;
  }
  return {
    frames, band: BANDS.map((bb, i) => ({ b: bb[0] + '-' + bb[1], pct: tot ? +(band[i] / tot * 100).toFixed(2) : 0 })),
    centroid: tot ? Math.round(cn / tot) : 0, tot
  };
}
function env(x, sr, winMs) {
  const w = Math.floor(winMs * sr / 1000), out = [];
  for (let i = 0; i + w <= x.length; i += w) {
    let s = 0; for (let k = 0; k < w; k++) s += x[i + k] * x[i + k];
    out.push(Math.sqrt(s / w));
  }
  return out;
}

const argv = process.argv.slice(2);
const wins = [];
const files = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--w') { const p = argv[++i].split(','); wins.push([+p[0], +p[1]]); }
  else files.push(argv[i]);
}
const A = load(files[0]), B = load(files[1]);
console.log('ref : ' + files[0] + '  ' + (A.x.length / A.sr).toFixed(3) + 's');
console.log('web : ' + files[1] + '  ' + (B.x.length / B.sr).toFixed(3) + 's');

// ---- 逐 100ms 包络（dBFS），对齐前 7000ms ----
const ea = env(A.x, A.sr, 100), eb = env(B.x, B.sr, 100);
const db = v => v > 0 ? (20 * Math.log10(v)).toFixed(1) : '-inf';
console.log('\n--- 逐 100ms RMS(dBFS) : t(ms)  ref  web  d ---');
for (let i = 0; i < Math.min(ea.length, eb.length, 70); i++) {
  if (i % 2 === 0) console.log('  ' + String(i * 100).padStart(5) + '  ' + db(ea[i]).padStart(6) + '  ' + db(eb[i]).padStart(6) + '  ' +
    (ea[i] > 0 && eb[i] > 0 ? (20 * Math.log10(eb[i] / ea[i])).toFixed(1) : ''));
}

// ---- 时窗对比 ----
if (!wins.length) wins.push([120, 640], [730, 1400], [2100, 2800], [4400, 5000], [5800, 6100]);
console.log('\n--- 时窗频谱对比 ---');
for (const w of wins) {
  const sa = spectrum(A.x, A.sr, w[0], w[1]), sb = spectrum(B.x, B.sr, w[0], w[1]);
  console.log('  [' + w[0] + '-' + w[1] + 'ms]  ref centroid ' + sa.centroid + 'Hz : ' + sa.band.map(b => b.b + ' ' + b.pct + '%').join(' | '));
  console.log('  [' + w[0] + '-' + w[1] + 'ms]  web centroid ' + sb.centroid + 'Hz : ' + sb.band.map(b => b.b + ' ' + b.pct + '%').join(' | '));
}
