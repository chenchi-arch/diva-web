/* ============================================================================
 * engine.js — DIVA-01 Web 引擎（Web Audio 手写，零依赖）
 *
 * 忠实移植 diva-02.maxpat 的音频核心（生成器 build_diva02.js）。
 * 所有滤波器参数与公式均按 Cycling '74 官方参考实现：
 *   · onepole~  : y[n] = y[n-1] + a0(x[n]-y[n-1]),  a0 = sin(fc·π/nyquist)
 *   · reson~    : y[n] = a0(x[n] - r·x[n-2]) + b1·y[n-1] + b2·y[n-2],  Q = cf/bandwidth
 *                 bw = cf/Q ; r = exp(-π·bw/fs) ; b1 = 2r·cos(2π·cf/fs) ; b2 = -r² ; a0 = gain(1-r)
 *
 * 信号链（与 Max 版一一对应）：
 *   source: saw~(×0.2) + train~(1.0)  -> 电平标定 cal -> onepole~ tilt(亮度)
 *           存在感: hp = tilt - onepole~700(tilt) ; press = tilt + presG·hp
 *           气声: noise -> reson~(2800,1.4,0.45) 受"气声电平"控制
 *           空气带: noise -> reson~(5500,1.2,0.35) ×0.22 -> 进气声电平域（与 Max 同构）
 *   -> 元音门 VG(rampsmooth~ 30/300)
 *   -> 5 元音 × 4 reson~ 并联（FORMANTS + GTRIM）-> 45.35ms 交叉淡化
 *   -> ×0.5(VTRIM) -> adsr~(15/120/0.9/250) -> 600Hz 低搁架 x-0.28·onepole600(x)
 *   consonant: noise -> 6 个 reson~ 固定带（CTAB selIdx 切换）
 *              + 浊音杠 source -> onepole~800 -> ×vbarLvl
 *              -> ×0.5(CTRIM) -> rampsmooth~ 30/900 爆发包络
 *   -> 汇总 -> 复古毛刺(degrade~ 6bit + lores~ 7500/0.3, 湿×0.72) -> 音量dB -> clip~ ±1
 *
 * 音高表情：颤音 5.75Hz / ±增益 cents / 400ms 渐入 ；音头 scoop −24 cents / 120ms
 * 时序：gate↑ -> 辅音段 bStart..durMs -> 元音门在 durMs 打开（ADSR/颤音/puff 同时触发）
 *        元音目标在 gate↑+70ms 切换（自然元音过渡）；gate↓ -> 门关 6.8ms + ADSR 释放 250ms
 *
 * 在线（实时播放）与离线（OfflineAudioContext 导出）共用同一套代码。
 * ========================================================================== */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- 数据表
  var VOWEL_NAMES = ['a', 'i', 'u', 'e', 'o'];   // a=0 i=1 u=2 e=3 o=4

  // FORMANTS: [中心频率 Hz, 带宽 Hz] —— 同 build_diva02.js
  var FORMANTS = {
    a: [[850, 70], [1200, 90], [2800, 120], [3500, 150]],
    i: [[300, 70], [2300, 90], [3000, 120], [3600, 150]],
    u: [[350, 70], [1250, 90], [2300, 120], [3200, 150]],
    e: [[550, 70], [2000, 90], [2600, 120], [3400, 150]],
    o: [[500, 70], [900, 90], [2600, 120], [3300, 150]]
  };
  var GTRIM = [0.9, 0.95, 0.9, 0.8];             // 每条共振峰的电平配平（reson~ gain）

  // CTAB: [idx, bStart(ms), durMs, selIdx, noiseLvl, vbarLvl, glide]
  var CTAB = [
    [0, 0, 0, 1, 0, 0, 0], [1, 35, 80, 2, 0.20, 0, 0], [2, 32, 72, 3, 0.20, 0, 0],
    [3, 50, 70, 1, 0.12, 0, 0], [4, 0, 130, 4, 0.10, 0, 0], [5, 0, 140, 5, 0.10, 0, 0],
    [6, 0, 70, 6, 0.05, 0, 0], [7, 0, 110, 1, 0.09, 0, 0], [8, 0, 90, 1, 0, 0.45, 0],
    [9, 0, 120, 1, 0, 0.50, 0], [10, 0, 5000, 1, 0, 0.52, 0], [11, 17, 35, 2, 0.06, 0.34, 0],
    [12, 0, 0, 1, 0, 0, 1], [13, 0, 0, 1, 0, 0, 2], [14, 45, 65, 2, 0.13, 0.11, 0],
    [15, 0, 120, 4, 0.12, 0.11, 0], [16, 42, 58, 3, 0.12, 0.12, 0], [17, 50, 70, 1, 0.16, 0.11, 0],
    [18, 0, 110, 1, 0, 0, 0]
  ];
  // 6 个噪声带（selector~ 的 1..6 号）：{f 中心, q 品质因数, g reson~ gain}
  var CBR = [
    null,
    { f: 1200, q: 2.0, g: 0.5 },   // 1  p / f
    { f: 2500, q: 2.5, g: 0.5 },   // 2  k / g
    { f: 4500, q: 2.0, g: 0.5 },   // 3  t / d
    { f: 6000, q: 1.6, g: 0.5 },   // 4  s / z
    { f: 3200, q: 2.0, g: 0.5 },   // 5  sh
    { f: 1100, q: 0.7, g: 0.5 }    // 6  h（宽带）
  ];

  var DEFAULTS = {
    // 出厂亮度 0.55：Max 场景是 0.85，但网页版源频谱（周期波表 vs train~）比 Max 版亮一档，
    // 0.55 才与 Max 0.85 的频谱对齐（实测 200-1k/1-4k/4-8k = 57.5/40.5/2.0 vs 参考 56.5/40.3/3.0）。
    // 想回到 Max 原值：把 bright 设回 0.85。
    breath: 0.28, bright: 0.55, vib: 30, gain: -10,
    puff: 0.35, glitch: 0.2, glitchOn: 1, presG: 3.4
  };

  var C = {                      // 引擎时间常数（全部来自 build_diva02.js）
    adsrA: 0.015, adsrD: 0.120, adsrS: 0.9, adsrR: 0.250,
    xfadeSmp: 2000,              // rampsmooth~ 2000 2000 ≈ 45.35 ms @44.1k
    vgUpSmp: 30, vgDnSmp: 300,   // rampsmooth~ 30 300
    consUpSmp: 30, consDnSmp: 900,
    levelSmp: 32,
    paramSmp: 64,
    gainSmp: 32,
    vibHz: 5.75, vibOnset: 0.400, vibRelease: 0.200,
    scoopCents: 24, scoopA: 0.120,
    puffA: 0.015, puffD: 0.180, puffS: 0.1, puffR: 0.040,
    vowelTargetMs: 70,           // DLC delay 70
    ctrim: 0.5, vtrim: 0.5, glitchGain: 0.72, shelfAmt: 0.28,
    quantBits: 6, loresF: 7500, loresQ: 0.3,
    cal: 0.97                    // 电平标定（在出厂 bright=0.55 下对齐 Max 版参考响度；设 1.0 = 不标定）
  };

  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function dbtoa(db) { return Math.pow(10, db / 20); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function t(smp, sr) { return smp / sr; }

  // 确定性白噪声（同一构建/渲染可复现）
  function makeNoiseBuffer(ctx, seconds, seed) {
    var n = Math.ceil(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(1, n, ctx.sampleRate);
    var d = buf.getChannelData(0), s = seed >>> 0;
    for (var i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; d[i] = (s / 2147483648) - 1; }
    return buf;
  }

  // 窄脉冲波表（train~ 2.2727ms / 0.03 → duty 1.32%）
  function pulseWave(ctx, duty) {
    var N = 512, real = new Float32Array(N), imag = new Float32Array(N);
    for (var n = 1; n < N; n++) real[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
    return ctx.createPeriodicWave(real, imag);   // 归一化到峰值 1（与 train~ ±1 对齐）
  }

  // 一阶低通（Max onepole~）：a0 = sin(fc·π/nyquist)
  // ⚠ 不是常见的 1-exp(-2πfc/fs)；两者在 6 kHz 处差很多（0.776 vs 0.588），用错会让源音偏暗。
  function onePole(ctx, fc) {
    var nyq = ctx.sampleRate / 2;
    var a = Math.sin(clamp(fc, 1, nyq * 0.999) * Math.PI / nyq);
    return ctx.createIIRFilter([a], [1, -(1 - a)]);
  }

  // 硬削波曲线（clip~ -1. 1.）
  function clipCurve() {
    var n = 4096, c = new Float32Array(n);
    for (var i = 0; i < n; i++) c[i] = clamp(i * 2 / (n - 1) - 1, -1, 1);
    return c;
  }
  // 位深量化曲线（degrade~ 第 2 参 = 位深）
  function quantCurve(bits) {
    var n = 65536, c = new Float32Array(n), lv = Math.pow(2, bits - 1);
    for (var i = 0; i < n; i++) c[i] = Math.round((i * 2 / (n - 1) - 1) * lv) / lv;
    return c;
  }

  // Max reson~ 的官方实现（二极点二零点；零点在 ±√r → 天然抑制 DC/Nyquist）
  function reson2(ctx, cf, q, gain) {
    var sr = ctx.sampleRate;
    var bw = cf / Math.max(0.01, q);
    var r = Math.exp(-Math.PI * bw / sr);
    if (r > 0.9999999) r = 0.9999999;
    var th = 2 * Math.PI * cf / sr;
    var b1 = 2 * r * Math.cos(th), b2 = -(r * r), a0 = gain * (1 - r);
    return ctx.createIIRFilter([a0, 0, -a0 * r], [1, -b1, -b2]);
  }

  function holdTo(param, time) {   // 取消后续自动化但保持当前值（避免跳变）
    try { param.cancelAndHoldAtTime(time); }
    catch (e) { try { param.cancelScheduledValues(time); } catch (e2) { } }
  }

  // ============================================================ DivaEngine
  function DivaEngine(ctx, opts) {
    opts = opts || {};
    this.ctx = ctx;
    this.opts = opts;
    this.sr = ctx.sampleRate;
    this.params = Object.assign({}, DEFAULTS, opts.params || {});
    this._cur = null;
    this._build();
  }

  DivaEngine.prototype._build = function () {
    var ctx = this.ctx, P = this.params;

    // ---------- 共享噪声 + 两个振荡器（连续运行，对应 noise~ / saw~ / train~） ----------
    this.noiseBuf = makeNoiseBuffer(ctx, 2.0, ctx.__divaSeed || 20260918);
    this.noise = ctx.createBufferSource(); this.noise.buffer = this.noiseBuf; this.noise.loop = true;
    this.saw = ctx.createOscillator(); this.saw.type = 'sawtooth'; this.saw.frequency.value = 440;
    this.pulse = ctx.createOscillator();
    this.pulse.setPeriodicWave(pulseWave(ctx, 0.03 / 2.2727)); this.pulse.frequency.value = 440;

    // ---------- 音源链 ----------
    this.sawLev = ctx.createGain(); this.sawLev.gain.value = 0.2;
    this.trainLev = ctx.createGain(); this.trainLev.gain.value = 1.0;
    this.srcMix = ctx.createGain(); this.srcMix.gain.value = 1.0;
    this.saw.connect(this.sawLev).connect(this.srcMix);
    this.pulse.connect(this.trainLev).connect(this.srcMix);

    // 电平标定：Web Audio 原语的固有标度与 Max 的 saw~/train~/reson~ 不同，
    // 未标定时整链比 Max 版热数 dB（与 test/ref-line1-mono.wav 实测比对得出）。
    // 放在源端（毛刺层之前），让量化毛刺也工作在 Max 版同档电平上。
    this.cal = ctx.createGain(); this.cal.gain.value = C.cal;
    this.srcMix.connect(this.cal);

    this.tilt = onePole(ctx, 250 * Math.pow(44, P.bright));   // 亮度（默认 0.85 → 6230 Hz）
    this._bright = P.bright;
    this.cal.connect(this.tilt);

    // 存在感：hp = tilt - onepole~700(tilt) ; press = tilt + presG·hp
    this.presLp = onePole(ctx, 700);
    this.presInv = ctx.createGain(); this.presInv.gain.value = -1;
    this.pressHp = ctx.createGain(); this.pressHp.gain.value = 1.0;   // = tilt - lp700(tilt)
    this.press = ctx.createGain(); this.press.gain.value = 1.0;       // = tilt + presG·hp
    this.presG = ctx.createGain(); this.presG.gain.value = (P.presG === undefined ? 3.4 : P.presG);
    this.tilt.connect(this.presLp).connect(this.presInv).connect(this.pressHp);
    this.tilt.connect(this.pressHp);
    this.pressHp.connect(this.presG).connect(this.press);
    this.tilt.connect(this.press);                 // “原始 tilt”支路（不能漏，否则只剩高通拷贝）

    // 气声带 + 空气带（空气带走增益域，与 Max 完全同构）
    this.bres = reson2(ctx, 2800, 1.4, 0.45);
    this.airres = reson2(ctx, 5500, 1.2, 0.35);
    this.airLev = ctx.createGain(); this.airLev.gain.value = 0.22;
    this.noise.connect(this.bres);
    this.noise.connect(this.airres);
    this.airres.connect(this.airLev);

    // 气声电平信号 = breath(常数) + puff(包络) + 0.22·air  ——> BRLEV.gain
    this.brLev = ctx.createGain(); this.brLev.gain.value = 0;
    this.breathConst = ctx.createConstantSource(); this.breathConst.offset.value = P.breath;
    this.puff = ctx.createConstantSource(); this.puff.offset.value = P.puff;
    this.puffEnv = ctx.createGain(); this.puffEnv.gain.value = 0;
    this.levelSum = ctx.createGain(); this.levelSum.gain.value = 1.0;
    this.breathConst.connect(this.levelSum);
    this.puff.connect(this.puffEnv).connect(this.levelSum);
    this.airLev.connect(this.levelSum);
    this.levelSum.connect(this.brLev.gain);
    this.bres.connect(this.brLev);

    // SRCS = PRESS + BRLEV
    this.srcs = ctx.createGain(); this.srcs.gain.value = 1.0;
    this.press.connect(this.srcs);
    this.brLev.connect(this.srcs);

    // ---------- 元音门 MUTE = SRCS × VG ----------
    this.vGate = ctx.createGain(); this.vGate.gain.value = 0;
    this.srcs.connect(this.vGate);

    // ---------- 5 元音 × 4 共振峰 并联 ----------
    this.xfade = [];
    this.vowelSum = ctx.createGain(); this.vowelSum.gain.value = 1.0;
    for (var v = 0; v < 5; v++) {
      var xf = ctx.createGain(); xf.gain.value = (v === 0 ? 1 : 0);
      var F = FORMANTS[VOWEL_NAMES[v]];
      for (var k = 0; k < 4; k++) this.vGate.connect(reson2(ctx, F[k][0], F[k][0] / F[k][1], GTRIM[k])).connect(xf);
      xf.connect(this.vowelSum);
      this.xfade.push(xf);
    }

    // ---------- 主总线：×0.5 -> ADSR -> 600Hz 低搁架 ----------
    this.vtrim = ctx.createGain(); this.vtrim.gain.value = C.vtrim;
    this.vowelSum.connect(this.vtrim);
    this.env = ctx.createGain(); this.env.gain.value = 0;
    this.vtrim.connect(this.env);

    this.shelfLp = onePole(ctx, 600);
    this.shelfInv = ctx.createGain(); this.shelfInv.gain.value = -C.shelfAmt;
    this.shelfSum = ctx.createGain(); this.shelfSum.gain.value = 1.0;
    this.env.connect(this.shelfSum);
    this.env.connect(this.shelfLp).connect(this.shelfInv).connect(this.shelfSum);

    // ---------- 辅音层：6 个固定噪声谐振器 + selector~ 式切换 ----------
    this.cBandSel = [];
    this.cNoiseLvl = ctx.createGain(); this.cNoiseLvl.gain.value = 0;
    this.cVbarLp = onePole(ctx, 800);
    this.cVbarLvl = ctx.createGain(); this.cVbarLvl.gain.value = 0;
    this.cSum = ctx.createGain(); this.cSum.gain.value = 1.0;
    this.cTrim = ctx.createGain(); this.cTrim.gain.value = C.ctrim;
    this.cEnv = ctx.createGain(); this.cEnv.gain.value = 0;
    for (var bi = 1; bi <= 6; bi++) {
      var cb = CBR[bi];
      var sel = ctx.createGain(); sel.gain.value = (bi === 1 ? 1 : 0);   // selector~ 6 1 的初值
      this.noise.connect(reson2(ctx, cb.f, cb.q, cb.g)).connect(sel).connect(this.cNoiseLvl);
      this.cBandSel.push(sel);
    }
    this.cNoiseLvl.connect(this.cSum);
    this.srcs.connect(this.cVbarLp).connect(this.cVbarLvl).connect(this.cSum);
    this.cSum.connect(this.cTrim).connect(this.cEnv);

    // 主汇合
    this.mix = ctx.createGain(); this.mix.gain.value = 1.0;
    this.shelfSum.connect(this.mix);
    this.cEnv.connect(this.mix);

    // ---------- 复古毛刺层（degrade~ 6bit + lores~，干湿混合） ----------
    this.rgQuant = ctx.createWaveShaper(); this.rgQuant.curve = quantCurve(C.quantBits); this.rgQuant.oversample = 'none';
    this.rgLp = ctx.createBiquadFilter(); this.rgLp.type = 'lowpass';
    this.rgLp.frequency.value = C.loresF; this.rgLp.Q.value = C.loresQ;
    this.rgWetG = ctx.createGain(); this.rgWetG.gain.value = C.glitchGain;
    this.rgWet = ctx.createGain(); this.rgWet.gain.value = 0;
    this.rgDry = ctx.createGain(); this.rgDry.gain.value = 1.0;
    this.post = ctx.createGain(); this.post.gain.value = 1.0;
    this.mix.connect(this.rgQuant).connect(this.rgLp).connect(this.rgWetG).connect(this.rgWet).connect(this.post);
    this.mix.connect(this.rgDry).connect(this.post);

    // ---------- 音量 + 削波 + 输出 ----------
    this.outGain = ctx.createGain(); this.outGain.gain.value = dbtoa(clamp(P.gain, -48, 0));
    this.clip = ctx.createWaveShaper(); this.clip.curve = clipCurve(); this.clip.oversample = 'none';
    this.post.connect(this.outGain).connect(this.clip);
    this.out = ctx.createGain(); this.out.gain.value = 1.0;
    this.clip.connect(this.out);
    this.dest = this.opts.dest || ctx.destination;
    this.out.connect(this.dest);

    // ---------- 音高表情：颤音 + scoop（cents 域相加 -> osc.detune） ----------
    this.detuneSum = ctx.createGain(); this.detuneSum.gain.value = 1.0;
    this.lfo = ctx.createOscillator(); this.lfo.type = 'sine'; this.lfo.frequency.value = C.vibHz;
    this.vibDepth = ctx.createGain(); this.vibDepth.gain.value = P.vib;
    this.vibEnv = ctx.createGain(); this.vibEnv.gain.value = 0;
    this.lfo.connect(this.vibDepth).connect(this.vibEnv).connect(this.detuneSum);
    this.scoop = ctx.createConstantSource(); this.scoop.offset.value = 0;
    this.scoop.connect(this.detuneSum);
    this.detuneSum.connect(this.saw.detune);
    this.detuneSum.connect(this.pulse.detune);

    // ---------- 启动所有持续源 ----------
    this.noise.start(0); this.saw.start(0); this.pulse.start(0);
    this.lfo.start(0); this.breathConst.start(0); this.puff.start(0); this.scoop.start(0);

    // 给所有被自动化的参数在 t=0 铺显式事件：否则“无前置事件的 linearRamp”起点不确定
    // （Chrome 下会变成不渐变），离线渲染会整段静音。
    [this.vGate.gain, this.env.gain, this.cEnv.gain, this.puffEnv.gain,
     this.vibEnv.gain, this.scoop.offset, this.breathConst.offset, this.puff.offset,
     this.rgWet.gain, this.rgDry.gain, this.outGain.gain, this.vibDepth.gain,
     this.vtrim.gain, this.sawLev.gain, this.trainLev.gain,
     this.presInv.gain, this.pressHp.gain, this.press.gain, this.presG.gain,
     this.cNoiseLvl.gain, this.cVbarLvl.gain, this.cTrim.gain, this.airLev.gain,
     this.cal.gain, this.levelSum.gain, this.rgWetG.gain, this.vowelSum.gain,
     this.shelfInv.gain, this.shelfSum.gain, this.mix.gain, this.post.gain
    ].forEach(function (p) { p.setValueAtTime(p.value, 0); });
    for (var q = 0; q < 5; q++) this.xfade[q].gain.setValueAtTime(this.xfade[q].gain.value, 0);
    for (var q2 = 0; q2 < 6; q2++) this.cBandSel[q2].gain.setValueAtTime(this.cBandSel[q2].gain.value, 0);

    this.setParams(P, 0);
  };

  // ---------------------------------------------------------- 参数
  DivaEngine.prototype.setParams = function (p, when) {
    when = when || 0;
    var self = this;
    Object.keys(p).forEach(function (k) { self.params[k] = p[k]; });
    if (p.breath !== undefined) this._ramp(this.breathConst.offset, when, clamp(p.breath, 0, 1), t(C.paramSmp, this.sr));
    if (p.bright !== undefined && this._bright !== p.bright) {
      this._bright = p.bright;
      this._setBright(clamp(p.bright, 0, 1));
    }
    if (p.puff !== undefined) this._ramp(this.puff.offset, when, clamp(p.puff, 0, 1), t(C.paramSmp, this.sr));
    if (p.presG !== undefined) this.presG.gain.setValueAtTime(p.presG, when);
    if (p.vib !== undefined) this._ramp(this.vibDepth.gain, when, Math.max(0, p.vib), t(C.paramSmp, this.sr));
    if (p.gain !== undefined) this._ramp(this.outGain.gain, when, dbtoa(clamp(p.gain, -48, 0)), t(C.gainSmp, this.sr));
    if (p.glitch !== undefined || p.glitchOn !== undefined) {
      var on = this.params.glitchOn ? 1 : 0, amt = clamp(this.params.glitch, 0, 1) * on;
      this._ramp(this.rgWet.gain, when, amt, t(128, this.sr));
      this._ramp(this.rgDry.gain, when, 1 - amt, t(128, this.sr));
    }
    return this;
  };
  DivaEngine.prototype._ramp = function (param, when, v, dur) {
    if (dur <= 0.00001) { holdTo(param, when); param.setValueAtTime(v, when); return; }
    holdTo(param, when); param.linearRampToValueAtTime(v, when + dur);
  };
  // 亮度：重建 tilt 的一阶低通并重接（presLp 是固定的 700Hz 参考支路）
  DivaEngine.prototype._setBright = function (b) {
    var neo = onePole(this.ctx, 250 * Math.pow(44, b));
    try { this.cal.disconnect(this.tilt); } catch (e) { }
    try { this.tilt.disconnect(); } catch (e) { }
    try { this.presLp.disconnect(this.presInv); } catch (e) { }
    this.tilt = neo;
    this.cal.connect(this.tilt);
    this.tilt.connect(this.presLp);
    this.tilt.connect(this.pressHp);
    this.tilt.connect(this.press);
    this.presLp.connect(this.presInv);
  };

  // ---------------------------------------------------------- 元音切换（交叉淡化 ~45ms）
  DivaEngine.prototype.setVowel = function (idx, when) {
    if (idx === null || idx === undefined || idx < 0 || idx > 4) return;
    var d = t(C.xfadeSmp, this.sr);
    for (var i = 0; i < 5; i++) {
      holdTo(this.xfade[i].gain, when);
      this.xfade[i].gain.linearRampToValueAtTime(i === idx ? 1 : 0, when + d);
    }
  };

  // ---------------------------------------------------------- 音符
  // note: {midi, cons, vowel|null, glideMs, prevMidi|null}
  DivaEngine.prototype.noteOn = function (t0, note) {
    var c = CTAB[note.cons] || CTAB[0];
    var bStart = c[1] / 1000, dur = c[2] / 1000;
    var st = this._cur = {
      t0: t0, dur: dur, vowel: note.vowel, adsr: false, glideMs: note.glideMs || 0,
      hasVowel: (note.vowel !== null && note.vowel !== undefined),
      hasCons: (c[4] > 0 || c[5] > 0)
    };

    // 音高：滑音用指数斜坡（MIDI 线性 = 频率指数）
    var f = mtof(note.midi), glide = (note.glideMs || 0) / 1000;
    [this.saw.frequency, this.pulse.frequency].forEach(function (fp) {
      holdTo(fp, t0);
      if (glide > 0.001 && note.prevMidi != null) {
        fp.setValueAtTime(mtof(note.prevMidi), t0);
        fp.exponentialRampToValueAtTime(Math.max(1, f), t0 + glide);
      } else fp.setValueAtTime(f, t0);
    });

    // scoop：gate↑ 起 −24 cents，元音门打开后 120ms 归零
    holdTo(this.scoop.offset, t0);
    this.scoop.offset.setValueAtTime(-C.scoopCents, t0);
    if (dur <= (note.gateMs || 1e9) / 1000) {
      this.scoop.offset.setValueAtTime(-C.scoopCents, t0 + dur);
      this.scoop.offset.linearRampToValueAtTime(0, t0 + dur + C.scoopA);
    }

    // 辅音段：噪声带切换 + 电平 + 爆发包络（0 → bStart ↗1 → durMs ↘0）
    for (var bi = 0; bi < 6; bi++) this.cBandSel[bi].gain.setValueAtTime((bi === (c[3] - 1)) ? 1 : 0, t0);
    this.cNoiseLvl.gain.setValueAtTime(c[4], t0);
    this.cVbarLvl.gain.setValueAtTime(c[5], t0);
    var ce = this.cEnv.gain, up = t(C.consUpSmp, this.sr), dn = t(C.consDnSmp, this.sr);
    holdTo(ce, t0);
    ce.setValueAtTime(0, t0);
    if (st.hasCons) {
      ce.setValueAtTime(0, t0 + bStart);
      ce.linearRampToValueAtTime(1, t0 + bStart + up);
      ce.linearRampToValueAtTime(0, t0 + dur + dn);
    } else {
      ce.setValueAtTime(0, t0 + dur);        // cons=0/12/13：不产生辅音爆发
    }

    // 元音门：durMs 后打开
    var vg = this.vGate.gain, vup = t(C.vgUpSmp, this.sr);
    holdTo(vg, t0);
    vg.setValueAtTime(0, t0);
    vg.setValueAtTime(0, t0 + dur);
    if (st.hasVowel) vg.linearRampToValueAtTime(1, t0 + dur + vup);

    // 元音目标：滑音辅音(y/w) 先落 i/u；gate↑+70ms 再切到目标（自然元音过渡）
    if (c[6] === 1) this.setVowel(1, t0);
    else if (c[6] === 2) this.setVowel(2, t0);
    if (st.hasVowel) this.setVowel(note.vowel, t0 + C.vowelTargetMs / 1000);
    return st;
  };

  // 元音门打开：ADSR / 颤音渐入 / puff 同时触发
  DivaEngine.prototype.markVowelOpen = function (t0, note) {
    var c = CTAB[note.cons] || CTAB[0], tOpen = t0 + c[2] / 1000;
    if (note.vowel === null || note.vowel === undefined) return;
    var eg = this.env.gain;
    holdTo(eg, tOpen);
    eg.linearRampToValueAtTime(1, tOpen + C.adsrA);
    eg.linearRampToValueAtTime(C.adsrS, tOpen + C.adsrA + C.adsrD);
    var ve = this.vibEnv.gain;
    holdTo(ve, tOpen);
    ve.linearRampToValueAtTime(1, tOpen + C.vibOnset);
    var pe = this.puffEnv.gain, pf = this.params.puff == null ? 0.35 : this.params.puff;
    holdTo(pe, tOpen);
    pe.setValueAtTime(0, tOpen);
    if (pf > 0) {
      pe.linearRampToValueAtTime(1, tOpen + C.puffA);
      pe.linearRampToValueAtTime(C.puffS, tOpen + C.puffA + C.puffD);
    }
    if (this._cur) this._cur.adsr = true;
  };

  // gate↓
  DivaEngine.prototype.noteOff = function (t1) {
    var st = this._cur; if (!st) return;
    var tOpen = st.t0 + st.dur;

    // ① 辅音段还没走完（gate↓ 早于 durMs，如「ん」5000ms）→ 在此收尾
    if (st.hasCons && t1 < tOpen) {
      var ce = this.cEnv.gain;
      ce.cancelScheduledValues(t1);
      ce.setValueAtTime(1, t1);
      ce.linearRampToValueAtTime(0, t1 + t(C.consDnSmp, this.sr));
    }
    // ② 元音门没打开 → 保持关闭（无 ADSR / puff）
    if (!st.hasVowel || t1 < tOpen) {
      var vg0 = this.vGate.gain;
      vg0.cancelScheduledValues(t1); vg0.setValueAtTime(0, t1);
      holdTo(this.scoop.offset, t1); this.scoop.offset.setValueAtTime(-C.scoopCents, t1);
      this._cur = null; return;
    }
    // ③ 正常收尾：门关 6.8ms + ADSR 250ms + 颤音 200ms + puff 40ms
    var vg = this.vGate.gain;
    vg.cancelScheduledValues(t1); vg.setValueAtTime(1, t1);
    vg.linearRampToValueAtTime(0, t1 + t(C.vgDnSmp, this.sr));
    var eg = this.env.gain;
    holdTo(eg, t1); eg.linearRampToValueAtTime(0, t1 + C.adsrR);
    var ve = this.vibEnv.gain;
    holdTo(ve, t1); ve.linearRampToValueAtTime(0, t1 + C.vibRelease);
    var pe = this.puffEnv.gain;
    holdTo(pe, t1); pe.linearRampToValueAtTime(0, t1 + C.puffR);
    this._cur = null;
  };

  // 一个完整音符
  DivaEngine.prototype.playNote = function (t0, note) {
    var c = CTAB[note.cons] || CTAB[0];
    this.noteOn(t0, note);
    // 元音门只有在音符长度 ≥ 辅音段时长时才会真的打开（与引擎 DLB/MSTOP 一致）
    if (note.vowel !== null && note.vowel !== undefined && (note.gateMs / 1000) >= (c[2] / 1000)) this.markVowelOpen(t0, note);
    this.noteOff(t0 + (note.gateMs / 1000));
    return this;
  };

  // 硬停：立刻收干净
  DivaEngine.prototype.panic = function (when) {
    when = when || 0;
    var d = 0.02, self = this;
    [this.env.gain, this.cEnv.gain, this.puffEnv.gain, this.vibEnv.gain].forEach(function (p) {
      holdTo(p, when); p.linearRampToValueAtTime(0, when + d);
    });
    var vg = this.vGate.gain;
    holdTo(vg, when); vg.linearRampToValueAtTime(0, when + d);
    this._cur = null;
  };

  // ---------------------------------------------------------- 全序列离线渲染
  DivaEngine.render = function (opts) {
    opts = opts || {};
    var sr = opts.sampleRate || 44100;
    var notes = opts.notes || [];
    var lead = (opts.leadMs == null ? 150 : opts.leadMs) / 1000;
    var loops = opts.loops == null ? 2 : opts.loops;
    var tail = (opts.tailMs == null ? 800 : opts.tailMs) / 1000;
    var total = notes.length ? (notes[notes.length - 1].t + notes[notes.length - 1].d) / 1000 : 0;
    var dur = lead + loops * total + tail;
    var ctx = new (root.OfflineAudioContext || root.webkitOfflineAudioContext)(2, Math.ceil(dur * sr), sr);
    ctx.__divaSeed = opts.seed || 20260918;
    var eng = new DivaEngine(ctx, { params: opts.params });
    for (var L = 0; L < loops; L++) {
      var base = lead + L * total;
      for (var i = 0; i < notes.length; i++) {
        var n = notes[i], prev = i > 0 ? notes[i - 1] : null;
        eng.playNote(base + n.t / 1000, {
          midi: n.midi, cons: n.cons, vowel: (n.vowel == null ? null : n.vowel),
          glideMs: (n.glide > 0 && prev) ? n.glide : 0,
          prevMidi: prev ? prev.midi : null,
          gateMs: n.d
        });
      }
    }
    return ctx.startRendering().then(function (buf) {
      return { buffer: buf, duration: dur, loops: loops, totalMs: total * 1000 };
    });
  };

  root.DivaEngine = DivaEngine;
  // 必须合并而不是覆盖：tables.js 先加载并挂了 grid/parseSeq/SEION 等
  root.DIVA_TABLES = Object.assign(root.DIVA_TABLES || {}, {
    FORMANTS: FORMANTS, CTAB: CTAB, CBR: CBR, GTRIM: GTRIM,
    VOWEL_NAMES: VOWEL_NAMES, DEFAULTS: DEFAULTS, CONST: C,
    mtof: mtof, dbtoa: dbtoa
  });
})(typeof window !== 'undefined' ? window : globalThis);
