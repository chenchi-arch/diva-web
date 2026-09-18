/* api_push.js —— 用 GitHub Git Data API 推送本地 HEAD 内容（绕过 git-over-HTTPS 的网络问题）
 * 用法: node tools/api_push.js ["commit message"]
 * 依赖: 本机 gh 已登录（token 由 `gh auth token` 读取，绝不打印）
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const https = require('https');
const path = require('path');

const REPO = 'chenchi-arch/diva-web';
const DIR = 'D:/OpenClawTemp/diva-web';
const MSG = process.argv[2] || 'sync via Git Data API';

const env = Object.assign({}, process.env, {
  GH_CONFIG_DIR: (function () {
    const full = 'C:\\Users\\lenovo\\.openclaw\\credentials\\github\\system\\ghp_f4e69e1b4a0d5faef4b0421fa86d5726';
    const cur = process.env.GH_CONFIG_DIR;
    // 传进来的目录必须真实存在，否则回退到已知真名（终端显示常把长名截断成带省略号的形状）
    return (cur && fs.existsSync(path.join(cur, 'hosts.yml'))) ? cur : full;
  })()
});
delete env.GH_TOKEN; delete env.HTTP_PROXY; delete env.HTTPS_PROXY; delete env.http_proxy; delete env.https_proxy;
const token = execFileSync('gh', ['auth', 'token'], { env, encoding: 'utf8' }).trim();
console.log('[api_push] token len=' + token.length);

function api(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = {
      'User-Agent': 'diva-web-deploy', 'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + token
    };
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = https.request({ hostname: 'api.github.com', path: p, method, headers }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) { try { resolve(JSON.parse(d || '{}')); } catch (e) { resolve({}); } }
        else reject(new Error(res.statusCode + ' ' + d.slice(0, 300)));
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  // 1) 当前 main 的 commit（作为 parent）
  let base = null;
  try { base = (await api('GET', `/repos/${REPO}/git/ref/heads/main`)).object.sha; } catch (e) { console.log('[api_push] no main yet: ' + e.message); }
  console.log('[api_push] base=' + base);

  // 2) 本地 tracked 文件（模式 + 路径）
  const ls = execFileSync('git', ['ls-files', '-s'], { cwd: DIR, encoding: 'utf8' }).trim().split('\n');
  const entries = [];
  for (const line of ls) {
    const m = line.match(/^(\d{6}) ([0-9a-f]+) \d+\t(.+)$/);
    if (!m) continue;
    const [, mode, , file] = m;
    const abs = path.join(DIR, file);
    const b64 = fs.readFileSync(abs).toString('base64');
    const blob = await api('POST', `/repos/${REPO}/git/blobs`, { content: b64, encoding: 'base64' });
    entries.push({ path: file, mode, type: 'blob', sha: blob.sha });
    console.log('  blob ' + file + ' -> ' + blob.sha.slice(0, 8) + '  (' + fs.statSync(abs).size + 'B)');
  }

  // 3) tree
  const tree = await api('POST', `/repos/${REPO}/git/trees`, { tree: entries });
  console.log('[api_push] tree=' + tree.sha);

  // 4) commit
  const commit = await api('POST', `/repos/${REPO}/git/commits`, {
    message: MSG, tree: tree.sha, parents: base ? [base] : []
  });
  console.log('[api_push] commit=' + commit.sha);

  // 5) 更新 ref
  if (base) {
    await api('PATCH', `/repos/${REPO}/git/refs/heads/main`, { sha: commit.sha, force: true });
  } else {
    await api('POST', `/repos/${REPO}/git/refs`, { ref: 'refs/heads/main', sha: commit.sha });
  }
  const now = (await api('GET', `/repos/${REPO}/git/ref/heads/main`)).object.sha;
  console.log('[api_push] remote main now = ' + now + (now === commit.sha ? '  ✅ MATCH' : '  ❌ MISMATCH'));
})().catch(e => { console.error('FATAL ' + e.message); process.exit(1); });
