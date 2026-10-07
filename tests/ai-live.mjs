// Live AI check (uses your API quota): lesson variety, word usage, level fit and translation review.
// Usage: npm run test:ai [-- --same 3] [-- --models]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnvFile, getConfig, runAi, listModels, findEnglish } from '../server/ai.mjs';
import { projectRoot, loadThemes, SessionLib, Engine, seeded, report, heading, summary, pct, sentences, normalizeSentence, ngrams, jaccard, containsWord } from './lib.mjs';

loadEnvFile(projectRoot);
const config = getConfig();
const argValue = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? Number(process.argv[i + 1]) : fallback; };
const SAME = argValue('same', 3);

if (!config.configured) {
  console.error('AI is not configured. Copy .env.example to .env and set GEMINI_API_KEY=...');
  process.exit(2);
}
const modelsOnly = process.argv.includes('--models');
if (modelsOnly) {
  const models = await listModels(config);
  console.log(`generateContent models available to this key (${models.length}):\n` + models.map(m => `  ${m}${m === config.model ? '   <- selected' : ''}`).join('\n'));
}
if (!modelsOnly) {

const grammarFocus = {
  A1: 'Present tense, short main clauses, dann / und.',
  A2: 'Perfekt, zuerst / danach, dass clauses.',
  B1: 'nachdem / obwohl / weil clauses, zu + infinitive, Plusquamperfekt.',
  B2: 'Konjunktiv II (hätte … gehabt), da / obwohl, nominal and evaluative phrasing.'
};
const themes = loadThemes();
function sessionWords(seed) {
  const progress = SessionLib.emptyProgress();
  const session = SessionLib.create({ themes, getProgress: () => progress, random: seeded(seed) });
  return session.pickSessionWords();
}
function lessonInput(level, pick, avoidWords = []) {
  return {
    action: 'generate_lesson', level, grammarFocus: grammarFocus[level], theme: pick.theme.name,
    words: pick.words.map(word => ({ de: word.w, en: word.m, example: Engine.example(word).de })),
    avoidWords
  };
}

console.log(`Provider: ${config.provider} · model: ${config.model}`);
const log = { at: new Date().toISOString(), provider: config.provider, model: config.model, calls: [] };
let tokens = 0;

const DELAY = argValue('delay', config.provider === 'gemini' ? 13000 : 0);
let lastCall = 0;
async function generate(label, input, recentLessons = []) {
  const wait = lastCall + DELAY - Date.now();
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  lastCall = Date.now();
  try {
    const result = await runAi(config, input, { recentLessons });
    const meta = result._meta;
    tokens += meta.usage?.total || 0;
    log.calls.push({ label, ok: true, input, result });
    console.log(`  · ${label}: ${meta.model}, ${(meta.ms / 1000).toFixed(1)} s, ${meta.usage?.total ?? '?'} tokens (thinking ${meta.usage?.thinking ?? 0})${meta.variation ? ', scene: ' + Object.values(meta.variation).join(' / ') : ''}`);
    if (meta.recovered) report('WARN', `${label}: fell back to another model`, meta.recovered.join(' | '));
    return result;
  } catch (error) {
    log.calls.push({ label, ok: false, input, error: error.message });
    report('FAIL', `${label}: AI call failed`, error.message);
    return null;
  }
}

function checkLesson(label, input, result) {
  const q = result.questions;
  const orderOk = q.length === 5 && q.every((item, i) => item.de === input.words[i].de);
  report(orderOk ? 'PASS' : 'FAIL', `${label}: 5 questions, exactly the requested words`, orderOk ? '' : q.map(x => x.de).join(', '));
  const badOptions = q.filter(item => {
    const wrong = (item.wrong || []).map(w => w.trim().toLowerCase());
    return !item.en || wrong.length !== 3 || new Set(wrong).size !== 3 || wrong.includes(item.en.trim().toLowerCase());
  });
  report(badOptions.length ? 'FAIL' : 'PASS', `${label}: each question has 1 right + 3 different distractors`, badOptions.map(x => x.de).join(', '));
  const missing = input.words.filter(word => !containsWord(result.lesson.de, word.de)).map(word => word.de);
  report(missing.length === 0 ? 'PASS' : missing.length <= 1 ? 'WARN' : 'FAIL', `${label}: the text uses all 5 words`,
    missing.length ? `not found (fuzzy match, may miss irregular verbs): ${missing.join(', ')}` : '');
  const english = findEnglish(result.lesson.de);
  report(english.length ? 'FAIL' : 'PASS', `${label}: no English in the German text`, english.join(', '));
  const count = sentences(result.lesson.de).length;
  report(count >= 5 && count <= 8 ? 'PASS' : 'WARN', `${label}: text length 5-7 sentences`, `${count} sentences`);
  const avoidHits = (input.avoidWords || []).filter(de => containsWord(result.lesson.de, de));
  if (input.avoidWords?.length) report(avoidHits.length ? 'WARN' : 'PASS', `${label}: avoided (recently seen) words are not used`, avoidHits.join(', '));
  report((result.lesson.checks || []).length >= 5 ? 'PASS' : 'WARN', `${label}: translation checks present`, `${(result.lesson.checks || []).length} items`);
}

heading(`1) Same 5 words × ${SAME} lessons (A2) — is the text different every time?`);
const fixed = sessionWords(42);
console.log(`  Words (${fixed.theme.name}): ${fixed.words.map(w => w.w).join(', ')}`);
const same = [];
for (let i = 0; i < SAME; i++) {
  const result = await generate(`A2 #${i + 1}`, lessonInput('A2', fixed), same.map(r => r.lesson.de));
  if (result) same.push(result);
}
same.forEach((result, i) => checkLesson(`A2 #${i + 1}`, lessonInput('A2', fixed), result));
if (same.length >= 2) {
  const allSentences = same.map(r => sentences(r.lesson.de).map(normalizeSentence));
  const dupes = [];
  for (let a = 0; a < allSentences.length; a++) for (let b = a + 1; b < allSentences.length; b++) {
    allSentences[a].forEach(s => { if (s.split(' ').length >= 4 && allSentences[b].includes(s)) dupes.push(`#${a + 1}/#${b + 1}: "${s}"`); });
  }
  report(dupes.length === 0 ? 'PASS' : 'FAIL', 'No identical sentences between lessons', dupes.slice(0, 3).join(' | '));
  const openings = new Set(allSentences.map(list => list[0]));
  report(openings.size === same.length ? 'PASS' : 'FAIL', 'Every lesson opens differently', `${openings.size}/${same.length} different`);
  const sims = [];
  for (let a = 0; a < same.length; a++) for (let b = a + 1; b < same.length; b++) sims.push(jaccard(ngrams(same[a].lesson.de), ngrams(same[b].lesson.de)));
  const maxSim = Math.max(...sims);
  report(maxSim < 0.15 ? 'PASS' : maxSim < 0.3 ? 'WARN' : 'FAIL', 'Low similarity between texts (3-word overlap)', `highest ${pct(maxSim)}, mean ${pct(sims.reduce((x, y) => x + y, 0) / sims.length)}`);
  const enSame = new Set(same.map(r => normalizeSentence(r.lesson.en))).size;
  report(enSame === same.length ? 'PASS' : 'FAIL', 'Reference English translations differ too', `${enSame}/${same.length}`);
  const distractorSets = fixed.words.map((word, i) => new Set(same.map(r => (r.questions[i]?.wrong || []).slice().sort().join('|'))).size);
  report('INFO', 'Do distractors change between lessons', distractorSets.map((n, i) => `${fixed.words[i].w}: ${n}/${same.length}`).join(', '));
}

heading('2) Different words and levels (A1, B2)');
const avoid = sessionWords(7).words.map(w => w.w);
const levelRuns = [];
for (const [level, seed] of [['A1', 11], ['B2', 23]]) {
  const pick = sessionWords(seed);
  const input = { ...lessonInput(level, pick, avoid), ...(level === 'A1' ? { focus: ['separable', 'article-case'] } : {}) };
  const result = await generate(`${level} (${pick.theme.name})${input.focus ? ' · focus: ' + input.focus.join(', ') : ''}`, input);
  if (result) { checkLesson(level, input, result); levelRuns.push({ level, result }); }
}
const b2 = levelRuns.find(r => r.level === 'B2');
if (b2) {
  const markers = ['hätte', 'wäre', 'würde', 'könnte', 'obwohl', 'da ', 'nachdem', 'wurde', 'worden'].filter(m => b2.result.lesson.de.toLowerCase().includes(m));
  report(markers.length >= 2 ? 'PASS' : 'WARN', 'The B2 text uses advanced grammar', markers.join(', ') || 'none found');
}
const a1 = levelRuns.find(r => r.level === 'A1');
if (a1) {
  const heavy = ['hätte', 'wäre', 'würde', 'nachdem', 'obwohl', 'worden'].filter(m => a1.result.lesson.de.toLowerCase().includes(m));
  report(heavy.length === 0 ? 'PASS' : 'WARN', 'The A1 text stays simple (no Konjunktiv II / nachdem / obwohl)', heavy.join(', '));
}

heading('3) Translation review');
if (same[0]) {
  const reviewInput = { action: 'review_translation', level: 'A2', sourceText: same[0].lesson.de, referenceTranslation: same[0].lesson.en, studentTranslation: sentences(same[0].lesson.en).slice(0, 2).join(' ') };
  const review = await generate('Review (only the first 2 sentences translated)', reviewInput);
  if (review) {
    const score = Number(String(review.score).split('/')[0]);
    report(/^\d+(\.\d+)?\/10$/.test(String(review.score).trim()) ? 'PASS' : 'WARN', 'Score has the form "x/10"', review.score);
    report(score <= 6 ? 'PASS' : 'WARN', 'An incomplete translation scores low', `${review.score} — ${review.evaluation}`);
    report(review.corrections.length ? 'PASS' : 'WARN', 'Concrete corrections are given', `${review.corrections.length} items`);
    report(Array.isArray(review.weakPoints) ? 'PASS' : 'FAIL', 'Mistakes come back with topic tags (weakPoints)', (review.weakPoints || []).map(item => `${item.topic}: ${item.example}`).join(' | ') || 'empty');
  }
}

heading('Generated texts');
[...same.map((r, i) => [`A2 #${i + 1}`, r]), ...levelRuns.map(r => [r.level, r.result])].forEach(([label, r]) => console.log(`\n[${label}]\n${r.lesson.de}\n→ ${r.lesson.en}`));
const dir = join(projectRoot, 'data', 'reports');
mkdirSync(dir, { recursive: true });
const file = join(dir, `ai-check-${log.at.replace(/[:.]/g, '-')}.json`);
log.results = summary();
log.totalTokens = tokens;
writeFileSync(file, JSON.stringify(log, null, 2));
console.log(`Total tokens: ${tokens} · Full report: data/reports/${file.split(/[\\/]/).pop()}`);
}
