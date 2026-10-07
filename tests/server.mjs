// Starts a throwaway server (temp .env and data folder) and checks the API: static files,
// profile storage, the settings screen and protection against cross-site writes. No AI calls.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectRoot, report, heading, summary } from './lib.mjs';

const dir = mkdtempSync(join(tmpdir(), 'wortweg-server-'));
const envFile = join(dir, 'test.env');
writeFileSync(envFile, '# test\nGEMINI_API_KEY=secret-key-1234\n');
const port = 4300 + Math.floor(Math.random() * 500);
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, PORT: String(port), ENV_FILE: envFile, DATA_DIR: join(dir, 'data'), IDLE_MINUTES: '0' };
for (const name of Object.keys(env)) if (/^(AI_|GEMINI_|GOOGLE_|ANTHROPIC_|OPENAI_|OPENROUTER_|GROQ_|MISTRAL_|DEEPSEEK_|CUSTOM_)/.test(name)) delete env[name];
const child = spawn(process.execPath, [join(projectRoot, 'server', 'server.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
child.stdout.on('data', chunk => { output += chunk; });
child.stderr.on('data', chunk => { output += chunk; });

const json = (path, method = 'GET', body, headers = {}) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  .then(async response => ({ status: response.status, data: await response.json().catch(() => null) }));
const check = (ok, title, detail = '') => report(ok ? 'PASS' : 'FAIL', title, detail);

try {
  let up = false;
  for (let i = 0; i < 50 && !up; i++) { await new Promise(r => setTimeout(r, 100)); up = await fetch(base + '/api/ping').then(r => r.ok, () => false); }
  if (!up) throw new Error(`server did not start:\n${output}`);

  heading('Static files and profile');
  const page = await fetch(base + '/');
  check(page.ok && /Wortweg/.test(await page.text()), 'Serves the app');
  check((await fetch(base + '/../.env')).status === 404 && (await fetch(base + '/%2e%2e/server/server.mjs')).status === 404, 'Refuses paths outside app/');
  const saved = await json('/api/profile', 'PUT', { progress: { level: 'B1', words: { 'der Tisch': { seen: 1 } } } });
  const loaded = await json('/api/profile');
  check(saved.status === 200 && loaded.data.progress.level === 'B1' && existsSync(join(dir, 'data', 'profiles')), 'Saves progress under DATA_DIR');

  heading('Cross-site protection');
  const plain = await fetch(base + '/api/profile', { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: '{"progress":{}}' });
  const foreign = await json('/api/profile', 'PUT', { progress: {} }, { Origin: 'https://evil.example' });
  check(plain.status === 403 && foreign.status === 403, 'Rejects non-JSON and foreign-origin writes', `${plain.status} / ${foreign.status}`);
  check(!page.headers.get('access-control-allow-origin'), 'No CORS header');

  heading('AI settings');
  const view = await json('/api/settings');
  const gemini = view.data.providers.find(p => p.id === 'gemini');
  check(view.data.configured && view.data.current.provider === 'gemini' && gemini.keys.join() === '…1234', 'Shows the current provider and only a key hint');
  check(!JSON.stringify(view.data).includes('secret-key'), 'Never returns the key itself');
  const bad = await json('/api/settings', 'PUT', { provider: 'gemini', model: 'x\nAI_PROVIDER=evil' });
  check(bad.status === 400, 'Rejects values with line breaks');
  const put = await json('/api/settings', 'PUT', { provider: 'anthropic', keys: 'sk-ant-1, sk-ant-2', model: 'claude-test', fallbacks: '' });
  const text = readFileSync(envFile, 'utf8');
  check(put.status === 200 && put.data.configured && put.data.current.model === 'claude-test', 'Switches provider without a restart');
  check(text.includes('# test') && text.includes('GEMINI_API_KEY=secret-key-1234') && text.includes('ANTHROPIC_API_KEY=sk-ant-1,sk-ant-2') && text.includes('AI_PROVIDER=anthropic'), 'Writes .env, keeps comments and the other provider\'s key');
  const status = await json('/api/ai/status');
  const config = await fetch(base + '/ai-config.js').then(r => r.text());
  check(status.data.provider === 'anthropic' && config.includes('/api/ai'), 'Status and ai-config.js follow the new settings');
  const off = await json('/api/settings', 'PUT', { provider: 'none' });
  check(off.status === 200 && !off.data.configured && (await fetch(base + '/ai-config.js').then(r => r.text())).includes('= "";'), 'Can switch AI off');
  const keep = await json('/api/settings', 'PUT', { provider: 'gemini', model: 'gemini-x', fallbacks: '' });
  check(keep.data.configured && keep.data.providers.find(p => p.id === 'gemini').keys.join() === '…1234', 'An empty key field keeps the saved key');
} catch (error) {
  report('FAIL', 'Server test crashed', error.message);
} finally {
  child.kill();
}
summary();
