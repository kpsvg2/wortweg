// Live AI check (uses your API quota): generates new words for a few themes and validates them.
// Usage: npm run test:vocab-ai [-- --themes daily:A2,work:B1 --count 6]
import { join } from 'node:path';
import { loadEnvFile, getConfig } from '../server/ai.mjs';
import { loadAssets, expandVocabulary, lemmaKey } from '../server/vocab-expand.mjs';
import { projectRoot, Engine, Validate, report, heading, summary, containsWord } from './lib.mjs';

loadEnvFile(projectRoot);
const config = getConfig();
if (!config.configured) { console.error('AI is not configured (.env).'); process.exit(2); }
const argValue = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : fallback; };
const COUNT = Number(argValue('count', 6));
const targets = argValue('themes', 'daily:A2,work:B1').split(',').map(pair => { const [themeId, level] = pair.split(':'); return { themeId, level: level || 'A2' }; });
const DELAY = config.provider === 'gemini' ? 13000 : 0;

const assets = loadAssets(join(projectRoot, 'app'));
const existing = assets.themes.flatMap(theme => theme.words.map(word => word.w));
const pool = assets.themes.flatMap(theme => theme.words.map(word => ({ ...word, theme: theme.id })));
console.log(`Provider: ${config.provider} · model: ${config.model} · pool: ${existing.length} words`);
let allAdded = [];

for (const [index, { themeId, level }] of targets.entries()) {
  if (index && DELAY) await new Promise(resolve => setTimeout(resolve, DELAY));
  const theme = assets.themes.find(t => t.id === themeId);
  heading(`${theme?.name || themeId} · ${level}: ${COUNT} new words`);
  let result;
  try { result = await expandVocabulary(config, assets, { themeId, level, count: COUNT, existing: [...existing, ...allAdded.map(w => w.w)] }); }
  catch (error) { report('FAIL', 'Word generation failed', error.message); continue; }
  const { words, rejected, _meta: meta } = result;
  if (result.exhausted) { report('WARN', 'No list candidates left for this theme (theme tags may be missing)'); continue; }
  console.log(`  · ${meta.model}, ${(meta.ms / 1000).toFixed(1)} s, ${meta.usage?.total ?? '?'} tokens`);
  if (meta.recovered) report('WARN', 'Fell back to another model / retried', meta.recovered.join(' | '));
  report(words.length >= COUNT ? 'PASS' : words.length >= COUNT / 2 ? 'WARN' : 'FAIL', `New words that passed validation: ${words.length}/${COUNT}`, words.map(w => w.w).join(', '));
  report(rejected.length <= 3 ? 'INFO' : 'WARN', `Rejected suggestions: ${rejected.length}`, rejected.map(r => `${r.w}: ${r.problems.join('; ')}`).join(' | '));

  const keys = new Set(existing.map(lemmaKey));
  const dupes = words.filter(w => keys.has(lemmaKey(w.w)));
  report(dupes.length ? 'FAIL' : 'PASS', 'None of them is already in the pool', dupes.map(w => w.w).join(', '));
  const order = ['A1', 'A2', 'B1', 'B2'];
  const fromList = Boolean(assets.goethe) && level !== 'B2';
  const offLevel = words.filter(w => order.indexOf(w.level) > order.indexOf(level) || (fromList && !assets.levels.listLevel(w.w)));
  report(offLevel.length ? 'FAIL' : 'PASS', fromList ? `All from the Goethe list and at most ${level}` : `Levels at most ${level}`, words.map(w => `${w.w}=${w.level}`).join(', '));
  const invalid = words.filter(w => Validate.validateEntry(w, Engine).length);
  report(invalid.length ? 'FAIL' : 'PASS', 'All pass the same rules as the built-in words', invalid.map(w => w.w).join(', '));

  const f = Engine.form;
  for (const w of words) {
    const e = Engine.normalize(w);
    console.log(`    ${w.w} = ${w.m} [${w.k}${w.p ? ', mishap' : ''}]\n      ${f.presMain(e)} | ${f.pastMain(e)} | dass ${f.pastSub(e)} | nachdem ${f.plusqSub(e)}${e.inf && e.ti && e.s === 'ich' ? ' | ' + f.zuInf(e) : ''}\n      ${w.t} / ${w.tp}`);
  }
  const lessonProblems = [];
  for (const lvl of ['A1', 'A2', 'B1', 'B2']) {
    for (let i = 0; i < 10; i++) {
      const fresh = [...words].sort(() => Math.random() - 0.5).slice(0, 3);
      const mix = fresh.concat(theme.words.slice(i, i + 5 - fresh.length));
      const lesson = Engine.buildLesson(lvl, theme, mix, '');
      const missing = mix.filter(w => !containsWord(lesson.de, w.w, w));
      if (missing.length) lessonProblems.push(`${lvl}: ${missing.map(w => w.w).join(', ')}`);
      if (/undefined|(?<!unter )\bnull\b|NaN/.test(lesson.de + lesson.en)) lessonProblems.push(`${lvl}: broken text`);
    }
  }
  report(lessonProblems.length ? 'FAIL' : 'PASS', '40 offline lessons built with the new words have no problems', [...new Set(lessonProblems)].slice(0, 5).join(' | '));
  const distractorIssues = words.filter(w => { const d = Engine.distractors({ ...w, theme: themeId }, [...pool, ...words.map(x => ({ ...x, theme: themeId }))]); return d.length < 3 || d.includes(w.m); });
  report(distractorIssues.length ? 'WARN' : 'PASS', 'Every new word gets 3 distractors', distractorIssues.map(w => w.w).join(', '));
  allAdded = allAdded.concat(words);
}
summary();
