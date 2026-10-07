// Simulates several learners over hundreds of sessions to check word selection and spacing.
import { loadThemes, SessionLib, seeded, report, heading, summary, pct } from './lib.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? Number(process.argv[i + 1]) : fallback; };
const SESSIONS = arg('sessions', Math.max(200, loadThemes().reduce((n, t) => n + t.words.length, 0)));
const SEED = arg('seed', 7);
const RUNS = arg('runs', 5);
const ABILITY_MIN = arg('ability-min', 0.15);
const ABILITY_MAX = arg('ability-max', 0.9);
const DAY = 24 * 3600 * 1000;

function simulate(seed) {
  const random = seeded(seed);
  const themes = loadThemes();
  let progress = SessionLib.emptyProgress();
  let clock = Date.UTC(2026, 0, 1);
  const getProgress = () => (progress = SessionLib.normalizeProgress(progress));
  const session = SessionLib.create({ themes, getProgress, random, now: () => clock });

  const ability = new Map(session.vocabPool.map(word => [word.w, ABILITY_MIN + random() * (ABILITY_MAX - ABILITY_MIN)]));
  const history = [];
  for (let s = 0; s < SESSIONS; s++) {
    clock += DAY / 2;
    const recentBefore = session.recentWordsSet();
    const statusBefore = new Map(session.vocabPool.map(word => [word.w, session.getWordStatus(word.w)]));
    const { theme, words } = session.pickSessionWords();
    const lemmas = words.map(word => word.w);
    session.rememberSession(lemmas, theme.id);
    const answers = lemmas.map(lemma => random() < ability.get(lemma));
    const statusAfter = new Map();
    lemmas.forEach((lemma, i) => {
      if (answers[i]) session.bumpWord(lemma, 0.22, { correct: true });
      else session.bumpWord(lemma, -0.38, { correct: false });
      ability.set(lemma, Math.min(0.98, ability.get(lemma) + 0.12));
      statusAfter.set(lemma, session.getWordStatus(lemma));
    });
    history.push({ theme: theme.id, lemmas, answers, recentBefore, statusBefore, statusAfter });
  }
  return { history, session, themes, progress: getProgress() };
}

