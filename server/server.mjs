// Local Wortweg server: serves the PWA from app/, stores progress per machine in data/profiles/,
// and proxies AI calls so API keys never reach the browser.
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, access, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { extname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { loadEnvFile, getConfig, runAi, testConnection, listModels, Mistakes } from './ai.mjs';
import { PROVIDERS, keysFor, updateEnvFile } from './providers.mjs';
import { loadAssets, expandVocabulary } from './vocab-expand.mjs';
import { tagThemes, untaggedCount } from './goethe.mjs';

const STARTUP_TAG_BATCHES = 3;
const LEVELS = ['A1', 'A2', 'B1', 'B2'];

const Articles = createRequire(import.meta.url)('../app/js/articles.js');

const serverDir = resolve(fileURLToPath(new URL('.', import.meta.url)));
const projectRoot = resolve(serverDir, '..');
const root = join(projectRoot, 'app');
const envPath = process.env.ENV_FILE ? resolve(process.env.ENV_FILE) : join(projectRoot, '.env');
loadEnvFile(envPath);
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
let ai = getConfig();
const send = (response, status, body, type = 'application/json; charset=utf-8') => { response.writeHead(status, { 'Content-Type': type }); response.end(typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body)); };

// One profile per machine + install path, so copies of the project don't share progress.
const envId = `env-${createHash('sha256').update(`${hostname()}|${projectRoot}`).digest('hex').slice(0, 12)}`;
const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(projectRoot, 'data');
const profileDir = join(dataDir, 'profiles', envId);
const profileLabel = (relative(projectRoot, profileDir).startsWith('..') ? profileDir : relative(projectRoot, profileDir)).replace(/\\/g, '/');
const metaPath = join(profileDir, 'meta.json');
const progressPath = join(profileDir, 'progress.json');
const aiLogPath = join(profileDir, 'ai-log.jsonl');
const vocabPath = join(profileDir, 'vocab-extra.json');
const assets = loadAssets(root);
const expanding = new Set();

async function readExtraVocab() {
  try { const data = JSON.parse(await readFile(vocabPath, 'utf8')); return data && typeof data.themes === 'object' ? data : { themes: {} }; }
  catch { return { themes: {} }; }
}
// Serialise read-modify-write cycles on vocab-extra.json.
let vocabLock = Promise.resolve();
function updateExtraVocab(change) {
  const run = vocabLock.then(async () => {
    const latest = await readExtraVocab();
    const result = await change(latest);
    await ensureProfile();
    await writeFile(vocabPath, JSON.stringify(latest, null, 2));
    return result;
  });
  vocabLock = run.catch(() => {});
  return run;
}

// With a Goethe list installed, tag a few batches of it with themes on every start until done.
async function prepareGoethe() {
  if (!ai.configured || !assets.goethe || !untaggedCount(assets.goethe)) return;
  try {
    const result = await tagThemes(ai, { goethe: assets.goethe, themes: assets.themes, log: line => console.log(`[goethe] ${line}`), maxBatches: STARTUP_TAG_BATCHES });
    if (result.done) console.log('[goethe] theme tags complete');
  } catch (error) { console.error(`[goethe] theme tagging stopped, will resume on next start: ${error.message}`); }
}

