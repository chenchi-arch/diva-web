/* ============================================================================
 * tables.js — 数据表（单一数据源，移植自 stepA/roll.js + build_diva02.js）
 *   五十音全表（清音/浊音/半浊音/拗音）、罗马音解析、示例序列
 *   元音编号：a=0 i=1 u=2 e=3 o=4 ；辅音编号同引擎 CMAP/CTAB
 * ========================================================================== */
(function (root) {
  'use strict';

  var CMAP = { k: 1, t: 2, p: 3, s: 4, sh: 5, h: 6, f: 7, m: 8, n: 9, r: 11, y: 12, w: 13, g: 14, z: 15, d: 16, b: 17, ch: 2, ts: 2, j: 15 };
  var VMAP = { a: 0, i: 1, u: 2, e: 3, o: 4 };

  function mk(k, r, c, v, gl) { return { k: k, r: r, c: c, v: (v === undefined ? null : v), gl: gl ? 1 : 0 }; }

  var SEION = [
    [mk('あ', 'a', 0, 0), mk('い', 'i', 0, 1), mk('う', 'u', 0, 2), mk('え', 'e', 0, 3), mk('お', 'o', 0, 4)],
    [mk('か', 'ka', 1, 0), mk('き', 'ki', 1, 1), mk('く', 'ku', 1, 2), mk('け', 'ke', 1, 3), mk('こ', 'ko', 1, 4)],
    [mk('さ', 'sa', 4, 0), mk('し', 'shi', 5, 1), mk('す', 'su', 4, 2), mk('せ', 'se', 4, 3), mk('そ', 'so', 4, 4)],
    [mk('た', 'ta', 2, 0), mk('ち', 'chi', 2, 1), mk('つ', 'tsu', 2, 2), mk('て', 'te', 2, 3), mk('と', 'to', 2, 4)],
    [mk('な', 'na', 9, 0), mk('に', 'ni', 9, 1), mk('ぬ', 'nu', 9, 2), mk('ね', 'ne', 9, 3), mk('の', 'no', 9, 4)],
    [mk('は', 'ha', 6, 0), mk('ひ', 'hi', 6, 1), mk('ふ', 'fu', 7, 2), mk('へ', 'he', 6, 3), mk('ほ', 'ho', 6, 4)],
    [mk('ま', 'ma', 8, 0), mk('み', 'mi', 8, 1), mk('む', 'mu', 8, 2), mk('め', 'me', 8, 3), mk('も', 'mo', 8, 4)],
    [mk('や', 'ya', 12, 0), null, mk('ゆ', 'yu', 12, 2), null, mk('よ', 'yo', 12, 4)],
    [mk('ら', 'ra', 11, 0), mk('り', 'ri', 11, 1), mk('る', 'ru', 11, 2), mk('れ', 're', 11, 3), mk('ろ', 'ro', 11, 4)],
    [mk('わ', 'wa', 13, 0), null, null, null, mk('を', 'wo', 13, 4)],
    [mk('ん', 'n', 10, null), mk('っ', 'xtsu', 18, null), mk('ー', 'long', -1, null), null, null]
  ];
  var DAKU = [
    [mk('が', 'ga', 14, 0), mk('ぎ', 'gi', 14, 1), mk('ぐ', 'gu', 14, 2), mk('げ', 'ge', 14, 3), mk('ご', 'go', 14, 4)],
    [mk('ざ', 'za', 15, 0), mk('じ', 'ji', 15, 1), mk('ず', 'zu', 15, 2), mk('ぜ', 'ze', 15, 3), mk('ぞ', 'zo', 15, 4)],
    [mk('だ', 'da', 16, 0), mk('ぢ', 'ji', 16, 1), mk('づ', 'zu', 16, 2), mk('で', 'de', 16, 3), mk('ど', 'do', 16, 4)],
    [mk('ば', 'ba', 17, 0), mk('び', 'bi', 17, 1), mk('ぶ', 'bu', 17, 2), mk('べ', 'be', 17, 3), mk('ぼ', 'bo', 17, 4)]
  ];
  var HANDAKU = [
    [mk('ぱ', 'pa', 3, 0), mk('ぴ', 'pi', 3, 1), mk('ぷ', 'pu', 3, 2), mk('ぺ', 'pe', 3, 3), mk('ぽ', 'po', 3, 4)]
  ];
  var YOON_BASE = [
    [mk('き', 'ki', 1, 1), ['きゃ', 'kya', 0], ['きゅ', 'kyu', 2], ['きょ', 'kyo', 4]],
    [mk('ぎ', 'gi', 14, 1), ['ぎゃ', 'gya', 0], ['ぎゅ', 'gyu', 2], ['ぎょ', 'gyo', 4]],
    [mk('し', 'shi', 5, 1), ['しゃ', 'sha', 0], ['しゅ', 'shu', 2], ['しょ', 'sho', 4]],
    [mk('じ', 'ji', 15, 1), ['じゃ', 'ja', 0], ['じゅ', 'ju', 2], ['じょ', 'jo', 4]],
    [mk('ち', 'chi', 2, 1), ['ちゃ', 'cha', 0], ['ちゅ', 'chu', 2], ['ちょ', 'cho', 4]],
    [mk('に', 'ni', 9, 1), ['にゃ', 'nya', 0], ['にゅ', 'nyu', 2], ['にょ', 'nyo', 4]],
    [mk('ひ', 'hi', 6, 1), ['ひゃ', 'hya', 0], ['ひゅ', 'hyu', 2], ['ひょ', 'hyo', 4]],
    [mk('び', 'bi', 17, 1), ['びゃ', 'bya', 0], ['びゅ', 'byu', 2], ['びょ', 'byo', 4]],
    [mk('ぴ', 'pi', 3, 1), ['ぴゃ', 'pya', 0], ['ぴゅ', 'pyu', 2], ['ぴょ', 'pyo', 4]],
    [mk('み', 'mi', 8, 1), ['みゃ', 'mya', 0], ['みゅ', 'myu', 2], ['みょ', 'myo', 4]],
    [mk('り', 'ri', 11, 1), ['りゃ', 'rya', 0], ['りゅ', 'ryu', 2], ['りょ', 'ryo', 4]]
  ];
  function yoonRow(i) {
    var b = YOON_BASE[i];
    return [mk(b[1][0], b[1][1], b[0].c, b[1][2], 1), mk(b[2][0], b[2][1], b[0].c, b[2][2], 1), mk(b[3][0], b[3][1], b[0].c, b[3][2], 1)];
  }
  function grid(tab) {
    if (tab === 0) return { rows: SEION, cols: 5 };
    if (tab === 1) return { rows: DAKU, cols: 5 };
    if (tab === 2) return { rows: HANDAKU, cols: 5 };
    var r = []; for (var i = 0; i < YOON_BASE.length; i++) r.push(yoonRow(i));
    return { rows: r, cols: 3 };
  }

  // ---- 罗马音解析（与引擎 v8 parseRomaji 同一套规则） ----
  function parseRomaji(str) {
    var words = String(str).toLowerCase().replace(/[^a-z ]/g, ' ').split(' ');
    var out = [];
    for (var w = 0; w < words.length; w++) {
      var s = words[w], i = 0;
      while (i < s.length) {
        var two = s.substr(i, 2), ch = s[i], nx = s[i + 1];
        if (CMAP[two] !== undefined && VMAP[s[i + 2]] !== undefined) { out.push({ c: CMAP[two], v: VMAP[s[i + 2]] }); i += 3; continue; }
        if (VMAP[ch] !== undefined) { var lv = false; if (s[i + 1] === ch) lv = true; else if (ch === 'o' && s[i + 1] === 'u') lv = true; out.push({ c: 0, v: VMAP[ch], long: lv }); i += lv ? 2 : 1; continue; }
        if (ch === 'n' && (i + 1 >= s.length || VMAP[s[i + 1]] === undefined)) { out.push({ c: 10, v: null }); i += 1; continue; }
        if (nx === ch && ch !== 'n') { out.push({ c: 18, v: null }); i += 1; continue; }
        if (CMAP[ch] !== undefined && VMAP[nx] !== undefined) {
          var isLong = false, n2 = s[i + 2];
          if (n2 === nx) isLong = true; else if (nx === 'o' && n2 === 'u') isLong = true;
          out.push({ c: CMAP[ch], v: VMAP[nx], long: isLong }); i += isLong ? 3 : 2; continue;
        }
        if (CMAP[ch] !== undefined) { out.push({ c: CMAP[ch], v: 0 }); i += 2; continue; }
        i += 1;
      }
    }
    return out;
  }

  // ---- 示例序列：世界で一番お姫様（13 音 / 6386ms，引擎 DEMO_SEQ 原文） ----
  var DEMO_SEQ = '6386 120:519:65:4:3:se 649:770:72:1:0:ka 1419:235:72:0:1:i 2055:748:63:16:3:de 2814:500:65:0:1:i 3344:204:67:2:1:chi 3558:337:68:17:0:ba 3953:93:67:10:n:n 4094:276:65:0:4:o 4380:572:63:6:1:hi 5088:229:72:8:3:me 5774:339:63:4:0:sa:260 6162:224:65:8:0:ma:220';
  function parseSeq(str) {
    var a = String(str).split(/\s+/), total = Number(a[0]) || 0, out = [];
    for (var j = 1; j < a.length; j++) {
      var p = a[j].split(':');
      if (p.length < 5) continue;
      out.push({
        t: Number(p[0]), d: Number(p[1]), midi: Number(p[2]), cons: Number(p[3]),
        vowel: (p[4] === 'n' || p[4] === 'N') ? null : Number(p[4]),
        r: (p.length > 5 ? p[5] : ''),
        glide: (p.length > 6 ? Number(p[6]) || 0 : 0)
      });
    }
    return { total: total, notes: out };
  }

  root.DIVA_TABLES = Object.assign(root.DIVA_TABLES || {}, {
    CMAP: CMAP, VMAP: VMAP, SEION: SEION, DAKU: DAKU, HANDAKU: HANDAKU,
    grid: grid, parseRomaji: parseRomaji, DEMO_SEQ: DEMO_SEQ, parseSeq: parseSeq,
    VOWEL_NAMES: ['a', 'i', 'u', 'e', 'o']
  });
})(typeof window !== 'undefined' ? window : globalThis);
