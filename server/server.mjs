// Local Wortweg server: serves the PWA from app/, stores progress per machine in data/profiles/,
// and proxies AI calls so API keys never reach the browser.
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, access, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { loadEnvFile, getConfig, runAi, Mistakes } from './ai.mjs';
import { loadAssets, expandVocabulary } from './vocab-expand.mjs';
import { tagThemes, untaggedCount } from './goethe.mjs';

const STARTUP_TAG_BATCHES = 3;
const LEVELS = ['A1', 'A2', 'B1', 'B2'];

const Articles = createRequire(import.meta.url)('../app/js/articles.js');

const serverDir = resolve(fileURLToPath(new URL('.', import.meta.url)));
const projectRoot = resolve(serverDir, '..');
const root = join(projectRoot, 'app');
loadEnvFile(projectRoot);
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const ai = getConfig();
const configured = ai.configured;
const send = (response, status, body, type = 'application/json; charset=utf-8') => { response.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' }); response.end(typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body)); };

// One profile per machine + install path, so copies of the project don't share progress.
const envId = `env-${createHash('sha256').update(`${hostname()}|${projectRoot}`).digest('hex').slice(0, 12)}`;
const profileDir = join(projectRoot, 'data', 'profiles', envId);
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
  if (!configured || !assets.goethe || !untaggedCount(assets.goethe)) return;
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
      resetHint: `Delete this folder to reset progress: data/profiles/${envId}`
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

const server = createServer(async (request, response) => {
  lastRequest = Date.now();
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === '/api/ping') return send(response, 200, { ok: true });
  if (url.pathname === '/ai-config.js') return send(response, 200, `window.WORTWEG_AI_ENDPOINT = ${JSON.stringify(configured ? '/api/ai' : '')};\n`, 'text/javascript; charset=utf-8');

  if (url.pathname === '/api/profile') {
    if (request.method === 'GET') {
      const progress = await readProgress();
      return send(response, 200, { id: envId, path: `data/profiles/${envId}`, progress });
    }
    if (request.method === 'PUT' || request.method === 'POST') {
      try {
        const body = await readBody(request);
        const progress = await writeProgress(body.progress || body);
        return send(response, 200, { ok: true, id: envId, path: `data/profiles/${envId}`, progress });
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
    if (!configured) return send(response, 503, { error: 'AI is not configured (.env).' });
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
    return send(response, 200, { configured, provider: ai.provider, model: ai.model });
  }

  if (url.pathname === '/api/ai') {
    if (request.method !== 'POST') return send(response, 405, { error: 'Only POST is supported.' });
    if (!configured) return send(response, 503, { error: 'AI is not configured (.env).' });
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
  const aiLabel = configured ? `${ai.provider} · ${ai.model}${ai.apiKeys?.length > 1 ? ` · ${ai.apiKeys.length} keys` : ''}` : 'offline mode (no .env)';
  console.log(`Wortweg: http://localhost:${port} | AI: ${aiLabel} | profile: data/profiles/${envId}`);
  prepareGoethe();
});