async function logAi(entry) {
  try { await appendFile(aiLogPath, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n'); } catch { }
}
async function recentLessons(limit = 6) {
  try {
    const lines = (await readFile(aiLogPath, 'utf8')).trim().split('\n').reverse();
    const texts = [];
    for (const line of lines) {
      try { const entry = JSON.parse(line); if (entry.ok && entry.action === 'generate_lesson' && entry.lessonDe) texts.push(entry.lessonDe); } catch { }
      if (texts.length >= limit) break;
    }
    return texts;
  } catch { return []; }
}

function emptyProgress() {
  return { words: {}, structuresByLevel: {}, mistakes: {}, artikel: { nouns: {} }, recentSessions: [], recentThemes: [], updatedAt: null };
}

function sanitizeProgress(progress) {
  const obj = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
  const arr = (value) => (Array.isArray(value) ? value : []);
  return {
    words: obj(progress?.words),
    structuresByLevel: obj(progress?.structuresByLevel),
    mistakes: Mistakes.normalizeMistakes(progress?.mistakes),
    artikel: Articles.normalizeArtikel(progress?.artikel),
    recentSessions: arr(progress?.recentSessions).slice(0, 40),
    recentThemes: arr(progress?.recentThemes).slice(0, 20),
    level: LEVELS.includes(progress?.level) ? progress.level : null,
    lastDirection: ['de-en', 'en-de'].includes(progress?.lastDirection) ? progress.lastDirection : null,
    sessionCount: Number.isInteger(progress?.sessionCount) && progress.sessionCount > 0 ? progress.sessionCount : 0,
    updatedAt: new Date().toISOString()
  };
}

async function ensureProfile() {
  await mkdir(profileDir, { recursive: true });
  try { await access(metaPath); }
  catch {
    await writeFile(metaPath, JSON.stringify({
      id: envId,
      hostname: hostname(),
      root: projectRoot,
      createdAt: new Date().toISOString(),
      resetHint: `Delete this folder to reset progress: ${profileLabel}`
    }, null, 2));
  }
  try { await access(progressPath); }
  catch { await writeFile(progressPath, JSON.stringify(emptyProgress(), null, 2)); }
}

async function readProgress() {
  await ensureProfile();
  try { return JSON.parse(await readFile(progressPath, 'utf8')); }
  catch { return emptyProgress(); }
}

async function writeProgress(progress) {
  await ensureProfile();
  const next = sanitizeProgress(progress);
  await writeFile(progressPath, JSON.stringify(next, null, 2));
  return next;
}

async function readBody(request) {
  let raw = '';
  for await (const chunk of request) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

// The page pings every minute; when it has been closed for a while, the server exits.
const idleMinutes = Number(process.env.IDLE_MINUTES ?? 15);
let lastRequest = Date.now();
if (idleMinutes > 0) {
  setInterval(() => {
    if (Date.now() - lastRequest > idleMinutes * 60000) {
      console.log(`No requests for ${idleMinutes} minutes (page closed); shutting down.`);
      process.exit(0);
    }
  }, 30000).unref();
}

// Writes must be JSON from this same origin, so other websites can't post to the local server.
function trustedWrite(request) {
  if (!/^application\/json/i.test(request.headers['content-type'] || '')) return false;
  const origin = request.headers.origin;
  return !origin || origin === `http://${request.headers.host}`;
}
const isLoopback = (request) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress);

// --- AI settings (only from this computer; keys are never sent back, only their last 4 characters) ---
const hint = (key) => `…${key.slice(-4)}`;
function settingsView() {
  return {
    configured: ai.configured, problem: ai.problem || null,
    current: { provider: ai.provider || 'none', model: ai.model || '', fallbacks: (ai.models || []).slice(1).join(', '), baseUrl: PROVIDERS[ai.provider]?.custom ? ai.baseUrl : '' },
    providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, keyless: Boolean(p.keyless), custom: Boolean(p.custom), keyUrl: p.keyUrl || null, note: p.note || null, model: p.model || '', fallbacks: (p.fallbacks || []).join(', '), baseUrl: p.baseUrl || '', keys: keysFor(id).map(hint) }))
  };
}
// Turns the settings form into .env changes; a blank key field keeps the saved keys.
function settingsChanges(body) {
  const clean = (value, max = 300) => { const text = String(value ?? '').trim(); if (text.length > max || /[\r\n]/.test(text)) throw new Error('Invalid value.'); return text; };
  const provider = clean(body.provider, 40);
  if (provider !== 'none' && !PROVIDERS[provider]) throw new Error('Unknown provider.');
  const preset = PROVIDERS[provider];
  const changes = { AI_PROVIDER: provider, AI_MODEL: preset ? clean(body.model, 120) : '', AI_FALLBACK_MODELS: preset ? clean(body.fallbacks) : '', AI_BASE_URL: preset?.custom ? clean(body.baseUrl) : '' };
  if (changes.AI_BASE_URL && !/^https?:\/\/\S+$/.test(changes.AI_BASE_URL)) throw new Error('The base URL must start with http:// or https://.');
  const keys = clean(body.keys, 2000).split(/[\s,]+/).filter(Boolean).join(',');
  if (keys && preset && !preset.keyless) preset.keyVars.forEach((name, i) => { changes[name] = i === 0 ? keys : ''; });
  return changes;
}
function withChanges(changes) {
  const env = { ...process.env };
  for (const [name, value] of Object.entries(changes)) { if (value) env[name] = value; else delete env[name]; }
  return env;
}
async function handleSettings(request, response, url) {
  if (!isLoopback(request)) return send(response, 403, { error: 'AI settings can only be changed on the computer running Wortweg.' });
  try {
    if (url.pathname === '/api/settings' && request.method === 'GET') return send(response, 200, settingsView());
    const changes = settingsChanges(await readBody(request));
    if (url.pathname === '/api/settings' && request.method === 'PUT') {
      updateEnvFile(envPath, changes);
      for (const [name, value] of Object.entries(changes)) { if (value) process.env[name] = value; else delete process.env[name]; }
      ai = getConfig();
      console.log(`[settings] AI: ${ai.configured ? `${ai.provider} · ${ai.model}` : `off${ai.problem ? ` (${ai.problem})` : ''}`}`);
      return send(response, 200, settingsView());
    }
    const config = getConfig(withChanges(changes));
    if (!config.configured) return send(response, 400, { error: config.problem ? `Not ready: ${config.problem}.` : 'AI is switched off.' });
    if (url.pathname === '/api/settings/test' && request.method === 'POST') return send(response, 200, { model: config.model, results: await testConnection(config) });
    if (url.pathname === '/api/settings/models' && request.method === 'POST') return send(response, 200, { models: await listModels(config) });
    return send(response, 404, { error: 'Not found.' });
  } catch (error) {
    return send(response, 400, { error: error.message });
  }
}

