// Grows a theme's word pool with AI-generated entries that pass the same validator as the built-in vocabulary.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import vm from 'node:vm';
import { callModel, AiError } from './ai.mjs';
import { Levels, loadGoethe, loadTags, pickCandidates, recordFailures, TAGS_PATH } from './goethe.mjs';

const require = createRequire(import.meta.url);

export function loadAssets(appDir, { tagsPath = TAGS_PATH } = {}) {
  const appRoot = resolve(appDir);
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(readFileSync(join(appRoot, 'data', 'vocabulary.js'), 'utf8'), context);
  const goethe = loadGoethe();
  return {
    themes: context.window.WORTWEG_VOCAB.themes,
    Engine: require(join(appRoot, 'js', 'engine.js')),
    Validate: require(join(appRoot, 'js', 'validate.js')),
    goethe,
    levels: Levels.create(goethe),
    tagsPath
  };
}

export const lemmaKey = Levels.lemmaKey;

const S = { type: 'STRING' };
const ENTRY_SCHEMA = {
  type: 'OBJECT',
  properties: { w: S, m: S, k: S, s: S, v: S, r: S, sep: S, aux: S, pp: S, pret: S, inf: S, t: S, tp: S, ti: S, c: { type: 'ARRAY', items: S }, p: { type: 'BOOLEAN' }, pl: { type: 'BOOLEAN' }, sg: S, sgm: S },
  required: ['w', 'm', 'k', 'v', 'r', 't', 'tp', 'c']
};
const vocabSchema = (count) => ({ type: 'OBJECT', properties: { words: { type: 'ARRAY', minItems: count, items: ENTRY_SCHEMA } }, required: ['words'] });

const LEVEL_HINTS = {
  A1: 'A1: the most basic everyday words a beginner needs first (home, food, family, time, simple actions)',
  A2: 'A2: common everyday words beyond the basics (shopping, travel, work routines, health, simple feelings)',
  B1: 'B1: words for more detailed everyday, work and official situations (opinions, plans, paperwork, problems)',
  B2: 'B2: words beyond the basic Goethe-Institut A1-B1 lists that are still genuinely used in everyday life, at work and in official matters (abstract concepts, idiomatic verbs). Do NOT give literary, outdated, slang, poetic or narrow specialist words'
};
const TEACHER = 'You are a meticulous teacher of German for English speakers and a lexicographer.';

function taskFor({ theme, level, count, exclude, listed }) {
  if (listed) {
    return `${TEACHER} Add these German words, selected from the Goethe-Institut word list (up to level ${level}), to the "${theme.name}" theme of a vocabulary app: ${listed.join(' | ')}.
Do NOT change the words or swap in other words: use each word in the w field exactly as given (nouns with their article; if "der/die" is written, pick one article; reflexive verbs with "sich"). Skip a word if it does not fit this theme or a proper sentence under the rules below. Return at most ${count} words.`;
  }
  return `${TEACHER} Add ${count} NEW German words to the "${theme.name}" theme of a vocabulary app.
Level: ${LEVEL_HINTS[level] || LEVEL_HINTS.B2}. The words must fit the theme.
These words already exist; do NOT suggest them or words derived from the same stem: ${exclude.join(', ')}.`;
}

function promptFor({ theme, level, count, examples, exclude, listed }) {
  return `${taskFor({ theme, level, count, exclude, listed })}

Every word comes with an example sentence in PIECES for the app's grammar engine. The engine builds a present-tense main clause in the order "s v r sep" and also turns it into Perfekt, a dass-clause, nachdem (Plusquamperfekt) and zu + infinitive. So the fields must follow these rules EXACTLY:
- w: dictionary form. Nouns with article ("der Fahrplan"), verbs in the infinitive ("aufräumen", reflexive "sich beeilen"), adjectives/adverbs plain ("pünktlich").
- m: short English meaning. k: "n" noun, "v" verb, "a" adjective/adverb.
- pl: true if the noun in w is plural ("die Eltern", "die Handschuhe"), otherwise empty. Prefer singular nouns.
- sg and sgm: only if pl is true; sg = singular with article ("die Handschuhe" → "der Handschuh"), sgm = English meaning of the singular ("glove"). Leave both empty if German has no singular ("die Eltern").
- s: subject. Empty means "ich". Any other subject starts lower-case ("der Zug", "meine Schwester", "es", "wir").
- v: present-tense verb conjugated for the subject ("ich" → "räume", "der Zug" → "fährt", "wir" → "zahlen").
- r: the rest of the sentence (WITHOUT the verb and the separable prefix). With a reflexive verb and subject "ich", r contains "mich"/"mir". r must NOT contain time expressions such as heute/gestern/morgen/jeden Tag/am Samstag (the sentence is used in both present and past narration).
- sep: the separable prefix if any ("auf", "an" ...), otherwise empty.
- The word itself must appear in the sentence (verbs via v/pp, nouns/adjectives in s or r).
- pp: Partizip II including the separable prefix ("aufgeräumt", "abgefahren"). aux: the Perfekt auxiliary conjugated for the subject: ich → "habe"/"bin", singular subject → "hat"/"ist", wir/plural → "haben"/"sind". If v is a form of sein/haben (bin/ist/sind/habe/hat/haben), leave pp and aux empty.
- pret: Präteritum for state verbs only ("war", "gab", "kam"); empty for most words.
- inf and ti: fill ONLY if the subject is "ich" and the action is something you can plan. inf = infinitive WITHOUT the separable prefix ("räumen"), ti = English infinitive phrase without "to" ("tidy my room").
- t: English present-tense translation of the sentence, tp: English past-tense translation; both end with a full stop.
- c: 1-3 lower-case English word starts to look for in a translation; each must appear at the START of a word in t (e.g. "I tidy my room." → "tidy", "room").
- p: true if the sentence describes a mishap or negative situation.
Example entries (copy the format exactly):
${examples.map(example => JSON.stringify(example)).join('\n')}
Return JSON only: {"words":[...]} — ${listed ? `at most ${count}` : `exactly ${count}`} words.`;
}

