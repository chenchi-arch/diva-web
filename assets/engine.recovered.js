/* ============================================================================
 * engine.js �?DIVA-01 Web 引擎（Web Audio 手写，零依赖�? *
 * 忠实移植 diva-02.maxpat 的音频核心（build_diva02.js）：
 *   source: saw~ (×0.2) + train~(2.2727ms/0.03) (×1.0) -> onepole~(bright, 默认6100)
 *           + 存在感：hp = tilt - onepole~700(tilt) ; press = tilt + 3.4*hp
 *           + 气声：noise~ -> reson~0.45/2800/1.4 , 空气带：noise~ -> reson~0.35/5500/1.2
 *             两者共同组�?气声电平"信号（与 Max 完全同构，含 0.22*air 进增益域�? *   -> 元音�?VG(rampsmooth~30/300)
 *   -> 5 元音 × 4 reson~ 并联（FORMANTS �?+ GTRIM 电平�? *   -> 交叉淡化 expr($f1==i) + rampsmooth~ 2000/2000 (=45.4ms @44.1k)
 *   -> ×0.5 -> adsr~ 15 120 0.9 250 -> 600Hz 低搁�?(x - 0.28*onepole600(x))
 *   consonant: noise~ -> 带�?reson~0.5 (�?CTAB selIdx) -> ×noiseLvl
 *              + 浊音�?source -> onepole~800 -> ×vbarLvl
 *              -> ×0.5(CTRIM) -> rampsmooth~30/900 爆发包络
 *   -> 汇�?-> 复古毛刺 (degrade~ 6bit + lores~ 7500/0.3 湿�?.72) -> 音量dB -> clip~-1..1
 *
 * 音高表情：颤�?5.75Hz / ±depth cents / 400ms 渐入 ；音�?scoop �?4 cents / 120ms
 * 时序（与引擎一致）：gate�?-> 辅音�?bStart..durMs -> 元音门在 durMs 打开（ADSR/颤音/puff 同时触发�? *                      元音目标�?gate�?70ms 才切换（自然元音过渡�? * 本文件不依赖任何库；在线(实时)与离�?OfflineAudioContext)同一套代码�? * ========================================================================== */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- 表（�?Max 版同源）
  var VOWEL_NAMES = ['a', 'i', 'u', 'e', 'o'];

  // FORMANTS: [中心频率 Hz, 带宽 Hz]  —�?build_diva02.js FORMANTS
  var FORMANTS = {
    a: [[850, 70], [1200, 90], [2800, 120], [3500, 150]],
    i: [[300, 70], [2300, 90], [3000, 120], [3600, 150]],
    u: [[350, 70], [1250, 90], [2300, 120], [3200, 150]],
    e: [[550, 70], [2000, 90], [2600, 120], [3400, 150]],
    o: [[500, 70], [900, 90], [2600, 120], [3300, 150]]
  };
  var GTRIM = [0.9, 0.95, 0.9, 0.8];          // 每条共振峰的电平配平（reson~ gain 参数�?
  // CTAB: [idx, bStart(ms), durMs, selIdx, noiseLvl, vbarLvl, glide] —�?引擎 CTAB 原表
  var CTAB = [
    [0, 0, 0, 1, 0, 0, 0], [1, 35, 80, 2, 0.20, 0, 0], [2, 32, 72, 3, 0.20, 0, 0],
    [3, 50, 70, 1, 0.12, 0, 0], [4, 0, 130, 4, 0.10, 0, 0], [5, 0, 140, 5, 0.10, 0, 0],
    [6, 0, 70, 6, 0.05, 0, 0], [7, 0, 110, 1, 0.09, 0, 0], [8, 0, 90, 1, 0, 0.45, 0],
    [9, 0, 120, 1, 0, 0.50, 0], [10, 0, 5000, 1, 0, 0.52, 0], [11, 17, 35, 2, 0.06, 0.34, 0],
    [12, 0, 0, 1, 0, 0, 1], [13, 0, 0, 1, 0, 0, 2], [14, 45, 65, 2, 0.13, 0.11, 0],
    [15, 0, 120, 4, 0.12, 0.11, 0], [16, 42, 58, 3, 0.12, 0.12, 0], [17, 50, 70, 1, 0.16, 0.11, 0],
    [18, 0, 110, 1, 0, 0, 0]
  ];
  // 六个噪声带（CBR1..6）：[中心 Hz, Q, reson~ gain]  —�?selector~ �?1..6 �?  var CBR = [
    null,
    { f: 1200, q: 2.0, g: 0.5 },   // 1  p / f
    { f: 2500, q: 2.5, g: 0.5 },   // 2  k / g
    { f: 4500, q: 2.0, g: 0.5 },   // 3  t / d
    { f: 6000, q: 1.6, g: 0.5 },   // 4  s / z
    { f: 3200, q: 2.0, g: 0.5 },   // 5  sh
    { f: 1100, q: 0.7, g: 0.5 }    // 6  h（宽带）
  ];

  var DEFAULTS = { breath: 0.28, bright: 0.85, vib: 30, gain: -10, puff: 0.35, glitch: 0.2, glitchOn: 1, presG: 3.4 };

  var C = {                      // 引擎时间常数（全部来�?build_diva02.js�?    adsrA: 0.015, adsrD: 0.120, adsrS: 0.9, adsrR: 0.250,
    xfadeSmp: 2000,              // rampsmooth~ 2000 2000 -> 45.35 ms @44.1k
    vgUpSmp: 30, vgDnSmp: 300,   // rampsmooth~ 30 300
    consUpSmp: 30, consDnSmp: 900,
    lvlSmp: 32,                  // rampsmooth~ 32 32（电平）
    paramSmp: 64,                // rampsmooth~ 64 64（breath / bright�?    gainSmp: 32,
    vibHz: 5.75, vibOnset: 0.400, vibRelease: 0.200,
    scoopCents: 24, scoopA: 0.120,
    puffA: 0.015, puffD: 0.180, puffS: 0.1, puffR: 0.040,
    vowelTargetMs: 70,           // DLC delay 70
    ctrim: 0.5, vtrim: 0.5, glitchGain: 0.72, shelfAmt: 0.28,
    quantBits: 6, loresF: 7500, loresQ: 0.3,
    cal: 0.78                   // 电平标定（对�?Max 版参考渲染响度；�?1.0 = 不标定）
  };

  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function dbtoa(db) { return Math.pow(10, db / 20); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function t(smp, sr) { return smp / sr; }

  // 确定性白噪声（同一次构�?渲染结果可复现）
  function makeNoiseBuffer(ctx, seconds, seed) {
    var n = Math.ceil(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(1, n, ctx.sampleRate);
    var d = buf.getChannelData(0);
    var s = seed >>> 0;
    for (var i = 0; i < n; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      d[i] = (s / 2147483648) - 1;
    }
    return buf;
  }

  // 窄脉冲波表（train~ 2.2727ms / 0.03 �?duty 1.32%�?  function pulseWave(ctx, duty) {
    var N = 512, real = new Float32Array(N), imag = new Float32Array(N);
    for (var n = 1; n < N; n++) real[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
    return ctx.createPeriodicWave(real, imag);   // 默认归一化到峰�?1（与 train~ �?±1 对齐�?  }

  // 一阶低通（Max onepole~）：y[n] = y[n-1] + a0·(x[n] �?y[n-1])
  //   官方参考（docs.cycling74.com/.../onepole~）：a0 = sin(fc·π/nyquist) = sin(2π·fc/fs)
  //   注意：不是常见的 1−exp(�?πfc/fs)。两者在 fc<<fs 时接近，但在 6 kHz 处差别很�?  //   �?.776 vs 0.588）——用错公式会让源音的倾斜滤波过重（高频缺一大块）�?  function onePole(ctx, fc) {
    var sr = ctx.sampleRate;
    var nyq = sr / 2;
    var a = Math.sin(clamp(fc, 1, nyq * 0.999) * Math.PI / nyq);
    return ctx.createIIRFilter([a], [1, -(1 - a)]);
  }

  // 硬削波曲线（clip~ -1. 1.�?  function clipCurve() {
    var n = 4096, c = new Float32Array(n);
    for (var i = 0; i < n; i++) { var x = i * 2 / (n - 1) - 1; c[i] = clamp(x, -1, 1); }
    return c;
  }
  // 位深量化曲线（degrade~ �?�?= 位深 6�?  function quantCurve(bits) {
    var n = 65536, c = new Float32Array(n), lv = Math.pow(2, bits - 1);
    for (var i = 0; i < n; i++) { var x = i * 2 / (n - 1) - 1; c[i] = Math.round(x * lv) / lv; }
    return c;
  }

  // Max reson~ �?*确切**实现（docs.cycling74.com/refpages/reson~）：
  //   y[n] = a0·(x[n] �?r·x[n-2]) + b1·y[n-1] + b2·y[n-2]      Q = cf/bandwidth
  //   bw = cf/Q ; r = exp(-π·bw/fs) ; b1 = 2r·cos(2π·cf/fs) ; b2 = -r² ; a0 = gain·(1-r)
  //   峰值增�?= a0/(1-r) = gain（在 z = e^{jθ} 处分子分母的 (1-r·e^{-j2θ}) 正好相消�?  //   零点�?z = ±√r �?天然抑制 DC �?Nyquist（这才是它低频不泄漏的原因）
  //   �?坑：无零点的“纯二极点”看起来更像“谐振器”，但会把带宽做宽一倍并在低频泄漏；
  //     �?r 必须�?exp(-π·bw/fs)，不�?1-2π·cf/(Q·fs)�?  function reson2(ctx, cf, q, gain) {
    var sr = ctx.sampleRate;
    var bw = cf / Math.max(0.01, q);
    var r = Math.exp(-Math.PI * bw / sr);
    if (r > 0.9999999) r = 0.9999999;
    var th = 2 * Math.PI * cf / sr;
    var b1 = 2 * r * Math.cos(th);
    var b2 = -(r * r);
    var a0 = gain * (1 - r);
    return ctx.createIIRFilter([a0, 0, -a0 * r], [1, -b1, -b2]);
  }

  function holdTo(param, time) {          // 取消后续自动化但保持当前值（避免跳变�?    try { param.cancelAndHoldAtTime(time); } catch (e) { try { param.cancelScheduledValues(time); } catch (e2) { } }
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
    var ctx = this.ctx, sr = this.sr, P = this.params;

    // ---------- 共享噪声 + 两个振荡器（连续运行，与 Max �?noise~/saw~/train~ 同构�?----------
    this.noiseBuf = makeNoiseBuffer(ctx, 2.0, ctx.__divaSeed || 20260918);
    this.noise = ctx.createBufferSource(); this.noise.buffer = this.noiseBuf; this.noise.loop = true;
    this.saw = ctx.createOscillator(); this.saw.type = 'sawtooth'; this.saw.frequency.value = 440;
    this.pulse = ctx.createOscillator();
    this.pulse.setPeriodicWave(pulseWave(ctx, 0.03 / 2.2727)); this.pulse.frequency.value = 440;

    // ---------- 音源�?----------
    this.sawLev = ctx.createGain(); this.sawLev.gain.value = 0.2;
    this.trainLev = ctx.createGain(); this.trainLev.gain.value = 1.0;
    this.srcMix = ctx.createGain(); this.srcMix.gain.value = 1.0;
    this.saw.connect(this.sawLev).connect(this.srcMix);
    this.pulse.connect(this.trainLev).connect(this.srcMix);

    // 电平标定：Web Audio 振荡�?滤波器的固有标度�?Max �?saw~ / train~ / reson~ 不同�?    // 未标定时整链�?Max 版热 ~5.8 dB（与参考渲�?test/ref-line1-mono.wav 实测比对）�?    // 用一个显式、可调的常量对齐到参考响度（峰�?0.046 / RMS 0.0067）；设为 1.0 即还原原始电平�?    // 放在源端（毛刺层之前）而不是输出端，是为了让量化毛刺也工作�?Max 版同档电平上�?    this.cal = ctx.createGain(); this.cal.gain.value = C.cal;
    this.srcMix.connect(this.cal);

    this.tilt = onePole(ctx, 250 * Math.pow(44, P.bright));      // bright 控制（默�?0.85 -> 6230Hz�?    this._bright = P.bright;
    this.cal.connect(this.tilt);

    // 存在感：hp = tilt - onepole~700(tilt) ; press = tilt + 3.4*hp
    this.presLp = onePole(ctx, 700);
    this.presInv = ctx.createGain(); this.presInv.gain.value = -1;
    this.pressHp = ctx.createGain(); this.pressHp.gain.value = 1.0;   // = tilt - lp700(tilt)
    this.press = ctx.createGain(); this.press.gain.value = 1.0;       // = tilt + 3.4*hp
    this.presG = ctx.createGain(); this.presG.gain.value = (P.presG === undefined ? 3.4 : P.presG);   // 存在感提升量（引擎常�?3.4�?    this.tilt.connect(this.presLp).connect(this.presInv).connect(this.pressHp);
    this.tilt.connect(this.pressHp);          // +tilt
    this.pressHp.connect(this.presG).connect(this.press);   // +3.4*hp
    this.tilt.connect(this.press);            // PRESS 的“原�?tilt”支路（绝不能漏�?
    // 气声带（BRES�? 空气带（AIRRES）—�?air 走增益域（与 Max 完全同构�?    this.bres = reson2(ctx, 2800, 1.4, 0.45);
    this.airres = reson2(ctx, 5500, 1.2, 0.35);
    this.airLev = ctx.createGain(); this.airLev.gain.value = 0.22;
    this.noise.connect(this.bres);
    this.noise.connect(this.airres);
    this.airres.connect(this.airLev);

    // 气声电平信号 = breath(常数) + puff(包络) + 0.22*air  —�? BRLEV.gain
    this.brLev = ctx.createGain(); this.brLev.gain.value = 0;
    this.breathConst = ctx.createConstantSource(); this.breathConst.offset.value = P.breath;
    this.puff = ctx.createConstantSource(); this.puff.offset.value = 0;
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

    // ---------- 元音�?MUTE = SRCS × VG ----------
    this.vGate = ctx.createGain(); this.vGate.gain.value = 0;
    this.srcs.connect(this.vGate);

    // ---------- 5 元音 × 4 共振�?并联 ----------
    this.xfade = [];
    this.vowelSum = ctx.createGain(); this.vowelSum.gain.value = 1.0;
    for (var v = 0; v < 5; v++) {
      var xf = ctx.createGain(); xf.gain.value = (v === 0 ? 1 : 0);
      var F = FORMANTS[VOWEL_NAMES[v]];
      for (var k = 0; k < 4; k++) {
        var res = reson2(ctx, F[k][0], F[k][0] / F[k][1], GTRIM[k]);
        this.vGate.connect(res).connect(xf);
      }
      xf.connect(this.vowelSum);
      this.xfade.push(xf);
    }

    // ---------- 主总线：�?.5 -> ADSR -> 600Hz 低搁�?----------
    this.vtrim = ctx.createGain(); this.vtrim.gain.value = C.vtrim;
    this.vowelSum.connect(this.vtrim);
    this.env = ctx.createGain(); this.env.gain.value = 0;
    this.vtrim.connect(this.env);

    this.shelfLp = onePole(ctx, 600);
    this.shelfInv = ctx.createGain(); this.shelfInv.gain.value = -C.shelfAmt;
    this.shelfSum = ctx.createGain(); this.shelfSum.gain.value = 1.0;
    this.env.connect(this.shelfSum);
    this.env.connect(this.shelfLp).connect(this.shelfInv).connect(this.shelfSum);

    // ---------- 辅音层：6 个固定噪声谐振器 + selector~ 式切换（与引擎同构） ----------
    this.cBandSel = [];
    this.cNoiseLvl = ctx.createGain(); this.cNoiseLvl.gain.value = 0;
    this.cVbarLp = onePole(ctx, 800);
    this.cVbarLvl = ctx.createGain(); this.cVbarLvl.gain.value = 0;
    this.cSum = ctx.createGain(); this.cSum.gain.value = 1.0;
    this.cTrim = ctx.createGain(); this.cTrim.gain.value = C.ctrim;
    this.cEnv = ctx.createGain(); this.cEnv.gain.value = 0;
    for (var bi = 1; bi <= 6; bi++) {
      var cb = CBR[bi];
      var bres = reson2(ctx, cb.f, cb.q, cb.g);
      var sel = ctx.createGain(); sel.gain.value = (bi === 1 ? 1 : 0);   // selector~ 6 1 的初�?      this.noise.connect(bres).connect(sel).connect(this.cNoiseLvl);
      this.cBandSel.push(sel);
    }
    this.cNoiseLvl.connect(this.cSum);
    this.srcs.connect(this.cVbarLp).connect(this.cVbarLvl).connect(this.cSum);
    this.cSum.connect(this.cTrim).connect(this.cEnv);

    // 主汇�?    this.mix = ctx.createGain(); this.mix.gain.value = 1.0;
    this.shelfSum.connect(this.mix);
    this.cEnv.connect(this.mix);

    // ---------- 复古毛刺层（可选，默认 0.2�?----------
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

    // ---------- 音高表情：颤�?+ scoop（相加，单位 cents，进 osc.detune�?----------
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

    // 给所有被自动化的参数�?t=0 铺一个显式事件：
    // 否则“无前置事件�?linearRamp”起点不确定（Chrome 下会变成无渐变），离线渲染会静音�?    [this.vGate.gain, this.env.gain, this.cEnv.gain, this.puffEnv.gain,
     this.vibEnv.gain, this.scoop.offset, this.breathConst.offset,
     this.puff.offset, this.rgWet.gain, this.rgDry.gain, this.outGain.gain,
     this.vibDepth.gain, this.vtrim.gain, this.sawLev.gain, this.trainLev.gain,
     this.presInv.gain, this.pressHp.gain, this.press.gain, this.presG.gain,
     this.cNoiseLvl.gain,
     this.cVbarLvl.gain, this.cTrim.gain, this.airLev.gain,
     this.cal.gain, this.levelSum.gain, this.rgWetG.gain, this.vowelSum.gain,
     this.shelfInv.gain, this.shelfSum.gain, this.mix.gain, this.post.gain
    ].forEach(function (p) { p.setValueAtTime(p.value, 0); });
    for (var q = 0; q < 5; q++) this.xfade[q].gain.setValueAtTime(this.xfade[q].gain.value, 0);
    for (var q2 = 0; q2 < 6; q2++) this.cBandSel[q2].gain.setValueAtTime(this.cBandSel[q2].gain.value, 0);

    this.setParams(P, 0);
  };

  // ---------------------------------------------------------- 参数（音色五参）
  DivaEngine.prototype.setParams = function (p, when) {
    when = when || 0;
    var self = this;
    Object.keys(p).forEach(function (k) { self.params[k] = p[k]; });
    if (p.breath !== undefined) {
      this._ramp(this.breathConst.offset, when, clamp(p.breath, 0, 1), t(C.paramSmp, this.sr));
    }
    if (p.bright !== undefined && this._bright !== p.bright) {
      this._bright = p.bright;
      this._setBright(clamp(p.bright, 0, 1));
    }
    if (p.puff !== undefined) this._ramp(this.puff.offset, when, clamp(p.puff, 0, 1), t(C.paramSmp, this.sr));
    if (p.presG !== undefined) this.presG.gain.setValueAtTime(p.presG, when);   // 存在感提升量（引擎常量，默认 3.4�?    if (p.vib !== undefined) this._ramp(this.vibDepth.gain, when, Math.max(0, p.vib), t(C.paramSmp, this.sr));
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
  DivaEngine.prototype._setBright = function (b) {
    var ctx = this.ctx, fc = 250 * Math.pow(44, b);
    var neo = onePole(ctx, fc);
    try { this.cal.disconnect(this.tilt); } catch (e) { }
    try { this.tilt.disconnect(); } catch (e) { }
    try { this.presLp.disconnect(this.presInv); } catch (e) { }
    this.tilt = neo;
    this.cal.connect(this.tilt);
    this.tilt.connect(this.presLp);       // 存在感的固定 700Hz 参考支路（onepole~ 700�?    this.tilt.connect(this.pressHp);
    this.tilt.connect(this.press);
    this.presLp.connect(this.presInv);
  };

  // ---------------------------------------------------------- 元音切换（交叉淡�?~45ms�?  DivaEngine.prototype.setVowel = function (idx, when) {
    if (idx === null || idx === undefined || idx < 0 || idx > 4) return;
    var d = t(C.xfadeSmp, this.sr);
    for (var i = 0; i < 5; i++) {
      var target = (i === idx) ? 1 : 0;
      var g = this.xfade[i].gain;
      holdTo(g, when);
      g.linearRampToValueAtTime(target, when + d);
    }
  };

  // ---------------------------------------------------------- 音符
  // note: {midi, cons, vowel|null, glideMs(0), prevMidi|null}
  DivaEngine.prototype.noteOn = function (t0, note) {
    var c = CTAB[note.cons] || CTAB[0];
    var bStart = c[1] / 1000, dur = c[2] / 1000;
    var st = this._cur = {
      t0: t0, dur: dur, vowel: note.vowel, adsr: false,
      glideMs: note.glideMs || 0,
      hasVowel: (note.vowel !== null && note.vowel !== undefined),
      hasCons: (c[4] > 0 || c[5] > 0)
    };

    // --- 音高：滑音（MIDI 线�?= 频率指数�?--
    var f = mtof(note.midi);
    var glide = (note.glideMs || 0) / 1000;
    [this.saw.frequency, this.pulse.frequency].forEach(function (fp) {
      holdTo(fp, t0);
      if (glide > 0.001 && note.prevMidi != null) {
        fp.setValueAtTime(mtof(note.prevMidi), t0);
        fp.exponentialRampToValueAtTime(Math.max(1, f), t0 + glide);
      } else {
        fp.setValueAtTime(f, t0);
      }
    });

    // --- scoop：gate�?�?�?4 cents，元音门打开�?120ms 归零 ---
    holdTo(this.scoop.offset, t0);
    this.scoop.offset.setValueAtTime(-C.scoopCents, t0);
    if (dur <= (note.gateMs || 1e9) / 1000) {
      this.scoop.offset.setValueAtTime(-C.scoopCents, t0 + dur);
      this.scoop.offset.linearRampToValueAtTime(0, t0 + dur + C.scoopA);
    }

    // --- 辅音段：噪声带切换（selector~ 语义�? 电平 + 爆发包络 ---
    for (var bi = 0; bi < 6; bi++) this.cBandSel[bi].gain.setValueAtTime((bi === (c[3] - 1)) ? 1 : 0, t0);
    this.cNoiseLvl.gain.setValueAtTime(c[4], t0);
    this.cVbarLvl.gain.setValueAtTime(c[5], t0);
    var ce = this.cEnv.gain, up = t(C.consUpSmp, this.sr), dn = t(C.consDnSmp, this.sr);
    holdTo(ce, t0);
    ce.setValueAtTime(0, t0);
    if (c[4] > 0 || c[5] > 0) {
      ce.setValueAtTime(0, t0 + bStart);
      ce.linearRampToValueAtTime(1, t0 + bStart + up);
      ce.linearRampToValueAtTime(0, t0 + dur + dn);
    } else {
      ce.setValueAtTime(0, t0 + dur);      // cons=0/12/13：不产生辅音爆发
    }

    // --- 元音门：durMs 后打开 ---
    var vg = this.vGate.gain, vup = t(C.vgUpSmp, this.sr);
    holdTo(vg, t0);
    vg.setValueAtTime(0, t0);
    vg.setValueAtTime(0, t0 + dur);
    if (note.vowel !== null && note.vowel !== undefined) vg.linearRampToValueAtTime(1, t0 + dur + vup);

    // --- 元音目标：glide 辅音(y/w) 先落 i/u，gate�?70ms 再切到目�?---
    var tg = c[6];
    if (tg === 1) this.setVowel(1, t0);
    else if (tg === 2) this.setVowel(2, t0);
    var vt = t0 + C.vowelTargetMs / 1000;
    if (note.vowel !== null && note.vowel !== undefined) this.setVowel(note.vowel, vt);
    return st;
  };

  // gate�?：辅�?元音门收�?+ ADSR/颤音释放
  DivaEngine.prototype.noteOff = function (t1) {
    var st = this._cur; if (!st) return;
    var tOpen = st.t0 + st.dur;

    // �?辅音段若还没走完（gate�?早于 durMs，如「ん�?000ms）→ 在此收尾
    if (st.hasCons && t1 < tOpen) {
      var ce = this.cEnv.gain;
      ce.cancelScheduledValues(t1);
      ce.setValueAtTime(1, t1);
      ce.linearRampToValueAtTime(0, t1 + t(C.consDnSmp, this.sr));
    }

    // �?元音门没打开：保持关闭（�?ADSR / �?puff�?    if (!st.hasVowel || t1 < tOpen) {
      var vg0 = this.vGate.gain;
      vg0.cancelScheduledValues(t1); vg0.setValueAtTime(0, t1);
      holdTo(this.scoop.offset, t1); this.scoop.offset.setValueAtTime(-C.scoopCents, t1);
      this._cur = null;
      return;
    }

    // �?正常收尾：门关（6.8ms�? ADSR 释放�?50ms�? 颤音释放�?00ms�? puff 释放�?0ms�?    var vg = this.vGate.gain;
    vg.cancelScheduledValues(t1); vg.setValueAtTime(1, t1);
    vg.linearRampToValueAtTime(0, t1 + t(C.vgDnSmp, this.sr));

    var eg = this.env.gain;
    holdTo(eg, t1);
    eg.linearRampToValueAtTime(0, t1 + C.adsrR);

    var ve = this.vibEnv.gain;
    holdTo(ve, t1); ve.linearRampToValueAtTime(0, t1 + C.vibRelease);

    var pe = this.puffEnv.gain;
    holdTo(pe, t1); pe.linearRampToValueAtTime(0, t1 + C.puffR);

    this._cur = null;
  };

  // 元音门打开的时刻（�?noteOn 内部/外部计算用）
  DivaEngine.prototype.markVowelOpen = function (t0, note) {
    var c = CTAB[note.cons] || CTAB[0], dur = c[2] / 1000, tOpen = t0 + dur;
    if (note.vowel === null || note.vowel === undefined) return;
    // ADSR 触发（起音从当前值开始）
    var eg = this.env.gain;
    holdTo(eg, tOpen);
    eg.linearRampToValueAtTime(1, tOpen + C.adsrA);
    eg.linearRampToValueAtTime(C.adsrS, tOpen + C.adsrA + C.adsrD);
    // 颤音渐入 400ms
    var ve = this.vibEnv.gain;
    holdTo(ve, tOpen);
    ve.linearRampToValueAtTime(1, tOpen + C.vibOnset);
    // puff�?5ms �?-> 180ms 落到 0.1（源�?puff 常量；包�?0..1�?    var pe = this.puffEnv.gain, pf = this.params.puff == null ? 0.35 : this.params.puff;
    holdTo(pe, tOpen);
    pe.setValueAtTime(0, tOpen);
    if (pf > 0) {
      pe.linearRampToValueAtTime(1, tOpen + C.puffA);
      pe.linearRampToValueAtTime(C.puffS, tOpen + C.puffA + C.puffD);
    }
    if (this._cur) this._cur.adsr = true;
  };

  // 一个完整音符（noteOn + 元音门开�?+ gate↓）
  DivaEngine.prototype.playNote = function (t0, note) {
    var c = CTAB[note.cons] || CTAB[0];
    this.noteOn(t0, note);
    // 元音门只有在音符长度 �?辅音段时长时才会真的打开（与引擎 DLB/MSTOP 一致）
    if (note.vowel !== null && note.vowel !== undefined && (note.gateMs / 1000) >= (c[2] / 1000)) {
      this.markVowelOpen(t0, note);
    }
    this.noteOff(t0 + (note.gateMs / 1000));
    return this;
  };

  // 硬停（停止播�?/ 出错兜底）：立刻收干净
  DivaEngine.prototype.panic = function (when) {
    when = when || 0;
    var d = 0.02;
    [this.env.gain, this.cEnv.gain, this.puffEnv.gain, this.vibEnv.gain].forEach(function (p) {
      holdTo(p, when); p.linearRampToValueAtTime(0, when + d);
    });
    holdTo(this.vGate.gain, when); this.vGate.gain.setValueAtTime(this.vGate.gain.value, when); this.vGate.gain.linearRampToValueAtTime(0, when + d);
    this._cur = null;
  };

  // ---------------------------------------------------------- 全序列渲染（离线导出�?  DivaEngine.render = function (opts) {
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
  // 注意：必须合并而不是覆盖——tables.js 先加载并挂了 grid/parseSeq/SEION �?  root.DIVA_TABLES = Object.assign(root.DIVA_TABLES || {}, {
    FORMANTS: FORMANTS, CTAB: CTAB, CBR: CBR, GTRIM: GTRIM,
    VOWEL_NAMES: VOWEL_NAMES, DEFAULTS: DEFAULTS, CONST: C, mtof: mtof, dbtoa: dbtoa
  });
})(typeof window !== 'undefined' ? window : globalThis);
