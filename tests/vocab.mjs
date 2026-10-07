// Validates every built-in word and builds many offline lessons to catch broken sentences.
import { loadThemes, Engine, Validate, Levels, seeded, report, heading, summary, containsWord } from './lib.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? Number(process.argv[i + 1]) : fallback; };
const LESSONS = arg('lessons', 40);
const themes = loadThemes();
const pool = themes.flatMap(theme => theme.words.map(word => ({ ...word, theme: theme.id, themeName: theme.name })));
const problems = [];
const fail = (word, message) => problems.push(`${word.w ?? '?'} (${word.theme}): ${message}`);

heading(`Word pool: ${themes.length} themes, ${pool.length} words`);
const themeIds = new Set();
themes.forEach(theme => {
  if (themeIds.has(theme.id)) problems.push(`duplicate theme id: ${theme.id}`);
  themeIds.add(theme.id);
  if (!theme.name || theme.pres?.length !== 2 || theme.past?.length !== 2) problems.push(`${theme.id}: name/pres/past missing`);
  if (theme.words.length < 8) problems.push(`${theme.id}: too few words (${theme.words.length})`);
});

const seen = new Map();
for (const word of pool) {
  const key = word.w?.toLowerCase();
  if (seen.has(key)) fail(word, `also in theme ${seen.get(key)}`); else seen.set(key, word.theme);
  if (!Levels.isLevel(word.level)) fail(word, `missing or invalid level: ${word.level}`);
  Validate.validateEntry(word, Engine).forEach(message => fail(word, message));
  const wrong = Engine.distractors(word, pool);
  if (wrong.length < 3 || new Set(wrong).size !== wrong.length || wrong.includes(word.m)) fail(word, `not enough distractors: ${wrong.join(' / ')}`);
}
report(problems.length ? 'FAIL' : 'PASS', 'Every word has valid fields and consistent grammar', problems.length ? `${problems.length} problems:\n    ${problems.slice(0, 40).join('\n    ')}` : `${pool.length} words`);

heading(`Offline engine: ${LESSONS} random lessons per theme × level`);
const lessonProblems = [];
let lessons = 0;
const random = seeded(99);
for (const theme of themes) {
  const words = pool.filter(word => word.theme === theme.id);
  for (const level of Levels.LEVELS) {
    for (let i = 0; i < LESSONS; i++) {
      const pick = [...words].sort(() => random() - 0.5).slice(0, 5);
      const lesson = Engine.buildLesson(level, theme, pick, '');
      lessons++;
      const where = `${theme.id}/${level} [${pick.map(w => w.w).join(', ')}]`;
      const bad = /undefined|(?<!unter )\bnull\b|NaN|\s{2,}|\s[.,]|,,|\.\./.exec(lesson.de + ' ' + lesson.en);
      if (bad) lessonProblems.push(`${where}: broken text ("${bad[0]}")`);
      const lower = [lesson.de, lesson.en].flatMap(text => text.split(/(?<=[.!?])\s+/)).find(sentence => /^[a-zäöü]/.test(sentence));
      if (lower) lessonProblems.push(`${where}: sentence starts lower-case: ${lower}`);
      const missing = pick.filter(word => !containsWord(lesson.de, word.w));
      if (missing.length) lessonProblems.push(`${where}: missing from text: ${missing.map(w => w.w).join(', ')}`);
      if (lesson.checks.length !== 5) lessonProblems.push(`${where}: ${lesson.checks.length} checks`);
    }
  }
}
const uniqueLessonProblems = [...new Set(lessonProblems)];
report(uniqueLessonProblems.length ? 'FAIL' : 'PASS', 'Generated lessons have no broken text and use all 5 words', uniqueLessonProblems.length ? `${uniqueLessonProblems.length} problems:\n    ${uniqueLessonProblems.slice(0, 20).join('\n    ')}` : `${lessons} lessons`);

heading('Distribution');
report('INFO', 'Words per theme', themes.map(theme => `${theme.name}: ${theme.words.length}`).join(' · '));
const byKind = pool.reduce((acc, word) => ({ ...acc, [word.k]: (acc[word.k] || 0) + 1 }), {});
report('INFO', 'Parts of speech', `nouns ${byKind.n || 0} · verbs ${byKind.v || 0} · adjectives/adverbs ${byKind.a || 0}`);
report('INFO', 'Levels', Levels.LEVELS.map(level => `${level} ${pool.filter(word => word.level === level).length}`).join(' · '));
summary();
