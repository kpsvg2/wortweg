// Word selection and progress bookkeeping for a 5-word study session.
(function (root) {
  const RECENT_SESSION_LIMIT = 16;
  const RECENT_THEME_LIMIT = 5;
  const KNOWN_STRENGTH = 0.75;
  const UNKNOWN_STRENGTH = 0.35;
  const MAX_UNKNOWN_GAP = 6;
  const MAX_REVIEWS = 3;
  const MIN_REVIEW_GAP = 3;
  const SAME_LEVEL_BOOST = 1.5;
  const LEVELS = ['A1', 'A2', 'B1', 'B2'];
  const levelAllows = (wordLevel, level) => !level || LEVELS.indexOf(wordLevel) <= LEVELS.indexOf(level);
  const DIRECTIONS = ['de-en', 'en-de'];

  function emptyProgress() { return { words: {}, structuresByLevel: {}, mistakes: {}, artikel: { nouns: {} }, recentSessions: [], recentThemes: [], level: null, lastDirection: null, sessionCount: 0, updatedAt: null }; }
  function clamp(value) { return Math.max(0, Math.min(1, value)); }
  function statusFromStrength(strength) {
    if (strength >= KNOWN_STRENGTH) return 'known';
    if (strength <= UNKNOWN_STRENGTH) return 'unknown';
    return 'learning';
  }
  function normalizeProgress(raw) {
    const progress = emptyProgress();
    if (!raw || typeof raw !== 'object') return progress;
    if (raw.words && typeof raw.words === 'object') progress.words = raw.words;
    if (Array.isArray(raw.recentSessions)) progress.recentSessions = raw.recentSessions.filter(Array.isArray);
    if (Array.isArray(raw.recentThemes)) progress.recentThemes = raw.recentThemes;
    if (raw.structuresByLevel && typeof raw.structuresByLevel === 'object') progress.structuresByLevel = raw.structuresByLevel;
    if (raw.mistakes && typeof raw.mistakes === 'object' && !Array.isArray(raw.mistakes)) progress.mistakes = raw.mistakes;
    if (raw.artikel && typeof raw.artikel === 'object' && raw.artikel.nouns && typeof raw.artikel.nouns === 'object') progress.artikel = raw.artikel;
    if (LEVELS.includes(raw.level)) progress.level = raw.level;
    if (DIRECTIONS.includes(raw.lastDirection)) progress.lastDirection = raw.lastDirection;
    if (Number.isInteger(raw.sessionCount) && raw.sessionCount > 0) progress.sessionCount = raw.sessionCount;
    if (raw.updatedAt) progress.updatedAt = raw.updatedAt;
    if (raw.levels && typeof raw.levels === 'object') {
      Object.entries(raw.levels).forEach(([level, bucket]) => {
        Object.entries(bucket?.words || {}).forEach(([lemma, entry]) => {
          if (!progress.words[lemma] || (entry.lastSeen || 0) > (progress.words[lemma].lastSeen || 0)) progress.words[lemma] = entry;
        });
        if (bucket?.structures) progress.structuresByLevel[level] = { ...(progress.structuresByLevel[level] || {}), ...bucket.structures };
        (bucket?.recentSessions || []).forEach(session => progress.recentSessions.push(session));
      });
    }
    progress.recentSessions = progress.recentSessions.slice(0, RECENT_SESSION_LIMIT);
    progress.recentThemes = progress.recentThemes.slice(0, RECENT_THEME_LIMIT);
    return progress;
  }

  function create({ themes, getProgress, random = Math.random, now = Date.now, levelOf = null }) {
    const vocabPool = themes.flatMap(theme => theme.words.map(word => ({ ...word, theme: theme.id, themeName: theme.name })));
    const vocabByWord = new Map(vocabPool.map(word => [word.w, word]));
    const wordLevel = (word) => (levelOf ? levelOf(word) : 'A1');
    const fits = (word, level) => !level || !levelOf || levelAllows(wordLevel(word), level);

    function shuffled(items) {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
      return copy;
    }
    function structureBucket(level) {
      const progress = getProgress();
      if (!progress.structuresByLevel[level]) progress.structuresByLevel[level] = {};
      return progress.structuresByLevel[level];
    }
    function getWordEntry(lemma) { return getProgress().words[lemma] || null; }
    function getWordStatus(lemma) {
      const entry = getWordEntry(lemma);
      if (!entry) return 'new';
      return entry.status || statusFromStrength(entry.strength ?? 0.4);
    }
    function bumpWord(lemma, delta, extras = {}) {
      const progress = getProgress();
      const entry = progress.words[lemma] || { seen: 0, strength: 0.4, correctStreak: 0 };
      entry.strength = clamp((entry.strength ?? 0.4) + delta);
      entry.seen = (entry.seen || 0) + (extras.seen ?? 0);
      entry.lastSeen = now();
      if (extras.correct === true) entry.correctStreak = (entry.correctStreak || 0) + 1;
      if (extras.correct === false) entry.correctStreak = 0;
      if ((entry.correctStreak || 0) >= 3) entry.strength = clamp(Math.max(entry.strength, KNOWN_STRENGTH));
      entry.status = statusFromStrength(entry.strength);
      progress.words[lemma] = entry;
    }
    function bumpStructure(level, check, delta) {
      const bucket = structureBucket(level);
      const key = check.lemma || (check.words || []).join('|');
      const entry = bucket[key] || { strength: 0.4 };
      entry.strength = clamp((entry.strength ?? 0.4) + delta);
      entry.status = statusFromStrength(entry.strength);
      entry.lemma = check.lemma || null;
      entry.updated = now();
      bucket[key] = entry;
    }
    function recentWordsSet() { return new Set((getProgress().recentSessions || []).flat()); }
    function rememberSession(words, themeId) {
      const progress = getProgress();
      progress.recentSessions = [words, ...(progress.recentSessions || [])].slice(0, RECENT_SESSION_LIMIT);
      if (themeId) progress.recentThemes = [themeId, ...(progress.recentThemes || []).filter(id => id !== themeId)].slice(0, RECENT_THEME_LIMIT);
      progress.sessionCount = (progress.sessionCount || 0) + 1;
      words.forEach(lemma => { bumpWord(lemma, 0, { seen: 1 }); progress.words[lemma].lastSession = progress.sessionCount; });
    }
    function weakWords() {
      return Object.entries(getProgress().words)
        .filter(([lemma, entry]) => vocabByWord.has(lemma) && entry.seen && (entry.status || statusFromStrength(entry.strength ?? 0)) === 'unknown')
        .sort((a, b) => (a[1].strength ?? 0) - (b[1].strength ?? 0))
        .map(([lemma]) => lemma);
    }
    // Favour new/unknown words, avoid ones from recent sessions, prefer the selected level.
    function selectionWeight(lemma, recent, level) {
      const entry = getWordEntry(lemma);
      const status = getWordStatus(lemma);
      let weight = 1.25 - (entry?.strength ?? 0.45);
      if (status === 'known') weight *= 0.15;
      else if (status === 'unknown') weight *= 2.2;
      else if (status === 'learning') weight *= 1.4;
      else weight *= 1.6;
      if (recent.has(lemma)) weight *= 0.03;
      if (level && levelOf && level !== 'A1' && vocabByWord.has(lemma) && wordLevel(vocabByWord.get(lemma)) === level) weight *= SAME_LEVEL_BOOST;
      return Math.max(0.01, weight);
    }
    function weightedPick(items, count, weightOf) {
      const pool = [...items];
      const picked = [];
      while (picked.length < count && pool.length) {
        const weights = pool.map(weightOf);
        let roll = random() * weights.reduce((sum, value) => sum + value, 0);
        let index = 0;
        for (; index < pool.length - 1; index++) { roll -= weights[index]; if (roll <= 0) break; }
        picked.push(pool.splice(index, 1)[0]);
      }
      return picked;
    }
    function chooseTheme(level) {
      const progress = getProgress();
      const recentThemes = progress.recentThemes || [];
      const recent = recentWordsSet();
      return weightedPick(themes, 1, theme => {
        const age = recentThemes.indexOf(theme.id);
        const recency = age === -1 ? 1 : age === 0 ? 0 : 0.04 + age * 0.12;
        const usable = theme.words.filter(word => fits(word, level));
        if (!usable.length) return recency * 0.01;
        const fresh = usable.filter(word => !recent.has(word.w) && getWordStatus(word.w) !== 'known').length;
        return recency * (0.4 + fresh / usable.length) * Math.min(1, usable.length / 5);
      })[0];
    }
    function sessionsSince(lemma) {
      const progress = getProgress();
      const last = getWordEntry(lemma)?.lastSession;
      if (Number.isInteger(last) && progress.sessionCount) return progress.sessionCount - last + 1;
      const index = (progress.recentSessions || []).findIndex(session => session.includes(lemma));
      return index === -1 ? Infinity : index + 1;
    }
    function spreadAcrossSessions(items, count) {
      const groups = [];
      const byGap = new Map();
      items.forEach(item => {
        if (!byGap.has(item.gap)) { byGap.set(item.gap, []); groups.push(byGap.get(item.gap)); }
        byGap.get(item.gap).push(item);
      });
      return groups.slice(0, count).map(group => group[0]);
    }
    function unknownCandidates(minGap, maxGap = Infinity, level = null) {
      return weakWords()
        .filter(lemma => fits(vocabByWord.get(lemma), level))
        .map(lemma => ({ lemma, gap: sessionsSince(lemma), strength: getWordEntry(lemma)?.strength ?? 0 }))
        .filter(item => item.gap >= minGap && item.gap < maxGap)
        .sort((a, b) => b.gap - a.gap || a.strength - b.strength);
    }
    // Up to 3 overdue unknown words (spread over different past sessions), the rest from one theme.
    function pickSessionWords(level = null) {
      const recent = recentWordsSet();
      const weak = new Set(weakWords());
      const theme = chooseTheme(level);
      const reviews = spreadAcrossSessions(unknownCandidates(MIN_REVIEW_GAP, Infinity, level), MAX_REVIEWS);
      const reviewWords = reviews.map(item => vocabByWord.get(item.lemma));
      const reviewSet = new Set(reviewWords.map(word => word.w));
      const need = 5 - reviewWords.length;
      const isOther = (word) => !reviewSet.has(word.w) && !weak.has(word.w) && fits(word, level);
      const themeWords = vocabPool.filter(word => word.theme === theme.id && isOther(word));
      const themeFresh = themeWords.filter(word => !recent.has(word.w));
      const anyFresh = vocabPool.filter(word => isOther(word) && !recent.has(word.w));
      const anyFit = vocabPool.filter(isOther);
      const pool = themeFresh.length >= need ? themeFresh : themeWords.length >= need ? themeWords : anyFresh.length >= need ? anyFresh : anyFit;
      const picked = [...reviewWords, ...weightedPick(pool, need, word => selectionWeight(word.w, recent, level))];
      return { theme, words: shuffled(picked) };
    }
    function nextDirection() {
      return getProgress().lastDirection === 'de-en' ? 'en-de' : 'de-en';
    }

    function addWords(themeId, words) {
      const theme = themes.find(t => t.id === themeId);
      if (!theme || !Array.isArray(words)) return 0;
      let added = 0;
      for (const word of words) {
        if (!word || !word.w || vocabByWord.has(word.w)) continue;
        theme.words.push(word);
        const entry = { ...word, theme: theme.id, themeName: theme.name };
        vocabPool.push(entry);
        vocabByWord.set(word.w, entry);
        added++;
      }
      return added;
    }
    function unseenCount(themeId, level = null) {
      return vocabPool.filter(word => word.theme === themeId && fits(word, level) && !(getWordEntry(word.w)?.seen)).length;
    }
    function levelCount(level) {
      return vocabPool.filter(word => fits(word, level)).length;
    }

    return { vocabPool, vocabByWord, shuffled, addWords, unseenCount, levelCount, getWordEntry, getWordStatus, bumpWord, bumpStructure, recentWordsSet, rememberSession, weakWords, pickSessionWords, sessionsSince, nextDirection };
  }

  const api = { create, emptyProgress, normalizeProgress, statusFromStrength, RECENT_SESSION_LIMIT, RECENT_THEME_LIMIT, KNOWN_STRENGTH, UNKNOWN_STRENGTH, MAX_UNKNOWN_GAP, MAX_REVIEWS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WortwegSession = api;
})(typeof window !== 'undefined' ? window : globalThis);
