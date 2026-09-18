/* ============================================================================
 * app.js — DIVA-01 Web 面板（Canvas 2D 自绘 + 交互）
 *   布局/配色复刻 Max 版 stepA/roll.js：画布 1280×800
 *     底 #0A0E13 · 卡 #121820 · 青 #39C5BB · 粉 #F2A9DA
 *   顶部传输条 / 左侧五十音 pad / 中央卷帘（示例 13 音 + 假名标签）/ 底部按钮行 + 音色五参
 * ========================================================================== */
(function () {
  'use strict';
  var T = window.DIVA_TABLES, W = window.DIVA_WAV;

  // ---------------------------------------------------------------- 设计尺寸
  var W0 = 1280, H0 = 800;
  var CLR = {
    bg: '#0A0E13', card: '#121820', card2: '#161E27', edge: '#24313D',
    teal: '#39C5BB', pink: '#F2A9DA', red: '#E5484D', t1: '#DFF3F6', t2: '#7C8B98',
    tealDim: '#1E4A48', pinkDim: '#4A3244'
  };
  var F_LAT = 'Arial, Helvetica, sans-serif';
  var F_KAN = '"Meiryo", "Yu Gothic", "MS PGothic", sans-serif';
  var F_MON = '"Cascadia Mono", Consolas, monospace';

  // 布局（与 roll.js 同几何）
  var TOP_H = 60, LX = 8, LW = 304, TAB_Y = 76, TAB_H = 26, KG_Y = 108, KG_H = 552;
  var RX = 320, RW = 952, RUL_Y = 68, RUL_H = 32, KEY_X = 320, KEY_W = 52;
  var GX = RX + KEY_W, GW = RX + RW - GX, GY = RUL_Y + RUL_H, ROWH = 15, NROWS = 37, TOP_MIDI = 84;
  var GH = ROWH * NROWS, BOT_Y = 668;

  var BTN = {
    play: [310, 12, 44, 38], stop: [360, 12, 44, 38], rew: [410, 12, 44, 38],
    demo: [460, BOT_Y + 6, 88, 30], clear: [556, BOT_Y + 6, 88, 30], exp: [652, BOT_Y + 6, 138, 30]
  };
  var PAR = [
    { id: 'breath', name: 'BREATH', cn: '气声', min: 0, max: 1, step: 0.01 },
    { id: 'bright', name: 'BRIGHT', cn: '亮度', min: 0, max: 1, step: 0.01 },
    { id: 'vib', name: 'VIBRATO', cn: '颤音', min: 0, max: 60, step: 1 },
    { id: 'gain', name: 'GAIN', cn: '音量', min: -48, max: 0, step: 1 }
  ];
  var PAR_RECT = [[8, BOT_Y + 44, 176, 76], [192, BOT_Y + 44, 176, 76], [376, BOT_Y + 44, 176, 76], [560, BOT_Y + 44, 176, 76]];
  var GLT_RECT = [748, BOT_Y + 44, 200, 76];

  var state = {
    notes: [], total: 0, tab: 0, playing: 0, playBase: 0, timers: [],
    curIdx: -1, litKana: null, sel: -1, status: '就绪 · 点 ▶ 播放示例，点五十音格试听音节',
    mat: null, timers2: [],
    params: { breath: 0.28, bright: 0.55, vib: 30, gain: -10, puff: 0.35, glitch: 0.2, glitchOn: 1 },
    exporting: false, lastExportName: '', lastStats: null, drag: null, dirty: true
  };

  var cv, g, DPR = 1, ac = null, eng = null;

  // ---------------------------------------------------------------- 小工具
  function rgba(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function rr(x, y, w, h, fill, stroke, lw, rad) {
    g.beginPath();
    var r = rad || 0;
    g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
    g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw || 1; g.stroke(); }
  }
  function ln(x1, y1, x2, y2, col, lw, a) {
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2);
    g.strokeStyle = a === undefined ? col : rgba(col, a); g.lineWidth = lw || 1; g.stroke();
  }
  function txt(s, x, y, size, font, align, bold, col) {
    g.font = (bold ? 'bold ' : '') + size + 'px ' + font;
    g.textAlign = align || 'left'; g.textBaseline = 'alphabetic';
    g.fillStyle = col || CLR.t1; g.fillText(s, x, y);
  }
  function fcir(x, y, r, col, a) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = rgba(col, a === undefined ? 1 : a); g.fill(); }
  // ---- v3 视觉皮工具：微光 / 仪表环 / LED ----
  function glow(col, blur) { g.shadowColor = rgba(col, 0.9); g.shadowBlur = blur === undefined ? 12 : blur; }
  function noGlow() { g.shadowBlur = 0; g.shadowColor = 'transparent'; }
  function arc(cx, cy, r, a0, a1, col, w, a) {
    if (a1 <= a0) return;
    g.beginPath(); g.arc(cx, cy, r, a0, a1);
    g.strokeStyle = rgba(col, a === undefined ? 1 : a); g.lineWidth = w || 2; g.stroke();
  }
  function led(x, y, s, on, col) {
    var c = on ? (col || CLR.teal) : '#1B252E';
    rr(x - s / 2, y - s / 2, s, s, c, on ? c : CLR.edge, 1, 2);
    if (on) { glow(c, 8); rr(x - s / 2, y - s / 2, s, s, c, c, 1, 2); noGlow(); }
  }
  // 旋钮（仪表环语言）：270° 刻度环 + 数值弧 + 中心读数
  function knob(cx, cy, r, u, col, active) {
    var A0 = 0.75 * Math.PI, SW = 1.5 * Math.PI;
    arc(cx, cy, r, A0, A0 + SW, '#24313D', 3.5, 1);            // 轨道
    for (var i = 0; i <= 10; i++) {                            // 刻度
      var a = A0 + SW * (i / 10);
      var inR = r - 6, outR = r - 2.5;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * inR, cy + Math.sin(a) * inR);
      g.lineTo(cx + Math.cos(a) * outR, cy + Math.sin(a) * outR);
      g.strokeStyle = (u >= i / 10 - 0.001) ? rgba(col, 0.75) : '#2A3238';
      g.lineWidth = 1.4; g.stroke();
    }
    if (active) glow(col, 10);
    arc(cx, cy, r, A0, A0 + SW * Math.max(0.002, u), col, 3.5, 1);   // 数值弧
    noGlow();
    fcir(cx, cy, r - 9, '#0E1319');                             // 轴心
    arc(cx, cy, r - 9, 0, Math.PI * 2, '#1D262E', 1.2, 1);
    var pa = A0 + SW * u;                                       // 指针
    g.beginPath();
    g.moveTo(cx + Math.cos(pa) * (r - 12), cy + Math.sin(pa) * (r - 12));
    g.lineTo(cx + Math.cos(pa) * (r - 5), cy + Math.sin(pa) * (r - 5));
    g.strokeStyle = rgba(col, 0.95); g.lineWidth = 2.2; g.stroke();
  }

  function rowY(midi) { return GY + (TOP_MIDI - midi) * ROWH; }
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function now() { return (new Date()).getTime(); }
  function inRect(p, r) { return p.x >= r[0] && p.x <= r[0] + r[2] && p.y >= r[1] && p.y <= r[1] + r[3]; }

  // ---------------------------------------------------------------- 音频
  function audio() {
    if (!ac) {
      var AC = window.AudioContext || window.webkitAudioContext;
      ac = new AC({ sampleRate: 44100 });
      eng = new window.DivaEngine(ac, { params: state.params });
      window.__diva = window.__diva || {};
      window.__diva.engine = eng; window.__diva.ctx = ac;
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }

  // ---------------------------------------------------------------- 序列
  function loadDemo() {
    var p = T.parseSeq(T.DEMO_SEQ);
    state.notes = p.notes; state.total = p.total; state.curIdx = -1;
    state.status = '示例：世界で一番お姫様 · ' + p.notes.length + ' 音 / ' + (p.total / 1000).toFixed(2) + ' s';
    redraw();
  }
  function clearAll() {
    state.notes = []; state.total = 0; state.curIdx = -1; state.sel = -1;
    state.status = '已清空';
    redraw();
  }

  // ---------------------------------------------------------------- 播放
  function stopTimers() { for (var i = 0; i < state.timers.length; i++) clearTimeout(state.timers[i]); state.timers = []; }
  function play() {
    if (!state.notes.length) { state.status = '没有音符（先点「示例」）'; redraw(); return; }
    audio(); stopTimers();
    var lead = 0.15, t0 = ac.currentTime;
    state.playBase = t0 + lead; state.playing = 1;
    var total = state.total / 1000;
    for (var i = 0; i < state.notes.length; i++) {
      (function (i) {
        var n = state.notes[i], prev = i > 0 ? state.notes[i - 1] : null;
        var ms = (n.t / 1000 + lead - 0.03) * 1000;
        state.timers.push(setTimeout(function () {
          state.curIdx = i;
          var k = null;
          if (n.vowel !== null) { k = findKana(n.cons, n.vowel); state.litKana = k ? k.k : null; }
          else { var kk = findKana(n.cons, null); state.litKana = kk ? kk.k : null; }
          eng.playNote(ac.currentTime + 0.03, {
            midi: n.midi, cons: n.cons, vowel: n.vowel,
            glideMs: (n.glide > 0 && prev) ? n.glide : 0, prevMidi: prev ? prev.midi : null, gateMs: n.d
          });
        }, Math.max(0, ms)));
      })(i);
    }
    state.timers.push(setTimeout(function () {
      state.playing = 0; state.curIdx = -1; state.litKana = null;
      state.status = '播放完毕 · ' + (state.total / 1000).toFixed(2) + ' s';
      redraw();
    }, (total + lead) * 1000 + 250));
    state.status = '播放中 · ' + state.notes.length + ' 音 / ' + total.toFixed(2) + ' s';
    redraw();
  }
  function stop() {
    stopTimers();
    if (eng) eng.panic();
    state.playing = 0; state.curIdx = -1; state.litKana = null;
    state.status = '已停止'; redraw();
  }
  function rewind() { stop(); state.status = '回到起点'; redraw(); }

  function findKana(c, v) {
    var all = T.SEION.concat(T.DAKU, T.HANDAKU);
    for (var r = 0; r < all.length; r++) for (var i = 0; i < all[r].length; i++) {
      var e = all[r][i];
      if (e && e.c === c && (v === null ? e.v === null : e.v === v)) return e;
    }
    return null;
  }

  // ---------------------------------------------------------------- 试听（五十音格 / 卷帘音符）
  function audition(cons, vowel, midi, glideMs) {
    audio(); stop();
    var t0 = ac.currentTime + 0.04;
    eng.playNote(t0, { midi: midi, cons: cons, vowel: vowel, glideMs: glideMs || 0, prevMidi: null, gateMs: 520 });
    state.litKana = (findKana(cons, vowel) || {}).k || null;
    setTimeout(function () { state.litKana = null; redraw(); }, 620);
    redraw();
  }

  // ---------------------------------------------------------------- 绘制
  function redraw() { state.dirty = true; }

  function draw() {
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.fillStyle = CLR.bg; g.fillRect(0, 0, W0, H0);
    drawTop(); drawKana(); drawRoll(); drawBottom();
    if (state.playing) drawPlayhead();
  }

  function drawTop() {
    rr(0, 0, W0, TOP_H, CLR.card, null, 0, 0);
    ln(0, TOP_H - 1, W0, TOP_H - 1, CLR.edge, 1);
    txt('DIVA-01', 14, 37, 19, F_LAT, 'left', true, CLR.teal);
    txt('VOCAL SYNTH', 116, 36, 11, F_LAT, 'left', false, CLR.t2);

    var on = state.playing === 1;
    // ▶ 圆钮 + 播放进度仪表环（D-2 语言）
    var pcx = BTN.play[0] + BTN.play[2] / 2, pcy = BTN.play[1] + BTN.play[3] / 2;
    var prog = 0;
    if (state.playing && ac) prog = Math.min(1, Math.max(0, (ac.currentTime - state.playBase) / Math.max(0.001, state.total / 1000)));
    arc(pcx, pcy, 24, -Math.PI / 2 + Math.PI * 2 * prog, 1.5 * Math.PI, '#24313D', 3, 1);
    if (on) glow(CLR.pink, 10);
    arc(pcx, pcy, 24, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.002, prog), CLR.pink, 3, 0.95);
    noGlow();
    if (on) glow(CLR.teal, 12);
    fcir(pcx, pcy, 16, on ? CLR.teal : CLR.card2);
    noGlow();
    if (on) { rr(pcx - 5, pcy - 5, 10, 10, CLR.bg, null, 0, 2); }
    else {
      g.beginPath(); g.moveTo(pcx - 5, pcy - 8); g.lineTo(pcx - 5, pcy + 8); g.lineTo(pcx + 9, pcy);
      g.closePath(); g.fillStyle = CLR.teal; g.fill();
    }
    rr(BTN.stop[0], BTN.stop[1], BTN.stop[2], BTN.stop[3], CLR.card2, CLR.edge, 1.2, 6);
    rr(BTN.stop[0] + 17, BTN.stop[1] + 13, 12, 12, CLR.pink, null, 0, 2);
    rr(BTN.rew[0], BTN.rew[1], BTN.rew[2], BTN.rew[3], CLR.card2, CLR.edge, 1.2, 6);
    g.beginPath(); g.moveTo(BTN.rew[0] + 29, BTN.rew[1] + 12); g.lineTo(BTN.rew[0] + 29, BTN.rew[1] + 27); g.lineTo(BTN.rew[0] + 18, BTN.rew[1] + 19.5);
    g.closePath(); g.fillStyle = CLR.t1; g.fill();
    rr(BTN.rew[0] + 14, BTN.rew[1] + 12, 4, 15, CLR.t1, null, 0, 1);

    rr(470, 12, 244, 38, CLR.card2, CLR.edge, 1.2, 6);
    txt('SEQUENCE', 480, 26, 9, F_MON, 'left', false, CLR.t2);
    txt(state.notes.length + ' 音 / ' + (state.total / 1000).toFixed(2) + ' s', 480, 44, 15, F_LAT, 'left', true, CLR.t1);

    rr(1028, 8, 244, 46, CLR.card2, CLR.edge, 1.2, 8);
    var el = state.playing ? Math.min(state.total / 1000, ac ? Math.max(0, ac.currentTime - state.playBase) : 0) : 0;
    txt('NOW ' + el.toFixed(2) + ' s', 1036, 24, 9, F_MON, 'left', false, CLR.t2);
    var n = state.curIdx >= 0 ? state.notes[state.curIdx] : null;
    if (n) glow(CLR.pink, 14);
    txt(n ? (n.r || '-') : '—', 1036, 48, 24, F_KAN, 'left', true, state.curIdx >= 0 ? CLR.pink : CLR.t1);
    noGlow();
    if (n) txt('midi ' + n.midi + ' · cons ' + n.cons + ' · v ' + (n.vowel === null ? 'n' : n.vowel), 1128, 46, 10, F_MON, 'left', false, CLR.t2);
    led(1256, 20, 7, !!state.playing, CLR.teal);          // 运行 LED
    led(1256, 42, 7, state.curIdx >= 0, CLR.pink);        // 发声 LED
  }

  function drawKana() {
    rr(LX, 68, LW, 600, CLR.card2, CLR.edge, 1.2, 8);
    txt('KANA', LX + LW - 10, 88, 10, F_LAT, 'right', false, CLR.t2);
    var names = ['清音', '浊音', '半浊音', '拗音'];
    for (var i = 0; i < 4; i++) {
      var tw = (LW - 16) / 4, x = LX + 8 + i * tw;
      var on = state.tab === i;
      if (on) glow(CLR.teal, 10);
      rr(x + 2, TAB_Y, tw - 4, TAB_H, on ? CLR.teal : CLR.card, on ? CLR.teal : CLR.edge, 1.2, 6);
      noGlow();
      led(x + 13, TAB_Y + 13, 8, on, on ? CLR.bg : '#3B5560');   // LED 必须在页签底色之后画
      txt(names[i], x + 24 + (tw - 28) / 2, TAB_Y + 17, 12, F_KAN, 'center', true, on ? CLR.bg : CLR.t2);
    }
    var gd = T.grid(state.tab);
    var cw = (LW - 8) / gd.cols, ch = KG_H / Math.max(gd.rows.length, 1);
    for (var r = 0; r < gd.rows.length; r++) for (var c = 0; c < gd.cols; c++) {
      var rc = { x: LX + 4 + c * cw + 2, y: KG_Y + r * ch + 2, w: cw - 4, h: ch - 4 };
      var e = gd.rows[r][c];
      if (!e) { rr(rc.x, rc.y, rc.w, rc.h, CLR.card, null, 0, 5); continue; }
      var lit = (state.litKana === e.k);
      if (lit) glow(CLR.teal, 14);
      rr(rc.x, rc.y, rc.w, rc.h, lit ? CLR.teal : CLR.card, lit ? CLR.teal : CLR.edge, lit ? 2 : 1.1, 5);
      noGlow();
      txt(e.k, rc.x + rc.w / 2, rc.y + rc.h * 0.64, (gd.cols === 3 ? 26 : 22), F_KAN, 'center', true, lit ? CLR.bg : CLR.t1);
      txt(e.r, rc.x + rc.w / 2, rc.y + rc.h - 5, 10, F_MON, 'center', false, lit ? CLR.bg : CLR.t2);
      if (lit) led(rc.x + rc.w - 7, rc.y + 8, 5, true, CLR.pink);   // 发声 LED
    }
  }

  function drawRoll() {
    txt('LED 时间标 · 示例 13 音 · C3–C6', RX + RW - 6, RUL_Y + 22, 10, F_LAT, 'right', false, CLR.t2);
    var tot = state.total || 1;
    var el2 = (state.playing && ac) ? Math.max(0, ac.currentTime - state.playBase) * 1000 : -1;
    // 标尺：LED 点阵（每 250ms 一颗）+ 每秒刻度
    for (var ms = 0; ms <= tot; ms += 250) {
      var x = GX + ms / tot * GW, bar = (ms % 1000 === 0);
      var passed = (el2 >= ms);
      if (bar) {
        ln(x, RUL_Y + 12, x, RUL_Y + RUL_H - 2, CLR.teal, 1.4, 0.5);
        txt((ms / 1000).toFixed(1), x + 4, RUL_Y + 26, 10, F_MON, 'left', false, CLR.t2);
        led(x, RUL_Y + 6, 7, passed, CLR.teal);
      } else {
        ln(x, RUL_Y + 20, x, RUL_Y + RUL_H - 2, CLR.edge, 1, 0.5);
        led(x, RUL_Y + 6, 5, passed, '#3B5560');
      }
    }
    // 键盘列 + 网格
    rr(KEY_X, GY, KEY_W, GH, CLR.card, null, 0, 0);
    for (var r = 0; r < NROWS; r++) {
      var m = TOP_MIDI - r, y = GY + r * ROWH;
      var black = [1, 3, 6, 8, 10].indexOf(((m % 12) + 12) % 12) >= 0;
      var sweet = (m >= 62 && m <= 72);
      g.fillStyle = black ? CLR.bg : (sweet ? '#1B252E' : CLR.card); g.fillRect(KEY_X, y, KEY_W, ROWH);
      if (m % 12 === 0) txt('C' + (m / 12 - 1), KEY_X + KEY_W - 4, y + ROWH - 3, 9, F_MON, 'right', false, sweet ? CLR.teal : CLR.t1);
    }
    for (var r2 = 0; r2 < NROWS; r2++) {
      var m2 = TOP_MIDI - r2, y2 = GY + r2 * ROWH;
      var blk = [1, 3, 6, 8, 10].indexOf(((m2 % 12) + 12) % 12) >= 0;
      var sw = (m2 >= 62 && m2 <= 72);
      g.fillStyle = blk ? '#0E1319' : (sw ? '#141B22' : CLR.card); g.fillRect(GX, y2, GW, ROWH);
    }
    for (var ms2 = 0; ms2 <= tot; ms2 += 250) {
      var x2 = GX + ms2 / tot * GW, b2 = (ms2 % 1000 === 0);
      ln(x2, GY, x2, GY + GH, b2 ? CLR.teal : CLR.edge, b2 ? 1.4 : 1, b2 ? 0.32 : 0.45);
    }
    ln(KEY_X + KEY_W, GY, KEY_X + KEY_W, GY + GH, CLR.edge, 1.2);
    // 音符
    for (var i = 0; i < state.notes.length; i++) {
      var n = state.notes[i];
      var nx = GX + n.t / tot * GW, nw = Math.max(7, n.d / tot * GW - 2), ny = rowY(n.midi);
      var cur = (i === state.curIdx);
      if (cur) { glow(CLR.pink, 16); rr(nx - 2, ny - 2, nw + 4, ROWH - 2 + 4, CLR.pink, null, 0, 4); noGlow(); }
      rr(nx + 0.5, ny + 0.5 + 1, nw - 1, ROWH - 3, cur ? CLR.pink : '#1A2B31', cur ? CLR.pink : CLR.teal, cur ? 2 : 1.2, 3);
      if (nw > 13 && n.r) txt(n.r, nx + 4, ny + ROWH - 4, 11, F_MON, 'left', false, cur ? CLR.bg : CLR.t1);
    }
  }

  function drawPlayhead() {
    if (!ac) return;
    var el = Math.max(0, ac.currentTime - state.playBase) * 1000, tot = state.total || 1;
    if (el > tot) return;
    var px = GX + el / tot * GW;
    glow(CLR.pink, 14);
    ln(px, GY, px, GY + GH, CLR.pink, 1.8, 0.95);
    noGlow();
    glow(CLR.pink, 12); fcir(px, GY - 4, 4.5, CLR.pink, 0.95); noGlow();
  }

  function drawBottom() {
    rr(0, BOT_Y, W0, H0 - BOT_Y, CLR.card, null, 0, 0);
    ln(0, BOT_Y, W0, BOT_Y, CLR.edge, 1);
    txt('SEQUENCE', 10, BOT_Y + 26, 11, F_MON, 'left', true, CLR.teal);
    var B = [['示例', BTN.demo, false], ['清空', BTN.clear, false], [state.exporting ? '导出中…' : '导出 WAV ▼', BTN.exp, true]];
    for (var i = 0; i < B.length; i++) {
      var r = B[i][1];
      rr(r[0], r[1], r[2], r[3], CLR.card2, B[i][2] ? CLR.pink : CLR.edge, 1.2, 6);
      txt(B[i][0], r[0] + r[2] / 2, r[1] + 20, 12, F_KAN, 'center', true, B[i][2] ? CLR.pink : CLR.t1);
    }
    txt(state.status, 806, BOT_Y + 26, 11, F_LAT, 'left', false, CLR.t2);

    txt('SOUND 音色 · 四旋钮', 10, BOT_Y + 40, 11, F_LAT, 'left', true, CLR.teal);
    for (var p = 0; p < PAR.length; p++) {
      var pr = PAR[p], rc = PAR_RECT[p], v = state.params[pr.id];
      var u = (v - pr.min) / (pr.max - pr.min);
      var col = (pr.id === 'gain') ? CLR.pink : CLR.teal;
      var active = (state.drag && state.drag.kind === 'knob' && state.drag.id === pr.id);
      rr(rc[0], rc[1], rc[2], rc[3], CLR.card2, active ? col : CLR.edge, active ? 1.6 : 1.2, 8);
      knob(rc[0] + 46, rc[1] + rc[3] / 2, 31, u, col, active);
      txt(pr.name, rc[0] + 88, rc[1] + 32, 11, F_MON, 'left', true, col);
      txt(fmt(v, pr), rc[0] + 88, rc[1] + 56, 19, F_LAT, 'left', true, CLR.t1);
      txt(pr.cn, rc[0] + 88, rc[1] + 74, 10, F_KAN, 'left', false, CLR.t2);
      led(rc[0] + rc[2] - 12, rc[1] + 12, 6, active, col);
    }
    var gr = GLT_RECT;
    rr(gr[0], gr[1], gr[2], gr[3], CLR.card2, CLR.edge, 1.2, 8);
    var gon = state.params.glitchOn ? 1 : 0;
    var gact = (state.drag && state.drag.kind === 'glitch');
    if (gon) glow(CLR.pink, 10);
    rr(gr[0] + 12, gr[1] + 14, 22, 22, gon ? CLR.pink : CLR.card, gon ? CLR.pink : CLR.edge, 1.6, 6);
    noGlow();
    led(gr[0] + 23, gr[1] + 25, 8, !!gon, CLR.bg);
    txt('GLITCH', gr[0] + 44, gr[1] + 29, 11, F_MON, 'left', true, gon ? CLR.pink : CLR.t2);
    txt('毛刺量', gr[0] + gr[2] - 12, gr[1] + 29, 10, F_KAN, 'right', false, CLR.t2);
    txt(state.params.glitch.toFixed(2), gr[0] + gr[2] - 12, gr[1] + 52, 18, F_LAT, 'right', true, gon ? CLR.pink : CLR.t2);
    var gbx = gr[0] + 12, gbw = gr[2] - 24, gby = gr[1] + 62;
    rr(gbx, gby, gbw, 8, '#0E1319', null, 0, 4);
    if (gon) glow(CLR.pink, 8);
    rr(gbx, gby, Math.max(3, gbw * state.params.glitch), 8, gon ? CLR.pink : CLR.t2, null, 0, 4);
    noGlow();
    led(gbx + gbw * state.params.glitch, gby + 4, 7, gon && gact, CLR.pink);
  }
  function fmt(v, pr) { return pr.id === 'vib' ? (Math.round(v) + 'c') : (pr.id === 'gain' ? (Math.round(v) + 'dB') : Number(v).toFixed(2)); }

  // ---------------------------------------------------------------- 交互
  function pos(e) {
    var r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (W0 / r.width), y: (e.clientY - r.top) * (H0 / r.height) };
  }
  function kanaAt(p) {
    if (p.x < LX || p.x > LX + LW || p.y < KG_Y || p.y > KG_Y + KG_H) return null;
    var gd = T.grid(state.tab), cw = (LW - 8) / gd.cols, ch = KG_H / Math.max(gd.rows.length, 1);
    var c = Math.floor((p.x - LX - 4) / cw), r = Math.floor((p.y - KG_Y) / ch);
    if (r < 0 || r >= gd.rows.length || c < 0 || c >= gd.cols) return null;
    return gd.rows[r][c] || null;
  }
  function noteAt(p) {
    var tot = state.total || 1;
    for (var i = 0; i < state.notes.length; i++) {
      var n = state.notes[i], nx = GX + n.t / tot * GW, nw = Math.max(7, n.d / tot * GW - 2), ny = rowY(n.midi);
      if (p.x >= nx - 2 && p.x <= nx + nw + 2 && p.y >= ny && p.y <= ny + ROWH) return i;
    }
    return -1;
  }
  function setParam(id, v) {
    var pr = null; for (var i = 0; i < PAR.length; i++) if (PAR[i].id === id) pr = PAR[i];
    if (!pr) return;
    v = Math.min(pr.max, Math.max(pr.min, v));
    state.params[id] = v;
    if (eng) { var o = {}; o[id] = v; eng.setParams(o, 0); }
    redraw();
  }

  function onDown(e) {
    var p = pos(e); state.drag = null;
    if (inRect(p, BTN.play)) { if (state.playing) stop(); else { audio(); play(); } return; }
    if (inRect(p, BTN.stop)) { stop(); return; }
    if (inRect(p, BTN.rew)) { rewind(); return; }
    if (inRect(p, BTN.demo)) { loadDemo(); return; }
    if (inRect(p, BTN.clear)) { clearAll(); return; }
    if (inRect(p, BTN.exp)) { doExport(); return; }
    for (var i = 0; i < 4; i++) if (p.x >= LX + 8 + i * ((LW - 16) / 4) && p.x <= LX + 8 + (i + 1) * ((LW - 16) / 4) && p.y >= TAB_Y + 10 && p.y <= TAB_Y + 14 + TAB_H) {
      state.tab = i; redraw(); return;
    }
    for (var q = 0; q < PAR.length; q++) if (inRect(p, PAR_RECT[q])) {
      state.drag = { kind: 'knob', id: PAR[q].id, startY: p.y, startV: state.params[PAR[q].id] };
      redraw(); return;
    }
    if (inRect(p, GLT_RECT)) {
      if (p.y >= GLT_RECT[1] + 54) { state.drag = { kind: 'glitch', rect: GLT_RECT }; dragGlitch(p); return; }
      state.params.glitchOn = state.params.glitchOn ? 0 : 1;
      if (eng) eng.setParams({ glitchOn: state.params.glitchOn, glitch: state.params.glitch }, 0);
      redraw(); return;
    }
    var k = kanaAt(p);
    if (k) {
      if (k.c < 0) { state.status = k.k + '（长音符号，无独立发声）'; redraw(); return; }
      audition(k.c, k.v, 62, k.gl);
      state.status = '试听 ' + k.k + '（' + k.r + '）cons=' + k.c + ' vowel=' + (k.v === null ? 'n' : k.v) + (k.gl ? ' +滑音' : '');
      redraw(); return;
    }
    var ni = noteAt(p);
    if (ni >= 0) {
      var n = state.notes[ni];
      state.sel = ni;
      audition(n.cons, n.vowel, n.midi, 0);
      state.status = '试听音符 #' + ni + ' ' + (n.r || '') + ' midi=' + n.midi;
      redraw(); return;
    }
  }
  function dragGlitch(p) {
    var bx = GLT_RECT[0] + 12, bw = GLT_RECT[2] - 24;
    var u = Math.min(1, Math.max(0, (p.x - bx) / bw));
    state.params.glitch = u;
    if (eng) eng.setParams({ glitch: u, glitchOn: state.params.glitchOn });
    redraw();
  }
  function onMove(e) {
    if (!state.drag) return;
    var p = pos(e);
    if (state.drag.kind === 'knob') {
      var pr = null;
      for (var i = 0; i < PAR.length; i++) if (PAR[i].id === state.drag.id) pr = PAR[i];
      if (!pr) return;
      var range = pr.max - pr.min;
      var v = state.drag.startV + (state.drag.startY - p.y) * (range / 160);   // 上拖变大（160px = 全量程）
      if (pr.step >= 1) v = Math.round(v);
      setParam(pr.id, v);
    } else if (state.drag.kind === 'glitch') dragGlitch(p);
  }
  function onUp() { state.drag = null; }

  // ---------------------------------------------------------------- 导出
  function doExport() {
    if (!state.notes.length) { state.status = '没有音符可导出（先点「示例」）'; redraw(); return; }
    if (state.exporting) return;
    state.exporting = true; state.status = '导出中…（离线渲染 2 遍 + 收尾）'; redraw();
    renderWav(2).then(function (r) {
      state.exporting = false;
      state.status = '已导出 ' + r.name + ' · ' + r.stats.seconds.toFixed(2) + ' s · RMS ' + r.stats.rms.toFixed(4) + ' · peak ' + r.stats.peak.toFixed(4);
      state.lastStats = r.stats;
      download(r.blob, r.name);
      redraw();
    }).catch(function (err) {
      state.exporting = false; state.status = '导出失败：' + err; redraw();
    });
  }
  function renderWav(loops) {
    var p = normalizeParams(state.params);
    return window.DivaEngine.render({
      notes: state.notes, params: p, loops: loops, leadMs: 150, tailMs: 800, sampleRate: 44100
    }).then(function (r) {
      var blob = W.encodeWav(r.buffer);
      var st = W.rmsPeak(r.buffer);
      var d = new Date(), z = function (x) { return (x < 10 ? '0' : '') + x; };
      var name = 'DIVA01_web_' + d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + '_' + z(d.getHours()) + z(d.getMinutes()) + z(d.getSeconds()) + '.wav';
      return { blob: blob, name: name, stats: st, buffer: r.buffer, loops: r.loops, duration: r.duration };
    });
  }
  function normalizeParams(s) {
    return {
      breath: s.breath, bright: s.bright, vib: s.vib, gain: s.gain,
      puff: s.puff, glitch: s.glitch, glitchOn: s.glitchOn
    };
  }
  function download(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 4000);
  }

  // ---------------------------------------------------------------- 主循环
  function loop() {
    if (state.playing || state.dirty) { draw(); state.dirty = false; }
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------- 启动
  function boot() {
    cv = document.getElementById('panel');
    DPR = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W0 * DPR; cv.height = H0 * DPR;
    g = cv.getContext('2d');
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    loadDemo();
    state.dirty = true; loop();

    // 对外句柄（自测/联调用）
    window.__diva = window.__diva || {};
    window.__diva.state = state;
    window.__diva.renderWav = renderWav;
    window.__diva.loadDemo = loadDemo;
    window.__diva.play = play;
    window.__diva.audition = audition;
    window.__diva.version = 'web-v1';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
