// Shared helpers for the check scripts: module loading, seeded RNG, coloured PASS/WARN/FAIL reporting.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appDir = join(projectRoot, 'app');
const require = createRequire(import.meta.url);

export function loadThemes() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(readFileSync(join(appDir, 'data', 'vocabulary.js'), 'utf8'), context);
  return context.window.WORTWEG_VOCAB.themes;
}
export const SessionLib = require(join(appDir, 'js', 'session.js'));
export const Engine = require(join(appDir, 'js', 'engine.js'));
export const Mistakes = require(join(appDir, 'js', 'mistakes.js'));
export const Articles = require(join(appDir, 'js', 'articles.js'));
export const Validate = require(join(appDir, 'js', 'validate.js'));
export const Levels = require(join(projectRoot, 'server', 'levels.cjs'));
export const levelOf = (word) => (Levels.isLevel(word?.level) ? word.level : 'B2');

// mulberry32: small deterministic PRNG so simulations are reproducible.
export function seeded(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const results = [];
const color = { PASS: '\x1b[32m', WARN: '\x1b[33m', FAIL: '\x1b[31m', INFO: '\x1b[36m' };
export function report(status, title, detail = '') {
  results.push({ status, title, detail });
  console.log(`${color[status] || ''}[${status}]\x1b[0m ${title}${detail ? ' — ' + detail : ''}`);
}
export function heading(text) { console.log(`\n\x1b[1m== ${text} ==\x1b[0m`); }
export function summary() {
  const count = (status) => results.filter(r => r.status === status).length;
  console.log(`\nSummary: ${count('PASS')} passed · ${count('WARN')} warnings · ${count('FAIL')} failed`);
  process.exitCode = count('FAIL') ? 1 : 0;
  return results;
}
export const pct = (value) => `${(value * 100).toFixed(1)}%`;

export function sentences(text) {
  return String(text).replace(/[„“”"«»]/g, '').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 1);
}
export function normalizeSentence(text) { return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim(); }
export function tokens(text) { return normalizeSentence(text).split(' ').filter(Boolean); }
export function ngrams(text, n = 3) {
  const t = tokens(text); const set = new Set();
  for (let i = 0; i + n <= t.length; i++) set.add(t.slice(i, i + n).join(' '));
  return set;
}
export function jaccard(a, b) {
  if (!a.size && !b.size) return 0;
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

let entriesByWord = null;
export function containsWord(text, de, entry) {
  if (!entry) {
    if (!entriesByWord) entriesByWord = new Map(loadThemes().flatMap(theme => theme.words.map(w => [w.w, w])));
    entry = entriesByWord.get(de);
  }
  return Validate.containsWord(text, de, entry);
}