function analyze({ history, session, themes, progress }) {
  const poolSize = session.vocabPool.length;
  const lastSeenAt = new Map();
  const counts = new Map();
  const gaps = [];
  const shortRepeats = { review: 0, other: 0 };
  let withinDup = 0, backToBack = 0, themeRepeatShort = 0, firstPassNew = 0;
  const firstPassSessions = Math.floor(poolSize / 5);
  const themeHistory = [];
  const firstPassKinds = { new: 0, review: 0, reused: 0 };
  const lastStatus = new Map();
  const returnGaps = { unknown: [], learning: [], known: [] };
  let maxReviews = 0, minOthers = 5, multiReviewSessions = 0, clusteredSessions = 0;
  history.forEach((h, s) => {
    if (new Set(h.lemmas).size !== h.lemmas.length) withinDup++;
    if (themeHistory.slice(-1)[0] === h.theme) backToBack++;
    if (themeHistory.slice(-SessionLib.RECENT_THEME_LIMIT).includes(h.theme)) themeRepeatShort++;
    themeHistory.push(h.theme);
    const reviewed = h.lemmas.filter(lemma => h.statusBefore.get(lemma) === 'unknown');
    const others = h.lemmas.filter(lemma => h.statusBefore.get(lemma) !== 'unknown' && !h.recentBefore.has(lemma));
    maxReviews = Math.max(maxReviews, reviewed.length);
    minOthers = Math.min(minOthers, others.length);
    const origins = reviewed.filter(lemma => lastSeenAt.has(lemma)).map(lemma => lastSeenAt.get(lemma));
    if (origins.length >= 2) { multiReviewSessions++; if (new Set(origins).size < origins.length) clusteredSessions++; }
    h.lemmas.forEach(lemma => {
      counts.set(lemma, (counts.get(lemma) || 0) + 1);
      if (lastSeenAt.has(lemma)) {
        const gap = s - lastSeenAt.get(lemma);
        gaps.push(gap);
        returnGaps[lastStatus.get(lemma)]?.push(gap);
        if (gap <= SessionLib.RECENT_SESSION_LIMIT) {
          if (h.statusBefore.get(lemma) === 'unknown') shortRepeats.review++; else shortRepeats.other++;
        }
        if (s < firstPassSessions) firstPassKinds[h.statusBefore.get(lemma) === 'unknown' ? 'review' : 'reused']++;
      } else if (s < firstPassSessions) { firstPassNew++; firstPassKinds.new++; }
      lastSeenAt.set(lemma, s);
      lastStatus.set(lemma, h.statusAfter.get(lemma));
    });
  });
  const median = (list) => { const sorted = [...list].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null; };
  const coverageAt = (n) => new Set(history.slice(0, n).flatMap(h => h.lemmas)).size / poolSize;
  let fullCoverage = null;
  { const seen = new Set(); for (let s = 0; s < history.length; s++) { history[s].lemmas.forEach(l => seen.add(l)); if (seen.size === poolSize) { fullCoverage = s + 1; break; } } }
  const byStatus = { known: [], learning: [], unknown: [] };
  session.vocabPool.forEach(word => { const st = session.getWordStatus(word.w); if (byStatus[st]) byStatus[st].push(counts.get(word.w) || 0); });
  const avg = (list) => list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
  const countValues = session.vocabPool.map(word => counts.get(word.w) || 0);
  const themeCounts = themes.map(theme => history.filter(h => h.theme === theme.id).length);
  return {
    poolSize, sessions: history.length, withinDup, backToBack, themeRepeatShort,
    firstPassNewRatio: firstPassNew / (firstPassSessions * 5), firstPassKinds,
    returnUnknown: median(returnGaps.unknown), returnLearning: median(returnGaps.learning), returnKnown: median(returnGaps.known),
    maxReviews, minOthers, clusteredRatio: multiReviewSessions ? clusteredSessions / multiReviewSessions : 0,
    unknownWithin: returnGaps.unknown.length ? returnGaps.unknown.filter(gap => gap <= SessionLib.MAX_UNKNOWN_GAP).length / returnGaps.unknown.length : 1,
    unknownMaxGap: returnGaps.unknown.length ? Math.max(...returnGaps.unknown) : 0,
    coverageFirstPass: coverageAt(Math.min(firstPassSessions, history.length)), firstPassSessions, fullCoverage,
    minGap: gaps.length ? Math.min(...gaps) : null, medianGap: gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? null,
    shortRepeatRatio: gaps.length ? (shortRepeats.review + shortRepeats.other) / gaps.length : 0, shortRepeats,
    avgKnown: avg(byStatus.known), avgUnknown: avg(byStatus.unknown), avgLearning: avg(byStatus.learning),
    nKnown: byStatus.known.length, nUnknown: byStatus.unknown.length,
    maxCount: Math.max(...countValues), minCount: Math.min(...countValues), neverSeen: countValues.filter(c => c === 0).length,
    themeMin: Math.min(...themeCounts), themeMax: Math.max(...themeCounts),
    savedSessions: progress.recentSessions.length
  };
}

console.log(`Word frequency simulation: ${RUNS} learners × ${SESSIONS} sessions (seed ${SEED}…${SEED + RUNS - 1}), initial chance of knowing a word ${ABILITY_MIN}–${ABILITY_MAX}`);
const runs = Array.from({ length: RUNS }, (_, i) => analyze(simulate(SEED + i)));
const worst = (key, dir = 'max') => runs.reduce((w, r) => (dir === 'max' ? Math.max(w, r[key] ?? -Infinity) : Math.min(w, r[key] ?? Infinity)), dir === 'max' ? -Infinity : Infinity);
const mean = (key) => runs.reduce((s, r) => s + (r[key] ?? 0), 0) / runs.length;
const first = runs[0];
const ALL_THEMES = loadThemes().length;

heading('Within a session');
report(worst('withinDup') === 0 ? 'PASS' : 'FAIL', 'No word appears twice in one session', `${worst('withinDup')} repeats`);

heading('Flow of new words');
const needless = Math.max(...runs.map(r => r.firstPassKinds.reused / Math.max(1, r.firstPassKinds.new + r.firstPassKinds.reused)));
report(needless <= 0.1 ? 'PASS' : needless <= 0.2 ? 'WARN' : 'FAIL', `In the first ${Math.floor(first.poolSize / 5)} sessions, non-review words are new`,
  `needless repeats worst case ${pct(needless)}; ${pct(mean('firstPassNewRatio'))} of all words are new, the rest are reviews of unknown words`);