const server = createServer(async (request, response) => {
  lastRequest = Date.now();
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === '/api/ping') return send(response, 200, { ok: true });
  if (url.pathname.startsWith('/api/') && request.method !== 'GET' && !trustedWrite(request)) return send(response, 403, { error: 'Rejected cross-site request.' });
  if (url.pathname.startsWith('/api/settings')) return handleSettings(request, response, url);
  if (url.pathname === '/ai-config.js') return send(response, 200, `window.WORTWEG_AI_ENDPOINT = ${JSON.stringify(ai.configured ? '/api/ai' : '')};\n`, 'text/javascript; charset=utf-8');

  if (url.pathname === '/api/profile') {
    if (request.method === 'GET') {
      const progress = await readProgress();
      return send(response, 200, { id: envId, path: profileLabel, progress });
    }
    if (request.method === 'PUT' || request.method === 'POST') {
      try {
        const body = await readBody(request);
        const progress = await writeProgress(body.progress || body);
        return send(response, 200, { ok: true, id: envId, path: profileLabel, progress });
      } catch (error) {
        return send(response, 400, { error: 'Could not save the profile.' });
      }
    }
    return send(response, 405, { error: 'Only GET and PUT are supported.' });
  }

  if (url.pathname === '/api/vocab' && request.method === 'GET') {
    const extra = await readExtraVocab();
    const total = Object.values(extra.themes).reduce((sum, list) => sum + list.length, 0);
    return send(response, 200, { ...extra, total });
  }

  if (url.pathname === '/api/vocab/expand') {
    if (request.method !== 'POST') return send(response, 405, { error: 'Only POST is supported.' });
    if (!ai.configured) return send(response, 503, { error: 'AI is not configured (open AI settings).' });
    let input = {};
    try {
      input = await readBody(request);
      const theme = assets.themes.find(t => t.id === input.themeId);
      if (!theme) return send(response, 400, { error: 'Unknown theme.' });
      if (expanding.has(theme.id)) return send(response, 409, { error: 'Already generating words for this theme.' });
      expanding.add(theme.id);
      try {
        const extra = await readExtraVocab();
        const existing = [...assets.themes.flatMap(t => t.words.map(w => w.w)), ...Object.values(extra.themes).flat().map(w => w.w)];
        const level = LEVELS.includes(input.level) ? input.level : 'A2';
        const count = Math.min(10, Math.max(1, Number(input.count) || 6));
        const result = await expandVocabulary(ai, assets, { themeId: theme.id, level, count, existing, extraForTheme: extra.themes[theme.id] || [] });
        if (result.exhausted) {
          console.log(`[ai] expand_vocab ${theme.id} ${level} · no matching list words left for this theme`);
          return send(response, 200, { themeId: theme.id, words: [], rejected: [], exhausted: true });
        }
        await updateExtraVocab(latest => { latest.themes[theme.id] = [...(latest.themes[theme.id] || []), ...result.words]; });
        const meta = result._meta;
        console.log(`[ai] expand_vocab ${theme.id} ${level} · ${result.words.length} added, ${result.rejected.length} rejected · ${meta.ms} ms · ${meta.usage?.total ?? '?'} tokens`);
        await logAi({ ok: true, action: 'expand_vocab', level, theme: theme.id, words: result.words.map(w => w.w), rejected: result.rejected, meta });
        return send(response, 200, { themeId: theme.id, words: result.words, rejected: result.rejected, _meta: meta });
      } finally { expanding.delete(theme.id); }
    } catch (error) {
      console.error(`[ai] expand_vocab ERROR: ${error.message}`);
      await logAi({ ok: false, action: 'expand_vocab', theme: input.themeId, level: input.level, error: error.message });
      return send(response, 502, { error: error.message });
    }
  }

  if (url.pathname === '/api/ai/status') {
    return send(response, 200, { configured: ai.configured, provider: ai.provider, label: ai.label, model: ai.model, problem: ai.problem });
  }

  if (url.pathname === '/api/ai') {
    if (request.method !== 'POST') return send(response, 405, { error: 'Only POST is supported.' });
    if (!ai.configured) return send(response, 503, { error: 'AI is not configured (open AI settings).' });
    let input = {};
    try {
      input = await readBody(request);
      const context = input.action === 'generate_lesson' ? { recentLessons: await recentLessons() } : {};
      const result = await runAi(ai, input, context);
      const meta = result._meta;
      console.log(`[ai] ${input.action} ${input.level || ''} ok · ${meta.ms} ms · ${meta.usage?.total ?? '?'} tokens${meta.attempts > 1 ? ' · attempt ' + meta.attempts : ''}`);
      await logAi({ ok: true, action: input.action, level: input.level, theme: input.theme, words: (input.words || []).map(word => word.de), focus: input.focus, artikelNouns: (input.artikelNouns || []).map(noun => noun.de), lessonDe: result.lesson?.de, questions: result.questions, score: result.score, weakPoints: result.weakPoints, meta });
      return send(response, 200, result);
    } catch (error) {
      console.error(`[ai] ${input.action || '?'} ERROR: ${error.message}`);
      await logAi({ ok: false, action: input.action, level: input.level, error: error.message });
      return send(response, 502, { error: error.message });
    }
  }

  // Static files from app/; dotfiles and paths outside app/ are refused.
  const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (/(^|[\\/])\./.test(requested)) return send(response, 404, 'Not found', 'text/plain; charset=utf-8');
  const file = normalize(join(root, requested));
  if (!file.startsWith(root + sep) || !existsSync(file)) return send(response, 404, 'Not found', 'text/plain; charset=utf-8');
  try { return send(response, 200, await readFile(file), mime[extname(file)] || 'application/octet-stream'); }
  catch { return send(response, 500, 'Unable to read file', 'text/plain; charset=utf-8'); }
});

await ensureProfile();
server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use; Wortweg is probably already running: http://localhost:${port}` : error.message);
  process.exit(1);
});
server.listen(port, host, () => {
  const aiLabel = ai.configured ? `${ai.provider} · ${ai.model}${ai.apiKeys?.length > 1 ? ` · ${ai.apiKeys.length} keys` : ''}` : `offline mode${ai.problem ? ` (${ai.problem})` : ''}`;
  console.log(`Wortweg: http://localhost:${port} | AI: ${aiLabel} | profile: ${profileLabel}`);
  prepareGoethe();
});
