/* gh_auth_browser.js —— 用「复制出来的 Chrome 配置文件」完成设备授权（绕过默认 user-data-dir 的 CDP 限制）
 * 用法: node tools/gh_auth_browser.js 7F2E-5FF7
 */
const fs = require('fs');
const path = require('path');
const PW = 'C:/Users/lenovo/AppData/Roaming/npm/node_modules/openclaw/node_modules/playwright-core';
const { chromium } = require(PW);
const SRC = 'C:\\Users\\lenovo\\AppData\\Local\\Google\\Chrome\\User Data';
const DST = 'D:\\OpenClawTemp\\diva-web\\test\\chromeprof';
const OUT = 'D:/OpenClawTemp/diva-web/test';
const code = process.argv[2];
if (!code) { console.error('need code'); process.exit(1); }

function copyIfNewer(src, dst) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  return true;
}
fs.mkdirSync(DST, { recursive: true });
copyIfNewer(path.join(SRC, 'Local State'), path.join(DST, 'Local State'));
for (const f of ['Network\\Cookies', 'Preferences', 'Secure Preferences', 'Login Data', 'Web Data']) {
  copyIfNewer(path.join(SRC, 'Default', f), path.join(DST, 'Default', f));
}
console.log('[prep] profile copied to ' + DST);
console.log('[prep] files: ' + fs.readdirSync(path.join(DST, 'Default')).join(', '));

(async () => {
  const ctx = await chromium.launchPersistentContext(DST, {
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: false,
    viewport: { width: 1000, height: 820 },
    args: ['--profile-directory=Default', '--no-first-run', '--no-default-browser-check']
  });
  ctx.setDefaultTimeout(30000);
  const page = ctx.pages()[0] || await ctx.newPage();
  const log = (m) => console.log('[auth] ' + m);

  await page.goto('https://github.com/login/device', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  log('url=' + page.url());
  await page.screenshot({ path: path.join(OUT, 'auth-b1-device.png') });
  const body1 = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
  log('page: ' + body1.slice(0, 220));

  const input = page.locator('input#user_code, input[name="user_code"]').first();
  if (!(await input.count())) { log('NO CODE INPUT — 未登录或页面不同'); await ctx.close(); process.exit(3); }
  await input.fill(code);
  await page.screenshot({ path: path.join(OUT, 'auth-b2-code.png') });
  await page.locator('button:has-text("Continue"), input[type="submit"]').first().click();
  await page.waitForTimeout(2500);
  log('after code -> ' + page.url());
  await page.screenshot({ path: path.join(OUT, 'auth-b3-authorize.png') });
  const body2 = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
  log('page: ' + body2.slice(0, 320));

  const btn = page.locator('button:has-text("Authorize")').first();
  if (await btn.count()) {
    await btn.click();
    await page.waitForTimeout(3000);
  } else { log('no Authorize button'); }
  await page.screenshot({ path: path.join(OUT, 'auth-b4-done.png') });
  log('final url=' + page.url());
  log('final page: ' + (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 260));
  await ctx.close();
  log('closed');
})().catch(e => { console.error('FATAL ' + e.message); process.exit(1); });
