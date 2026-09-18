/* ============================================================================
 * analyze.js — 音频分析（零依赖）：时长 / RMS / 峰值 / 频带占比 / 频谱重心 / 频带能量表
 *   用法: node tools/analyze.js <file.wav|mp3> [<file2> ...] [--json out.json] [--csv out.csv]
 *   口径与 Max 项目 timbre_bench/diva_an 同向：20Hz–16kHz 总功率为分母
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SR = 44100, N = 4096, HOP = 2048;

function readWav(p) {
  const b = fs.readFileSync(p);
  if (b.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not RIFF: ' + p);
  let off = 12, fmt = null, data = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4), sz = b.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') fmt = { channels: b.readUInt16LE(body + 2), sr: b.readUInt32LE(body + 4), bits: b.readUInt16LE(body + 14), code: b.readUInt16LE(body) };
    else if (id === 'data') data = { off: body, len: Math.min(sz, b.length - body) };
    off = body + sz + (sz % 2);
  }
  if (!fmt || !data) throw new Error('missing fmt/data');
  const nch = fmt.channels, bytes = fmt.bits / 8, n = Math.floor(data.len / (bytes * nch));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < nch; c++) {
      const o = data.off + (i * nch + c) * bytes;
      if (fmt.bits === 16) s += b.readInt16LE(o) / 32768;
      else if (fmt.bits === 32) s += b.readFloatLE(o);
      else if (fmt.bits === 8) s += (b.readUInt8(o) - 128) / 128;
    }
    out[i] = s / nch;
  }
  return { sr: fmt.sr, ch: nch, bits: fmt.bits, x: out };
}

function toWav(src, dst) {
  if (fs.existsSync(dst)) fs.unlinkSync(dst);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', src, '-ac', '1', '-ar', String(SR), '-c:a', 'pcm_s16le', dst], { stdio: 'inherit' });
  return dst;
}

function load(p) {
  if (/\.wav$/i.test(p)) return readWav(p);
  return readWav(toWav(p, path.join(path.dirname(p), '_dec_' + path.basename(p).replace(/\W+/g, '_') + '.wav')));
}

// --- 迭代基-2 FFT（输入长度 2 的幂）---
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
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

const BANDS = [[20, 200], [200, 1000], [1000, 4000], [4000, 8000], [8000, 16000]];

function analyze(x, sr) {
  let sum = 0, peak = 0;
  for (let i = 0; i < x.length; i++) { const v = x[i]; sum += v * v; if (Math.abs(v) > peak) peak = Math.abs(v); }
  const rms = Math.sqrt(sum / x.length);
  const nf = Math.max(1, Math.floor((x.length - N) / HOP));
  const acc = new Float64Array(N / 2 + 1), win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
  let frames = 0, active = 0;
  const re = new Float64Array(N), im = new Float64Array(N);
  const thr = Math.max(rms * 0.6, 1e-5);          // 只统计有声帧（跳过静音填充）
  for (let f = 0; f < nf; f++) {
    const st = f * HOP;
    let e = 0;
    for (let i = 0; i < N; i++) { const v = x[st + i] || 0; e += v * v; re[i] = v * win[i]; im[i] = 0; }
    if (Math.sqrt(e / N) < thr) continue;
    active++;
    fft(re, im);
    for (let k = 0; k <= N / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
  }
  if (!frames) frames = 1;
  const df = sr / N;
  const band = BANDS.map(() => 0);
  let tot = 0, centN = 0, centD = 0;
  for (let k = 1; k <= N / 2; k++) {
    const f = k * df, p = acc[k];
    if (f < 20 || f > 16000) continue;
    tot += p; centN += f * p; centD += p;
    for (let b = 0; b < BANDS.length; b++) if (f >= BANDS[b][0] && f < BANDS[b][1]) band[b] += p;
  }
  const shares = band.map(v => tot ? v / tot : 0);
  return {
    seconds: x.length / sr, rms, peak,
    centroidHz: centD ? centN / centD : 0,
    activeFrames: active, frames: nf,
    bands: BANDS.map((b, i) => ({ band: b[0] + '-' + b[1], pct: +(shares[i] * 100).toFixed(2) })),
    spec: Array.from({ length: 120 }, (_, i) => {
      const f0 = 20 * Math.pow(16000 / 20, i / 120), f1 = 20 * Math.pow(16000 / 20, (i + 1) / 120);
      let s = 0;
      for (let k = 1; k <= N / 2; k++) { const f = k * df; if (f >= f0 && f < f1) s += acc[k]; }
      return { f: Math.round((f0 + f1) / 2), p: tot ? s / tot : 0 };
    })
  };
}

// ---- main ----
const argv = process.argv.slice(2);
let jsonOut = null, csvOut = null;
const files = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--json') jsonOut = argv[++i];
  else if (argv[i] === '--csv') csvOut = argv[++i];
  else files.push(argv[i]);
}
const res = {};
for (const f of files) {
  const w = load(f);
  const a = analyze(w.x, w.sr);
  res[path.basename(f)] = { sr: w.sr, ch: w.ch, bits: w.bits, ...a };
  console.log('=== ' + path.basename(f) + ' ===');
  console.log('  sr=' + w.sr + ' ch=' + w.ch + ' bits=' + w.bits +
    '  dur=' + a.seconds.toFixed(3) + 's  rms=' + a.rms.toFixed(5) + '  peak=' + a.peak.toFixed(5) +
    '  centroid=' + a.centroidHz.toFixed(0) + 'Hz  activeFrames=' + a.activeFrames + '/' + a.frames);
  console.log('  bands: ' + a.bands.map(b => b.band + ' ' + b.pct + '%').join(' | '));
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(res, null, 2), 'utf8');
if (csvOut) {
  const keys = Object.keys(res), L = ['f,' + keys.join(',')];
  for (let i = 0; i < 120; i++) L.push(res[keys[0]].spec[i].f + ',' + keys.map(k => (res[k].spec[i].p * 100).toFixed(4)).join(','));
  fs.writeFileSync(csvOut, L.join('\n'), 'utf8');
}
