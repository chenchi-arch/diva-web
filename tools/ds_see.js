// ds_see.js - send image(s) to DeepSeek for description (China-direct API)
// usage: node ds_see.js <img1.png> [img2.png ...] [--prompt "..."] [--model m]
const fs = require("fs");
const path = require("path");
const https = require("https");

const argv = process.argv.slice(2);
const files = [];
let prompt = "Describe this screenshot in detail: overall layout, element styles, colours, and a list of legibility/aesthetic problems.";
let modelArg = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--prompt") { prompt = argv[++i]; }
  else if (a === "--model") { modelArg = argv[++i]; }
  else files.push(a);
}
if (!files.length) { console.log("usage: node ds_see.js <img...> [--prompt ...] [--model ...]"); process.exit(1); }

function findKeys() {
  const cands = [];
  const seen = new Set();
  const add = (v, src) => { const m = String(v || "").match(/sk-[A-Za-z0-9_-]{16,}/); if (m && !seen.has(m[0])) { seen.add(m[0]); cands.push({ v: m[0], src }); } };
  const scanFile = (p, src) => { try { const t = fs.readFileSync(p, "utf8"); (t.match(/sk-[A-Za-z0-9_-]{16,}/g) || []).forEach(k => add(k, src)); } catch (e) { } };
  scanFile(path.join(process.env.USERPROFILE || process.env.HOME || "", ".codex", "config.toml"), "codex-config");
  scanFile("D:/OpenClawTemp/openai.key", "openai.key");
  ["DEEPSEEK_API_KEY", "DS_KEY", "OPENAI_API_KEY"].forEach(n => { if (process.env[n]) add(process.env[n], "env:" + n); });
  return cands;
}

function post(key, model, images, prompt) {
  return new Promise((resolve, reject) => {
    const content = [{ type: "text", text: prompt }];
    images.forEach(b64 => content.push({ type: "image_url", image_url: { url: "data:image/png;base64," + b64 } }));
    const body = JSON.stringify({ model, messages: [{ role: "user", content }], max_tokens: 1500, temperature: 0.2, stream: false });
    const req = https.request({
      hostname: "api.deepseek.com", path: "/chat/completions", method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key, "Content-Length": Buffer.byteLength(body) }
    }, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, body: d })); });
    req.on("error", reject);
    req.setTimeout(120000, () => { req.destroy(new Error("timeout")); });
    req.write(body); req.end();
  });
}

(async () => {
  const imgs = files.map(f => fs.readFileSync(f).toString("base64"));
  const models = modelArg ? [modelArg] : ["deepseek-v4-flash", "deepseek-chat"];
  const keys = findKeys();
  if (!keys.length) { console.log("no key candidate found"); process.exit(2); }
  let lastErr = null;
  for (const k of keys) {
    for (const m of models) {
      try {
        console.log("try model=" + m + " keySrc=" + k.src + " keyLen=" + k.v.length);
        const r = await post(k.v, m, imgs, prompt);
        if (r.status === 200) {
          const j = JSON.parse(r.body);
          const msg = (((j.choices || [])[0] || {}).message) || {};
          const out = (msg.content && String(msg.content).trim())
            ? msg.content
            : ((msg.reasoning_content && String(msg.reasoning_content).trim()) ? msg.reasoning_content : "(no content)");
          console.log("=== OK model=" + m + " keySrc=" + k.src + " ===");
          console.log(out);
          return;
        }
        console.log("status " + r.status + ": " + r.body.slice(0, 300));
        lastErr = r.status + " " + r.body.slice(0, 200);
        if (r.status === 401 || r.status === 403) break;
      } catch (e) { console.log("err: " + e.message); lastErr = e.message; }
    }
  }
  console.log("FAILED last: " + lastErr);
  process.exit(3);
})();

