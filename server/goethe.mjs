// Optional Goethe-Institut word lists (data/goethe/, not part of the repo).
// When present, new AI vocabulary for A1–B1 is picked from these lists, using AI-assigned theme tags.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { callModel, AiError } from './ai.mjs';

const require = createRequire(import.meta.url);
export const Levels = require('./levels.cjs');
const goetheDir = join(resolve(fileURLToPath(new URL('.', import.meta.url))), '..', 'data', 'goethe');
export const WORDLIST_PATH = join(goetheDir, 'wordlist.json');
export const TAGS_PATH = join(goetheDir, 'tags.json');
const TAG_BATCH = 100;
const MAX_FAILS = 2;

// Returns { source, levels: { A1: [...], A2: [...], B1: [...] } } or null when the list is not installed.
export function loadGoethe(path = WORDLIST_PATH) {
  if (!existsSync(path)) return null;
  const data = JSON.parse(readFileSync(path, 'utf8'));
  return data && data.levels ? data : null;
}

export function loadTags(path = TAGS_PATH) {
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return { words: data.words && typeof data.words === 'object' ? data.words : {}, fails: data.fails && typeof data.fails === 'object' ? data.fails : {} };
  } catch { return { words: {}, fails: {} }; }
}

export function saveTags(tags, path = TAGS_PATH) {
  writeFileSync(path, JSON.stringify(tags, null, 1));
}

// Content words only: capitalised entries (nouns are listed with articles) and very short keys are skipped.
export function candidateEntries(goethe) {
  const out = [];
  if (!goethe) return out;
  for (const level of Levels.LISTED) {
    for (const w of goethe.levels[level] || []) {
      if (/^[A-ZÄÖÜ]/.test(w) || Levels.lemmaKey(w).length < 3) continue;
      out.push({ w, level });
    }
  }
  return out;
}

export function untaggedCount(goethe, tags = loadTags()) {
  return candidateEntries(goethe).filter(entry => !(entry.w in tags.words)).length;
}

// Words tagged with the theme, at or below the level; exact-level words first.
export function pickCandidates(goethe, tags, { themeId, level, taken, count, random = Math.random }) {
  const list = candidateEntries(goethe).filter(entry =>
    Levels.allows(entry.level, level)
    && (tags.words[entry.w] || []).includes(themeId)
    && (tags.fails[entry.w] || 0) < MAX_FAILS
    && !taken.has(Levels.lemmaKey(entry.w)));
  const exact = list.filter(entry => entry.level === level).sort(() => random() - 0.5);
  const lower = list.filter(entry => entry.level !== level).sort(() => random() - 0.5);
  return [...exact, ...lower].slice(0, count);
}

export function recordFailures(words, path = TAGS_PATH) {
  if (!words.length) return;
  const tags = loadTags(path);
  words.forEach(w => { tags.fails[w] = (tags.fails[w] || 0) + 1; });
  saveTags(tags, path);
}

function tagPrompt(themes, words) {
  return `A German vocabulary app has these themes (id = name):
${themes.map(theme => `${theme.id} = ${theme.name}`).join('\n')}

For each German word below, choose the themes in which it would naturally be taught (at most 2 theme ids).
- If the word is a function word (conjunction, preposition, pronoun, article, question word, number, greeting, "ja/nein" etc.), return an empty array.
- Only map very general verbs and adjectives (machen, haben, gut, groß, neu etc.) if they are really tied to a theme; otherwise return an empty array.
- Return an empty array for words that do not clearly fit a theme; do not force it.
- In the w field, return the word exactly as I gave it.
Words: ${words.join(' | ')}
Return JSON only: {"items":[{"w":"","t":[""]}]}`;
}

// Tags untagged list words in batches; progress is saved after every batch so it can resume.
export async function tagThemes(config, { goethe, themes, path = TAGS_PATH, log = () => {}, maxBatches = Infinity }) {
  const ids = themes.map(theme => theme.id);
  const schema = { type: 'OBJECT', properties: { items: { type: 'ARRAY', items: { type: 'OBJECT', properties: { w: { type: 'STRING' }, t: { type: 'ARRAY', items: { type: 'STRING', enum: ids } } }, required: ['w', 't'] } } }, required: ['items'] };
  let batches = 0;
  while (batches < maxBatches) {
    const tags = loadTags(path);
    const pending = candidateEntries(goethe).filter(entry => !(entry.w in tags.words)).map(entry => entry.w);
    if (!pending.length) return { done: true, remaining: 0 };
    const chunk = pending.slice(0, TAG_BATCH);
    const result = await callModel(config, {
      prompt: tagPrompt(themes, chunk),
      schema,
      temperature: 0.2,
      validate: (data) => {
        const items = Array.isArray(data.items) ? data.items : [];
        if (items.length < chunk.length / 2) throw new AiError('theme tag response is incomplete', 422, true);
        return data;
      }
    });
    const wanted = new Set(chunk);
    const latest = loadTags(path);
    let tagged = 0;
    for (const item of result.items) {
      const w = String(item.w || '').trim();
      if (!wanted.has(w)) continue;
      latest.words[w] = [...new Set((item.t || []).filter(id => ids.includes(id)))].slice(0, 2);
      tagged++;
    }
    saveTags(latest, path);
    batches++;
    log(`theme tags: ${tagged}/${chunk.length} words · ${pending.length - tagged} left · ${result._meta.model}`);
    if (!tagged) return { done: false, remaining: pending.length };
  }
  return { done: false, remaining: untaggedCount(goethe, loadTags(path)) };
}
