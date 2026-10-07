// CEFR levels: built-in words have enough material per level, sessions never go above the chosen level,
// and (if the optional Goethe list is installed) list candidates are picked correctly.
import { loadThemes, SessionLib, Levels, levelOf, seeded, report, heading, summary } from './lib.mjs';
import { loadGoethe, loadTags, candidateEntries, pickCandidates, untaggedCount } from '../server/goethe.mjs';

const SESSIONS = 300;
const DAY = 24 * 3600 * 1000;
const rank = Levels.rank;
const themes = loadThemes();
const pool = themes.flatMap(theme => theme.words.map(word => ({ ...word, theme: theme.id })));

heading('Levels of the built-in words');
report('INFO', 'Built-in words per level', Levels.LEVELS.map(level => `${level} ${pool.filter(word => word.level === level).length}`).join(' · '));
for (const level of Levels.LEVELS) {
  const count = pool.filter(word => Levels.allows(levelOf(word), level)).length;
  report(count >= 40 ? 'PASS' : 'FAIL', `Enough words to study with ${level} selected`, `${count} words`);
}

heading(`Word selection: ${SESSIONS} simulated sessions per level`);
for (const level of Levels.LEVELS) {
  const random = seeded(11 + rank(level));
  let progress = SessionLib.emptyProgress();
  let clock = Date.UTC(2026, 0, 1);
  const getProgress = () => (progress = SessionLib.normalizeProgress(progress));
  const session = SessionLib.create({ themes: loadThemes(), getProgress, random, now: () => clock, levelOf });
  const above = [];
  let sameLevel = 0, total = 0, short = 0;
  for (let s = 0; s < SESSIONS; s++) {
    clock += DAY / 2;
    const { theme, words } = session.pickSessionWords(level);
    if (words.length !== 5) short++;
    words.forEach(word => {
      total++;
      if (word.level === level) sameLevel++;
      if (rank(levelOf(word)) > rank(level)) above.push(`${word.w} (${word.level})`);
    });
    session.rememberSession(words.map(word => word.w), theme.id);
    words.forEach(word => session.bumpWord(word.w, random() < 0.6 ? 0.22 : -0.38, {}));
  }
  report(above.length ? 'FAIL' : 'PASS', `${level}: no words above the level`, above.length ? [...new Set(above)].slice(0, 10).join(', ') : `${total} words`);
  report(short ? 'FAIL' : 'PASS', `${level}: every session has 5 words`, short ? `${short} short sessions` : '');
  report('INFO', `${level}: share of words at exactly this level`, `${Math.round(100 * sameLevel / total)}%`);
}

const goethe = loadGoethe();
if (!goethe) {
  heading('Goethe word list');
  report('INFO', 'Optional Goethe list not installed (data/goethe/wordlist.json); list checks skipped', 'see docs/GOETHE.md');
} else {
  const info = Levels.create(goethe);
  heading('Goethe word list');
  const sizes = Levels.LISTED.map(level => `${level} ${goethe.levels[level].length}`).join(' · ');
  const enough = goethe.levels.A1.length > 500 && goethe.levels.A2.length > 400 && goethe.levels.B1.length > 1200;
  report(enough ? 'PASS' : 'FAIL', 'Lists loaded (each word only at its first level)', sizes);
  const samples = { 'gehen': 'A1', 'der Bahnhof': 'A1', 'die Ärztin': 'A1', 'spazieren gehen': 'A2', 'aufräumen': 'A2', 'die Behörde': 'B1', 'sich beschweren': 'A2', 'die Bescheinigung': null };
  const wrong = Object.entries(samples).filter(([w, level]) => info.listLevel(w) !== level).map(([w, level]) => `${w}: ${info.listLevel(w)} (expected ${level})`);
  report(wrong.length ? 'FAIL' : 'PASS', 'Sample words get the right level', wrong.join(', '));

  heading('New words from the Goethe list (candidate selection)');
  const tags = loadTags();
  const left = untaggedCount(goethe, tags);
  report(left ? 'WARN' : 'PASS', 'Theme tags for list words', left ? `${left} words untagged — npm run goethe:tags` : `${candidateEntries(goethe).length} words tagged`);
  const taken = new Set(pool.map(word => Levels.lemmaKey(word.w)));
  const candidateProblems = [];
  const perTheme = [];
  for (const level of ['A1', 'A2', 'B1']) {
    for (const theme of themes) {
      const picked = pickCandidates(goethe, tags, { themeId: theme.id, level, taken, count: 8, random: seeded(3) });
      if (level === 'A1') perTheme.push(`${theme.id}:${picked.length}`);
      picked.forEach(entry => {
        if (rank(entry.level) > rank(level)) candidateProblems.push(`${entry.w} ${entry.level} > ${level}`);
        if (!(tags.words[entry.w] || []).includes(theme.id)) candidateProblems.push(`${entry.w} not tagged ${theme.id}`);
        if (taken.has(Levels.lemmaKey(entry.w))) candidateProblems.push(`${entry.w} already in the pool`);
      });
      if (picked.length && picked.some((entry, i) => i > 0 && entry.level === level && picked[i - 1].level !== level)) candidateProblems.push(`${theme.id}/${level}: own level does not come first`);
    }
  }
  report(candidateProblems.length ? 'FAIL' : 'PASS', 'Candidates stay within the level, fit the theme and are not in the pool yet', candidateProblems.slice(0, 8).join(' | '));
  report('INFO', 'A1 candidates per theme (max 8)', perTheme.join(' '));
}
summary();