report('INFO', `Share of the pool seen in the first ${first.firstPassSessions} sessions (pool/5)`, `worst ${pct(worst('coverageFirstPass', 'min'))} (${first.poolSize} words; the remaining slots go to reviews)`);
const fc = runs.map(r => r.fullCoverage);
report(fc.every(Boolean) ? 'PASS' : 'WARN', 'The whole pool is eventually seen', fc.every(Boolean) ? `complete after ${Math.min(...fc)}–${Math.max(...fc)} sessions` : `${worst('neverSeen')} words never appeared in ${SESSIONS} sessions`);

heading('Repeat intervals');
report(worst('minGap', 'min') >= 2 ? 'PASS' : 'WARN', 'A word never comes back in the very next session', `shortest gap ${worst('minGap', 'min')} sessions`);
const otherShort = runs.reduce((s, r) => s + r.shortRepeats.other, 0);
const reviewShort = runs.reduce((s, r) => s + r.shortRepeats.review, 0);
const otherShortRatio = otherShort / Math.max(1, otherShort + reviewShort);
report(otherShortRatio <= 0.05 ? 'PASS' : 'WARN', `Repeats within ${SessionLib.RECENT_SESSION_LIMIT} sessions are only unknown words`,
  `short-gap repeats: unknown ${reviewShort}, other ${otherShort} (${pct(otherShortRatio)}); median gap ${first.medianGap} sessions`);

heading('Frequency by learning status');
const k = first.firstPassKinds;
report('INFO', `Word mix of the first ${Math.floor(first.poolSize / 5)} sessions`, `new ${k.new} · unknown reviews ${k.review} · seen before (not unknown) ${k.reused}`);
report(worst('maxReviews') <= SessionLib.MAX_REVIEWS ? 'PASS' : 'FAIL', `At most ${SessionLib.MAX_REVIEWS} review words per session`, `max ${worst('maxReviews')}`);
report(worst('minOthers', 'min') >= 5 - SessionLib.MAX_REVIEWS ? 'PASS' : 'FAIL', `Every session has at least ${5 - SessionLib.MAX_REVIEWS} words that are neither reviews nor recently seen`, `min ${worst('minOthers', 'min')}`);
report(worst('clusteredRatio') <= 0.05 ? 'PASS' : 'WARN', 'Words missed in the same session do not come back together', `${pct(worst('clusteredRatio'))} of sessions with several reviews have two from the same session`);
const within = worst('unknownWithin', 'min');
report(within >= 0.95 ? 'PASS' : within >= 0.6 ? 'WARN' : 'FAIL', `An unknown word returns within ${SessionLib.MAX_UNKNOWN_GAP} sessions`,
  `worst learner ${pct(within)}; longest gap ${worst('unknownMaxGap')} sessions`);
const ratio = mean('returnKnown') / Math.max(0.01, mean('returnUnknown'));
report(ratio >= 1.5 ? 'PASS' : ratio >= 1.1 ? 'WARN' : 'FAIL', 'Unknown words return sooner than known words',
  `median return: unknown ${mean('returnUnknown').toFixed(1)} sessions, learning ${mean('returnLearning').toFixed(1)}, known ${mean('returnKnown').toFixed(1)} (${ratio.toFixed(2)}× less often)`);
report('INFO', 'Appearances per word', `min ${first.minCount}, max ${first.maxCount} (${SESSIONS} sessions, seed ${SEED})`);

heading('Themes');
report(worst('backToBack') === 0 ? 'PASS' : 'FAIL', 'The same theme never comes twice in a row', `${worst('backToBack')} times`);
report(mean('themeRepeatShort') / SESSIONS <= 0.15 ? 'PASS' : 'WARN', `A theme rarely repeats within ${SessionLib.RECENT_THEME_LIMIT} sessions`, `on average in ${pct(mean('themeRepeatShort') / SESSIONS)} of sessions (${ALL_THEMES} themes)`);
report('INFO', 'Theme distribution', `${first.themeMin}–${first.themeMax} sessions per theme`);

summary();
