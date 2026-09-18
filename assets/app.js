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
    curIdx: -1, litKana: null, sel: -1, status: '就绪 · 点空白=加音符 · 选中后拖音头/音尾圆点=滑音 · 拖右缘=长度 · 点五十音格=填词',
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
    state.notes = p.notes; state.total = p.total; state.curIdx = -1; state.sel = -1;
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
            glideMs: (n.glide > 0 && prev) ? n.glide : 0, prevMidi: prev ? prev.midi : null, gateMs: n.d,
            curve: n.curve || null
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

  // ---------------- D-1 音高曲线：几何 / 命中 / 插值 ----------------
  function cvAtS(curve, u) {                     // 分段 smoothstep（与引擎同一条曲线）
    if (!curve || curve.length < 2) return 0;
    if (u <= curve[0].u) return curve[0].semi;
    for (var i = 1; i < curve.length; i++) {
      if (u <= curve[i].u) {
        var a = curve[i - 1], b = curve[i];
        var tt = (u - a.u) / Math.max(1e-6, b.u - a.u);
        var sm = tt * tt * (3 - 2 * tt);
        return a.semi + (b.semi - a.semi) * sm;
      }
    }
    return curve[curve.length - 1].semi;
  }
  function noteGeo(i) {
    var n = state.notes[i], tot = state.total || 1;
    var nx = GX + n.t / tot * GW, nw = Math.max(7, n.d / tot * GW - 2);
    return { n: n, x: nx, w: nw, yc: rowY(n.midi) + ROWH / 2 - 1, y: rowY(n.midi) };
  }
  function curveHandlePos(i) {
    var g = noteGeo(i);
    if (!g.n.curve || g.n.curve.length < 2) return null;
    var semi = cvAtS(g.n.curve, 0.5);
    return { x: g.x + g.w * 0.5, y: rowY(g.n.midi + semi) + ROWH / 2 - 1, semi: semi, i: i };
  }
  function glideHandlePos(i) {
    var g = noteGeo(i);
    if (!(g.n.glide > 0) || i <= 0) return null;
    var p = noteGeo(i - 1), tot = state.total || 1, gp = g.n.glide / tot * GW;
    return { x: g.x - gp / 2, y: (p.yc + g.yc) / 2, ms: g.n.glide, i: i, gp: gp };
  }
  function handleAt(p) {
    // 选中音符的音头/音尾/中段圆点（可拖滑音）——放在 noteAt 之前，圆点抬升/压低后仍可抓
    var ks = state.sel;
    if (ks >= 0 && state.notes[ks]) {
      var gn = state.notes[ks];
      var gs = noteGeo(ks);
      var pss = (gn.curve && gn.curve.length >= 2) ? gn.curve : [{ u: 0, semi: 0 }, { u: 1, semi: 0 }];
      for (var di = 0; di < pss.length; di++) {
        var dx2 = gs.x + gs.w * pss[di].u, dy2 = rowY(gn.midi + pss[di].semi) + ROWH / 2 - 1;
        if (Math.abs(p.x - dx2) <= 11 && Math.abs(p.y - dy2) <= 11) return { kind: 'dot', i: ks, idx: di, pos: { x: dx2, y: dy2, semi: pss[di].semi } };
      }
    }
    for (var j = 0; j < state.notes.length; j++) {
      var gh = glideHandlePos(j);
      if (gh && Math.abs(p.x - gh.x) <= 13 && Math.abs(p.y - gh.y) <= 13) return { kind: 'glide', i: j, pos: gh };
    }
    return null;
  }

  function drawNotes() {
    var tot = state.total || 1;
    // —— 第一遍：辅音底衬 + 音符块 + 标签 ——
    for (var i = 0; i < state.notes.length; i++) {
      var geo = noteGeo(i), n = geo.n, cur = (i === state.curIdx), seln = (i === state.sel);
      var cms = (T.CTAB && T.CTAB[n.cons]) ? T.CTAB[n.cons][2] : 0;
      if (cms > 0) {                                   // 辅音段底衬（半透明）
        var cw = Math.min(geo.w + 2, cms / tot * GW);
        g.fillStyle = 'rgba(242,169,218,0.13)';
        g.fillRect(geo.x, geo.y, cw, ROWH - 3);
        ln(geo.x + cw, geo.y, geo.x + cw, geo.y + ROWH - 3, CLR.pink, 1, 0.35);
      }
      if (cur) { glow(CLR.pink, 16); rr(geo.x - 2, geo.y - 2, geo.w + 4, ROWH - 2 + 4, CLR.pink, null, 0, 4); noGlow(); }
      else if (seln) { glow(CLR.teal, 12); rr(geo.x - 2, geo.y - 2, geo.w + 4, ROWH - 2 + 4, CLR.teal, null, 0, 4); noGlow(); }
      rr(geo.x + 0.5, geo.y + 0.5 + 1, geo.w - 1, ROWH - 3, cur ? CLR.pink : (seln ? '#1E3A40' : '#1A2B31'), cur ? CLR.pink : CLR.teal, cur ? 2 : (seln ? 2.2 : 1.2), 3);
      if (geo.w > 13 && n.r) txt(n.r, geo.x + 4, geo.y + ROWH - 4, 11, F_MON, 'left', false, cur ? CLR.bg : CLR.t1);
      if (geo.w > 22) ln(geo.x + geo.w - 3.5, geo.y + 4, geo.x + geo.w - 3.5, geo.y + ROWH - 7, cur ? CLR.bg : CLR.teal, 1.5, 0.32);   // 右缘=拉伸提示
    }
    // —— 第二遍：接缝滑音 / 音高线 / 弯音曲线 + 控制点（置顶，永不被音符块挡住） ——
    for (var j = 0; j < state.notes.length; j++) {
      var geo2 = noteGeo(j), n2 = geo2.n, cur2 = (j === state.curIdx), sel2 = (j === state.sel);
      var gh = glideHandlePos(j);                      // 接缝滑音 S 段
      if (gh) {
        var pv = noteGeo(j - 1);
        g.beginPath();
        for (var s = 0; s <= 12; s++) {
          var u = s / 12, sm = u * u * (3 - 2 * u);
          var xx = (pv.x + pv.w) + (geo2.x - (pv.x + pv.w)) * u;
          var yy = pv.yc + (geo2.yc - pv.yc) * sm;
          if (s === 0) g.moveTo(xx, yy); else g.lineTo(xx, yy);
        }
        g.strokeStyle = rgba(CLR.pink, 0.95); g.lineWidth = 1.8; g.stroke();
        rr(gh.x - 4, gh.y - 4, 8, 8, CLR.pink, [0, 0, 0, 1], 1, 2);
        if (n2.glide >= 20) txt(n2.glide + 'ms', gh.x + 7, gh.y - 5, 10, F_MON, 'left', true, CLR.pink);
      }
      if (n2.curve && n2.curve.length > 1) {           // 音符内弯音曲线（置顶）
        g.beginPath();
        for (var q = 0; q <= 24; q++) {
          var uq = q / 24, yq = rowY(n2.midi + cvAtS(n2.curve, uq)) + ROWH / 2 - 1;
          var xq = geo2.x + geo2.w * uq;
          if (q === 0) g.moveTo(xq, yq); else g.lineTo(xq, yq);
        }
        g.strokeStyle = rgba(CLR.pink, 0.95); g.lineWidth = 1.7; g.stroke();
      } else {                                         // 普通：直线音高线（画在音符块上方）
        ln(geo2.x, geo2.yc, geo2.x + geo2.w, geo2.yc, cur2 ? CLR.pink : CLR.teal, 1.3, cur2 ? 1 : 0.55);
      }
      if (sel2) {                                      // 选中：音头/音尾圆点（拽它画滑音）
        var pss = (n2.curve && n2.curve.length >= 2) ? n2.curve : [{ u: 0, semi: 0 }, { u: 1, semi: 0 }];
        for (var di = 0; di < pss.length; di++) {
          var ddx = geo2.x + geo2.w * pss[di].u, ddy = rowY(n2.midi + pss[di].semi) + ROWH / 2 - 1;
          glow(CLR.pink, 7);
          fcir(ddx, ddy, 5, CLR.pink, 0.95);
          noGlow();
          fcir(ddx, ddy, 2, CLR.bg, 1);
          if (Math.abs(pss[di].semi) >= 0.25) txt((pss[di].semi >= 0 ? '+' : '') + pss[di].semi.toFixed(2), ddx + (pss[di].u > 0.5 ? -48 : 9), ddy - 6, 10, F_MON, 'left', true, CLR.pink);
        }
      }
    }
  }

  function drawRoll() {
    txt('点空白=加音符 · 拖音符=移动 · 选中后：拖圆点=滑音 / 右缘=长度 / 五十音格=填词 · C3–C6', RX + RW - 6, RUL_Y + 22, 10, F_LAT, 'right', false, CLR.t2);
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
    // 音符 + 音高线/滑音/弯音/辅音底衬（D-1）
    drawNotes();
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
  function inRoll(p) { return p.x >= GX && p.x <= GX + GW && p.y >= GY && p.y <= GY + GH; }
  var SNAP_MS = 125;                                                 // 新增音符吸附网格（标尺 LED 250ms 的半格）
  function snapT(t) { return Math.max(0, Math.round(t / SNAP_MS) * SNAP_MS); }
  function occupied(midi, t) {
    for (var i = 0; i < state.notes.length; i++) {
      var n = state.notes[i];
      if (n.midi !== midi) continue;
      if (Math.abs(n.t - t) < SNAP_MS) return true;
      if (t >= n.t && t < n.t + n.d) return true;
    }
    return false;
  }
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
    for (var i = 0; i < 4; i++) if (p.x >= LX + 8 + i * ((LW - 16) / 4) && p.x <= LX + 8 + (i + 1) * ((LW - 16) / 4) && p.y >= TAB_Y && p.y <= TAB_Y + TAB_H) {
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
      var selN = (state.sel >= 0) ? state.notes[state.sel] : null;
      if (selN) {                                       // 已选中音符：点格子 = 给它填词（并试听）
        selN.cons = k.c; selN.vowel = k.v;
        selN.r = k.r || selN.r;
        if (k.gl) selN.glide = Math.max(selN.glide || 0, 260);
        audition(k.c, k.v, selN.midi, 0);
        state.status = '音符 #' + state.sel + ' 发音 → ' + k.k + '（' + k.r + '）· 继续点格子可换 · Esc 取消选择';
      } else {                                          // 未选中：试听
        audition(k.c, k.v, 62, k.gl);
        state.status = '试听 ' + k.k + '（' + k.r + '）cons=' + k.c + ' vowel=' + (k.v === null ? 'n' : k.v) + (k.gl ? ' +滑音' : '');
      }
      redraw(); return;
    }
    // 手柄：选中音符的圆点（音头/音尾/中段 = 拖滑音；双击 = 清除）/ 接缝滑音手柄
    var h = inRoll(p) ? handleAt(p) : null;
    if (h) {
      var hN = state.notes[h.i];
      var nowT = now();
      if ((h.kind === 'dot' || h.kind === 'curve') && hN && state.lastClick && nowT - state.lastClick.t < 380 &&
          Math.abs(p.x - state.lastClick.x) < 10 && Math.abs(p.y - state.lastClick.y) < 10) {
        hN.curve = null;
        state.status = '已清除音符 #' + h.i + ' 的滑音曲线';
        state.lastClick = null; redraw(); return;
      }
      state.lastClick = { t: nowT, x: p.x, y: p.y };
      if (h.kind === 'dot') {
        var hLen = (hN && hN.curve && hN.curve.length >= 2) ? hN.curve.length : 2;
        state.sel = h.i;
        state.drag = { kind: 'endzone', i: h.i, note: hN, idx: h.idx, axis: null, startX: p.x, startY: p.y, startSemi: h.pos.semi || 0, startT: hN.t, startMidi: hN.midi, startD: hN.d, moved: false };
        state.status = '音符 #' + h.i + ' ' + (h.idx === 0 ? '音头' : (h.idx >= hLen - 1 ? '音尾' : '中段')) + '圆点：上下拖=滑音（双击=清除）';
        redraw(); return;
      }
      state.drag = { kind: h.kind, i: h.i, startY: p.y, startX: p.x, startSemi: h.pos.semi || 0, startMs: h.pos.ms || 0, moved: false };
      redraw(); return;
    }
    var ni = noteAt(p);
    if (ni >= 0) {
      var n = state.notes[ni];
      var gN = noteGeo(ni);
      var wasSel = (state.sel === ni);
      var eIdx = -1, eSemi = 0;
      if (wasSel) {                                    // 已选中的音符：先找 音头/中段/音尾 圆点
        var pss0 = (n.curve && n.curve.length >= 2) ? n.curve : [{ u: 0, semi: 0 }, { u: 1, semi: 0 }];
        for (var ei = 0; ei < pss0.length; ei++) {
          var ex = gN.x + gN.w * pss0[ei].u, ey = rowY(n.midi + pss0[ei].semi) + ROWH / 2 - 1;
          if (Math.abs(p.x - ex) <= 11 && Math.abs(p.y - ey) <= 11) { eIdx = ei; eSemi = pss0[ei].semi; break; }
        }
      }
      state.sel = ni;
      if (eIdx >= 0) {                                 // 圆点：双击=清除；上下拖=滑音量；音尾横拖=长度/音头横拖=移动
        var nT0 = now();
        if (state.lastClick && nT0 - state.lastClick.t < 380 &&
            Math.abs(p.x - state.lastClick.x) < 10 && Math.abs(p.y - state.lastClick.y) < 10) {
          n.curve = null;
          state.status = '已清除音符 #' + ni + ' 的滑音曲线';
          state.lastClick = null; redraw(); return;
        }
        state.lastClick = { t: nT0, x: p.x, y: p.y };
        state.drag = { kind: 'endzone', i: ni, note: n, idx: eIdx, axis: null, startX: p.x, startY: p.y, startSemi: eSemi, startT: n.t, startMidi: n.midi, startD: n.d, moved: false };
        state.status = '音符 #' + ni + ' ' + (eIdx === 0 ? '音头' : (eIdx >= pss0.length - 1 ? '音尾' : '中段')) + '圆点：上下拖=滑音（双击=清除）';
        redraw(); return;
      }
      state.drag = { kind: (p.x > gN.x + gN.w - 12) ? 'resize' : 'move', i: ni, note: n, startX: p.x, startY: p.y, startT: n.t, startMidi: n.midi, startD: n.d, moved: false };
      state.status = '音符 #' + ni + ' ' + (n.r || '') + ' · 拖动=移位/音高 · 选中后拖圆点=滑音 · 右缘=长度';
      redraw(); return;
    }
    // 卷帘空白处：新建音符（按住左右拖动调长度）
    if (inRoll(p)) {
      if (!state.total || state.total <= 0) state.total = 8000;      // 空画布：给一条默认 8 s 时间轴
      var totN = state.total;
      var nt = Math.max(0, Math.min(totN - 100, snapT((p.x - GX) / GW * totN)));
      var nm = Math.max(48, Math.min(84, TOP_MIDI - Math.floor((p.y - GY) / ROWH)));
      if (occupied(nm, nt)) { state.status = '该位置已有同音高音符（点它可试听）'; redraw(); return; }
      var nn = { t: nt, d: 500, midi: nm, cons: 0, vowel: 0, r: 'a', glide: 0, curve: null };
      state.notes.push(nn);
      state.notes.sort(function (a, b) { return a.t - b.t; });
      state.sel = state.notes.indexOf(nn);
      state.drag = { kind: 'newnote', note: nn, startX: p.x, moved: false };
      state.status = '已添加音符 · midi ' + nm + ' · ' + (nt / 1000).toFixed(2) + 's（按住拖可调长度）';
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
    else if (state.drag.kind === 'curve') {
      var nq = state.notes[state.drag.i];
      if (!nq) return;
      if (Math.abs(p.y - state.drag.startY) + Math.abs(p.x - state.drag.startX) > 4) state.drag.moved = true;
      if (!state.drag.moved) return;                                          // 没拖动 = 留给“试听”回退
      var semi = state.drag.startSemi + (state.drag.startY - p.y) / ROWH;     // 1 行 = 1 半音
      semi = Math.max(-12, Math.min(12, Math.round(semi * 4) / 4));          // 0.25 半音步进
      nq.curve = [{ u: 0, semi: 0 }, { u: 0.5, semi: semi }, { u: 1, semi: 0 }];
      var cms = (T.CTAB && T.CTAB[nq.cons]) ? T.CTAB[nq.cons][2] : 0;
      state.status = '音符 #' + state.drag.i + ' 弯音 ' + (semi >= 0 ? '+' : '') + semi.toFixed(2) + ' 半音 → 峰值落在 ' +
        Math.round(nq.d / 2) + 'ms' + (cms > 0 && nq.d / 2 < cms ? '（⚠ 仍在辅音段内，滑音请拉长到 > ' + cms + 'ms）' : '');
      redraw();
    } else if (state.drag.kind === 'glide') {
      var ng = state.notes[state.drag.i];
      if (!ng) return;
      if (Math.abs(p.x - state.drag.startX) + Math.abs(p.y - state.drag.startY) > 4) state.drag.moved = true;
      if (!state.drag.moved) return;
      var tot = state.total || 1;
      var ms = state.drag.startMs - (p.x - state.drag.startX) / GW * tot;   // 手柄越往左=滑音越长（与画布几何一致）
      ms = Math.max(0, Math.min(600, Math.round(ms / 10) * 10));              // 10ms 步进，0–600ms
      ng.glide = ms;
      state.status = '音符 #' + state.drag.i + ' 接缝滑音 ' + ms + 'ms' + (ms === 0 ? '（关闭）' : '');
      redraw();
    } else if (state.drag.kind === 'newnote') {
      var nn2 = state.drag.note;
      if (!nn2) return;
      if (Math.abs(p.x - state.drag.startX) > 4) state.drag.moved = true;
      if (!state.drag.moved) return;
      var tot2 = state.total || 1;
      var endT = snapT((p.x - GX) / GW * tot2);
      nn2.d = Math.max(100, Math.min(tot2 - nn2.t, endT - nn2.t));
      state.status = '音符长度 ' + Math.round(nn2.d) + ' ms（松手完成）';
      redraw();
    } else if (state.drag.kind === 'move' || state.drag.kind === 'resize') {
      var nd = state.notes[state.drag.i];
      if (!nd) return;
      if (Math.abs(p.x - state.drag.startX) > 4 || Math.abs(p.y - state.drag.startY) > 4) state.drag.moved = true;
      if (!state.drag.moved) return;
      var totM = state.total || 1;
      if (state.drag.kind === 'move') {
        var nt2 = snapT(state.drag.startT + (p.x - state.drag.startX) / GW * totM);
        nd.t = Math.max(0, Math.min(totM - nd.d, nt2));
        nd.midi = Math.max(48, Math.min(84, state.drag.startMidi - Math.round((p.y - state.drag.startY) / ROWH)));
        state.status = '移动音符 #' + state.drag.i + ' → midi ' + nd.midi + ' · ' + (nd.t / 1000).toFixed(2) + 's';
      } else {
        nd.d = Math.max(100, Math.min(totM - nd.t, snapT(state.drag.startD + (p.x - state.drag.startX) / GW * totM)));
        state.status = '长度 ' + Math.round(nd.d) + ' ms（松手完成）';
      }
      redraw();
    } else if (state.drag.kind === 'endzone') {
      var ne = state.notes[state.drag.i];
      if (!ne) return;
      if (Math.abs(p.x - state.drag.startX) > 4 || Math.abs(p.y - state.drag.startY) > 4) state.drag.moved = true;
      if (!state.drag.moved) return;
      if (!state.drag.axis) {
        var adx = Math.abs(p.x - state.drag.startX), ady = Math.abs(p.y - state.drag.startY);
        state.drag.axis = (ady >= adx) ? 'pitch' : (state.drag.idx === 0 ? 'move' : 'resize');
      }
      var totE = state.total || 1;
      if (state.drag.axis === 'pitch') {
        var se = state.drag.startSemi + (state.drag.startY - p.y) / ROWH;
        se = Math.max(-12, Math.min(12, Math.round(se * 4) / 4));
        if (!ne.curve || ne.curve.length < 2) ne.curve = [{ u: 0, semi: 0 }, { u: 1, semi: 0 }];
        ne.curve[Math.min(state.drag.idx, ne.curve.length - 1)].semi = se;
        var lblE = state.drag.idx === 0 ? '音头' : (state.drag.idx >= ne.curve.length - 1 ? '音尾' : '中段');
        state.status = '音符 #' + state.drag.i + ' ' + lblE + '滑音 ' + (se >= 0 ? '+' : '') + se.toFixed(2) + ' 半音';
      } else if (state.drag.axis === 'resize') {
        ne.d = Math.max(100, Math.min(totE - ne.t, snapT(state.drag.startD + (p.x - state.drag.startX) / GW * totE)));
        state.status = '长度 ' + Math.round(ne.d) + ' ms（松手完成）';
      } else {
        var ntE = snapT(state.drag.startT + (p.x - state.drag.startX) / GW * totE);
        ne.t = Math.max(0, Math.min(totE - ne.d, ntE));
        ne.midi = Math.max(48, Math.min(84, state.drag.startMidi - Math.round((p.y - state.drag.startY) / ROWH)));
        state.status = '移动音符 #' + state.drag.i + ' → midi ' + ne.midi + ' · ' + (ne.t / 1000).toFixed(2) + 's';
      }
      redraw();
    }
  }
  function onUp() {
    var d = state.drag;
    state.drag = null;
    if (!d) return;
    // 控制点/滑音区域“只点不拖” → 回退为试听该音符
    if ((d.kind === 'curve' || d.kind === 'glide' || d.kind === 'endzone') && !d.moved) {
      var n = state.notes[d.i];
      if (n) {
        state.sel = d.i;
        audition(n.cons, n.vowel, n.midi, 0);
        state.status = '试听音符 #' + d.i + ' ' + (n.r || '') + ' · midi=' + n.midi +
          '（拖音头/音尾圆点=滑音 · 双击圆点=清除 · 拖右缘=长度）';
        redraw();
      }
    }
    // 音符“只点不拖” → 试听；拖动完成 → 落位排序
    if (d.kind === 'move' || d.kind === 'resize' || d.kind === 'endzone') {
      var n1 = state.notes[d.i];
      if (!n1) return;
      if (!d.moved) {
        state.sel = d.i;
        audition(n1.cons, n1.vowel, n1.midi, 0);
        state.status = '试听音符 #' + d.i + ' ' + (n1.r || '') + ' · midi=' + n1.midi + '（拖动=移位/音高 · 选中后拖圆点=滑音）';
        redraw();
      } else if (d.kind !== 'endzone' || d.axis === 'move' || d.axis === 'resize') {
        state.notes.sort(function (a, b) { return a.t - b.t; });
        state.sel = d.note ? state.notes.indexOf(d.note) : -1;
        redraw();
      }
    }
  }

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
    window.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { state.sel = -1; state.status = '已取消选择'; redraw(); }
    });
    loadDemo();
    state.dirty = true; loop();

    // 对外句柄（自测/联调用）
    window.__diva = window.__diva || {};
    window.__diva.state = state;
    window.__diva.renderWav = renderWav;
    window.__diva.loadDemo = loadDemo;
    window.__diva.play = play;
    window.__diva.audition = audition;
    window.__diva.version = 'web-v1.3';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
