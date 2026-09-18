/* wav.js — AudioBuffer -> 44.1k / 16-bit PCM WAV (Blob) ，零依赖 */
(function (root) {
  'use strict';
  function encodeWav(buffer) {
    var nCh = buffer.numberOfChannels, sr = buffer.sampleRate, n = buffer.length;
    var bytes = 44 + n * nCh * 2;
    var ab = new ArrayBuffer(bytes), v = new DataView(ab);
    function s(off, str) { for (var i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i)); }
    s(0, 'RIFF'); v.setUint32(4, bytes - 8, true); s(8, 'WAVE');
    s(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nCh, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * nCh * 2, true); v.setUint16(32, nCh * 2, true); v.setUint16(34, 16, true);
    s(36, 'data'); v.setUint32(40, n * nCh * 2, true);
    var chans = [], i, c, o = 44;
    for (c = 0; c < nCh; c++) chans.push(buffer.getChannelData(c));
    for (i = 0; i < n; i++) {
      for (c = 0; c < nCh; c++) {
        var x = chans[c][i];
        x = x < -1 ? -1 : (x > 1 ? 1 : x);
        v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7FFF, true); o += 2;
      }
    }
    return new Blob([ab], { type: 'audio/wav' });
  }
  function rmsPeak(buffer) {
    var n = buffer.length, nCh = buffer.numberOfChannels, sum = 0, peak = 0;
    var d = buffer.getChannelData(0);
    for (var i = 0; i < n; i++) { var x = d[i]; sum += x * x; if (Math.abs(x) > peak) peak = Math.abs(x); }
    return { rms: Math.sqrt(sum / n), peak: peak, n: n, sr: buffer.sampleRate, channels: nCh, seconds: n / buffer.sampleRate };
  }
  root.DIVA_WAV = { encodeWav: encodeWav, rmsPeak: rmsPeak };
})(typeof window !== 'undefined' ? window : globalThis);
