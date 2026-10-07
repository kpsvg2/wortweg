// Regenerates the README screenshots and the GitHub social preview (docs/screenshots/).
// Uses your AI settings (2 requests) unless --offline is given. Needs Edge or Chrome:
//   npm install && npm run screenshots [-- --offline] [-- --channel chrome]
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'docs', 'screenshots');
const offline = process.argv.includes('--offline');
const channelIndex = process.argv.indexOf('--channel');
const channel = channelIndex > -1 ? process.argv[channelIndex + 1] : process.platform === 'win32' ? 'msedge' : 'chrome';
const port = 4900 + Math.floor(Math.random() * 90);
const base = `http://127.0.0.1:${port}`;
mkdirSync(out, { recursive: true });

// Separate profile (data/screenshots) so your own progress is untouched.
const server = spawn(process.execPath, [join(root, 'server', 'server.mjs')], {
  env: { ...process.env, PORT: String(port), DATA_DIR: join(root, 'data', 'screenshots'), IDLE_MINUTES: '0', ...(offline ? { AI_PROVIDER: 'none' } : {}) },
  stdio: 'inherit'
});
const browser = await chromium.launch({ channel });
try {
  for (let i = 0; i < 50 && !(await fetch(base + '/api/ping').then(r => r.ok, () => false)); i++) await new Promise(r => setTimeout(r, 100));
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2, colorScheme: 'light' });
  const page = await context.newPage();
  const shot = (name, options = {}) => page.screenshot({ path: join(out, `${name}.png`), ...options });
  const settle = () => page.waitForTimeout(400);

  await page.goto(base);
  await page.waitForFunction(() => /Word pool ready/.test(document.getElementById('pool-status').textContent));
  await page.click('.level[data-level="A2"]');
  await shot('home');

  await page.click('#start');
  await page.waitForSelector('#quiz.active', { timeout: 120000 });
  const right = await page.evaluate(() => state.questions[0].en);
  await page.click(`#options .option[data-answer="${right.replace(/"/g, '\\"')}"]`);
  await settle();
  await shot('quiz');
  for (let i = 0; i < 5; i++) {
    if (i) await page.click(i === 2 ? '#dont-know' : '#options .option >> nth=0');
    await page.click('#next');
  }
  await page.waitForSelector('#translation.active');
  // A plausible learner answer: the reference translation minus its last sentence.
  const answer = await page.evaluate(() => {
    const reverse = state.direction === 'en-de';
    const parts = (reverse ? state.lesson.de : state.lesson.en).split(/(?<=[.!?])\s+/);
    return parts.slice(0, Math.max(2, parts.length - 1)).join(' ');
  });
  await page.fill('#translation-input', answer);
  await settle();
  await shot('translation');
  await page.click('#check-translation');
  await page.waitForSelector('#result.active', { timeout: 120000 });
  await settle();
  await shot('result', { fullPage: true });

  await page.click('#restart');
  await page.click('#mode-switch button[data-mode="guess"]');
  await page.click('#guess-start');
  await page.click('#articles-options .option >> nth=1');
  await settle();
  await shot('guess');
  await page.click('#articles-exit');
  await page.click('#mode-switch button[data-mode="normal"]');

  await page.click('#settings-open');
  await page.waitForSelector('#settings.active');
  // Never publish real key hints.
  await page.evaluate(() => { document.getElementById('set-keys').placeholder = 'Saved: …a1b2 · leave empty to keep'; });
  await page.click('#theme-toggle');
  await settle();
  await shot('settings-dark');
  await page.click('#settings-back');
  await settle();
  await shot('home-dark');
  await page.click('#theme-toggle');

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const mobile = await phone.newPage();
  await mobile.goto(base);
  await mobile.waitForFunction(() => /Word pool ready/.test(document.getElementById('pool-status').textContent));
  await mobile.screenshot({ path: join(out, 'mobile.png') });

  // 1280×640 social preview card for the GitHub repository settings.
  const card = await browser.newPage({ viewport: { width: 1280, height: 640 } });
  const image = (name) => `data:image/png;base64,${readFileSync(join(out, `${name}.png`)).toString('base64')}`;
  const icon = readFileSync(join(root, 'app', 'icons', 'icon.svg'), 'utf8');
  await card.setContent(`<!doctype html><html><body style="margin:0;width:1280px;height:640px;display:flex;align-items:center;gap:56px;padding:0 64px;box-sizing:border-box;font-family:'Segoe UI',system-ui,sans-serif;background:radial-gradient(circle at 85% 10%,#e5f4ff 0,transparent 520px),#f8f8f6;color:#172235;overflow:hidden">
    <div style="flex:0 0 470px"><div style="display:flex;align-items:center;gap:14px;font-weight:800;font-size:40px;letter-spacing:-.04em"><div style="width:64px;height:64px">${icon.replace('<svg', '<svg width="64" height="64"')}</div>Wortweg</div>
    <h1 style="font-size:58px;line-height:1.02;letter-spacing:-.055em;margin:30px 0 22px">See the word.<br>Understand it <em>in context.</em></h1>
    <p style="font-size:23px;line-height:1.45;color:#667085;margin:0">Learn German with 5 words, a short AI-written story and your own translation.</p></div>
    <img src="${image('quiz')}" style="width:760px;border-radius:22px;box-shadow:0 30px 70px #202b3f30;border:1px solid #e5e7eb"></body></html>`);
  await card.screenshot({ path: join(out, 'social-preview.png') });
  console.log(`Screenshots written to ${out}`);
} finally {
  await browser.close();
  server.kill();
}
