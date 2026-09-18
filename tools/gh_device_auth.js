/* gh_device_auth.js —— 用本机 Chrome（Default 配置文件，含 GitHub 会话）完成 gh 设备授权
 * 用法: node tools/gh_device_auth.js F3D9-22EE
 * 只访问 github.com/login/device，不做其它导航；每步截图存 test/
 */
const path = require('path');
const fs = require('fs');
const PW = 'C:/Users/lenovo/AppData/Roaming/npm/node_modules/openclaw/node_modules/playwright-core';
const { chromium } = require(PW);
const OUT = 'D:/OpenClawTemp/diva-web/test';
const code = process.argv[2];
if (!code) { console.error('need one-time code'); process.exit(1); }

(async () => {
  const ctx = await chromium.launchPersistentContext('C:\\Users\\lenovo\\AppData\\Local\\Google\\Chrome\\User Data', {
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: false,
    viewport: { width: 1100, height: 860 },
    args: ['--profile-directory=Default', '--no-first-run', '--no-default-browser-check']
  });
  ctx.setDefaultTimeout(30000);
  const page = ctx.pages()[0] || await ctx.newPage();
  const log = (m) => console.log('[auth] ' + m);

  await page.goto('https://github.com/login/device', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  log('url=' + page.url());
  await page.screenshot({ path: path.join(OUT, 'auth-1-device.png') });

  if (/\/login/.test(page.url())) {
    log('NOT LOGGED IN — 需要人工在浏览器登录 GitHub');
    await ctx.close(); process.exit(3);
  }
  // 填设备码
  const input = page.locator('input#user_code, input[name="user_code"]').first();
  await input.waitFor({ state: 'visible' });
  await input.fill(code);
  await page.screenshot({ path: path.join(OUT, 'auth-2-code.png') });
  await page.locator('button:has-text("Continue"), input[type="submit"]').first().click();
  log('submitted code -> ' + page.url());
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(OUT, 'auth-3-authorize.png') });

  // 授权页：点 Authorize
  const btn = page.locator('button:has-text("Authorize"), button[name="authorize"]').first();
  if (await btn.count()) {
    const txt = await page.locator('body').innerText().catch(() => '');
    log('authorize page: ' + txt.replace(/\s+/g, ' ').slice(0, 300));
    await btn.click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT, 'auth-4-done.png') });
    log('after authorize -> ' + page.url());
    const done = await page.locator('body').innerText().catch(() => '');
    log('page: ' + done.replace(/\s+/g, ' ').slice(0, 300));
  } else {
    log('no authorize button found; body=' + (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300));
  }
  await ctx.close();
  log('closed chrome');
})().catch(e => { console.error('FATAL ' + e.message); process.exit(1); });
