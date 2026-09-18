# DIVA-01 Web

虚拟歌姬 **DIVA-01** 的网页版（v1：**能弹 / 能听 / 能导出**）。纯前端、零依赖、单个 `index.html`。

- 引擎：Web Audio 手写复刻 Max 版 `diva-02.maxpat` 的音频核心（声源 → 元音门 → 5 元音×4 共振峰 → ADSR → 复古毛刺 → 音量/削波）
- 面板：Canvas 2D 自绘，1280×800，配色/几何与 Max 版一致（底 `#0A0E13` / 卡 `#121820` / 青 `#39C5BB` / 粉 `#F2A9DA`）
- 交互：▶ 播放示例序列（世界で一番お姫様 · 13 音 / 6386ms）；点五十音格试听音节；点卷帘音符试听；拖动音色四参
- 导出：`OfflineAudioContext` 渲染 2 遍 + 收尾 → 44.1kHz / 16bit WAV 下载

## 用法

直接打开 `index.html`（双击即可，无需服务器）；或访问线上版本：

**https://chenchi-arch.github.io/diva-web/**

```
index.html
assets/style.css    面板外框与等比缩放
assets/tables.js    五十音表 / 罗马音解析 / 示例序列（与 Max 版同源）
assets/engine.js    DivaEngine（Web Audio 引擎；在线与离线共用）
assets/app.js       Canvas 面板绘制与交互
assets/wav.js       AudioBuffer → 16bit WAV
```

## 开发/自测

见 `NOTES-web.md`（逐模块讲解、两轮自测数据、与 Max 版的 A/B 与已知差异清单、11 条坑）。
自测脚本在 `tools/`（需要本机 Edge + `playwright-core`）：

```powershell
node tools/run_test1.js    # 无头端到端：0 console 错误 + 截图 + 导出非静音
node tools/run_test2.js    # 渲染 WAV 供 A/B
node tools/analyze.js <a.wav> <b.wav>
```

## 许可 / 归属

个人毕业设计（NUX 合作）配套原型；参考与靶子来自同一项目的 Max 版实现。