function cleanEntry(raw) {
  const entry = {};
  for (const [key, value] of Object.entries(raw || {})) {
    if (key === 'c') { const stems = (Array.isArray(value) ? value : []).map(s => String(s).trim().toLowerCase()).filter(Boolean); if (stems.length) entry.c = stems; continue; }
    if (key === 'p' || key === 'pl') { if (value) entry[key] = 1; continue; }
    if (typeof value === 'string' && value.trim()) entry[key] = value.trim();
  }
  if (entry.s === 'ich') delete entry.s;
  return entry;
}

export async function expandVocabulary(config, assets, { themeId, level = 'A2', count = 6, existing = [], extraForTheme = [] }) {
  const theme = assets.themes.find(t => t.id === themeId);
  if (!theme) throw new AiError(`Unknown theme: ${themeId}`, 400);
  const taken = new Set(existing.map(lemmaKey));
  const pool = [...theme.words, ...extraForTheme];
  const examples = [...theme.words].sort(() => Math.random() - 0.5).slice(0, 3).map(({ p, level: _, ...rest }) => rest);
  // With a Goethe list installed, A1–B1 words come from it; otherwise the model picks freely.
  const fromList = Boolean(assets.goethe) && level !== 'B2';
  const candidates = fromList ? pickCandidates(assets.goethe, loadTags(assets.tagsPath), { themeId, level, taken, count: count + 2 }) : [];
  if (fromList && !candidates.length) return { words: [], rejected: [], exhausted: true, _meta: null };
  const candidateLevel = new Map(candidates.map(entry => [lemmaKey(entry.w), entry.level]));
  const others = existing.filter(w => !pool.some(word => word.w === w)).sort(() => Math.random() - 0.5).slice(0, 250);
  const exclude = [...pool.map(word => word.w), ...others];
  const rejected = [];

  const failedCandidates = (got) => {
    const bad = new Set(rejected.map(r => lemmaKey(r.w)));
    return candidates.filter(entry => !got.has(lemmaKey(entry.w)) && (bad.has(lemmaKey(entry.w)) || got.size < count)).map(entry => entry.w);
  };
  const result = await callModel(config, {
    prompt: promptFor({ theme, level, count: fromList ? count : count + 2, examples, exclude, listed: fromList ? candidates.map(entry => entry.w) : null }),
    schema: vocabSchema(fromList ? 1 : count + 2),
    temperature: fromList ? 0.6 : 0.9,
    validate: (data, model) => {
      const accepted = [];
      for (const raw of Array.isArray(data.words) ? data.words : []) {
        const entry = cleanEntry(raw);
        const key = lemmaKey(entry.w);
        const problems = !key ? ['w is empty']
          : taken.has(key) || accepted.some(a => lemmaKey(a.w) === key) ? ['already in the pool']
          : fromList && !candidateLevel.has(key) ? ['not one of the requested list words']
          : assets.Validate.validateEntry(entry, assets.Engine);
        if (problems.length) rejected.push({ w: entry.w || '?', problems });
        else if (accepted.length < count) accepted.push(entry);
      }
      if (!accepted.length) throw new AiError(`${model}: no valid new words (${rejected.slice(-3).map(r => `${r.w}: ${r.problems[0]}`).join('; ') || 'empty response'})`, 422, true);
      return { words: accepted };
    }
  }).catch(error => {
    if (fromList && error.status === 502 && rejected.length) recordFailures(failedCandidates(new Set()), assets.tagsPath);
    throw error;
  });
  const stamp = new Date().toISOString();
  result.words = result.words.map(word => ({ ...word, src: 'ai', level: candidateLevel.get(lemmaKey(word.w)) || assets.levels.listLevel(word.w) || level, addedAt: stamp }));
  if (fromList) recordFailures(failedCandidates(new Set(result.words.map(word => lemmaKey(word.w)))), assets.tagsPath);
  result.rejected = rejected;
  return result;
}
