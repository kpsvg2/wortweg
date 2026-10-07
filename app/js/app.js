// Wortweg UI: welcome screen, word quiz, translation step, review, and the article modes.
const VOCAB = window.WORTWEG_VOCAB || { themes: [] };
const Engine = window.WortwegEngine;
const SessionLib = window.WortwegSession;
const Validate = window.WortwegValidate;
const Mistakes = window.WortwegMistakes;
const Articles = window.WortwegArticles;
const LEVELS = ['A1', 'A2', 'B1', 'B2'];
const grammarFocus = {
  A1: 'Present tense, short main clauses, dann / und.',
  A2: 'Perfekt, zuerst / danach, dass clauses.',
  B1: 'nachdem / obwohl / weil clauses, zu + infinitive, Plusquamperfekt.',
  B2: 'Konjunktiv II (hätte … gehabt), da / obwohl, nominal and evaluative phrasing.'
};
const labels = { A1: 'Beginner', A2: 'Elementary', B1: 'Intermediate', B2: 'Upper intermediate' };
const state = { level: null, index: 0, correct: 0, answered: false, answers: [], words: [], questions: [], lesson: null, focus: [], artikelNouns: [], profile: null, theme: null, source: null, direction: 'de-en', prefetch: null };
const $ = (id) => document.getElementById(id);
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const LOCAL_KEY = 'wortweg-progress-v3';
const THEME_KEY = 'wortweg-theme';
const MODE_KEY = 'wortweg-mode';
const { emptyProgress, normalizeProgress, statusFromStrength } = SessionLib;
const levelOf = (word) => (LEVELS.includes(word?.level) ? word.level : 'B2');

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('theme-toggle').textContent = theme === 'dark' ? '☀' : '☾';
  $('theme-toggle').title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#0f141c' : '#275df5';
}
function setupTheme() {
  applyTheme(document.documentElement.dataset.theme || 'light');
  $('theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, next); } catch (error) {}
    applyTheme(next);
  });
  // Follow the OS setting until the user picks a theme explicitly.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
    let stored = null;
    try { stored = localStorage.getItem(THEME_KEY); } catch (error) {}
    if (!stored) applyTheme(event.matches ? 'dark' : 'light');
  });
}

function progressData() {
  if (!state.profile) state.profile = { id: 'local-memory', path: null, progress: emptyProgress() };
  state.profile.progress = normalizeProgress(state.profile.progress);
  return state.profile.progress;
}
const Session = SessionLib.create({ themes: VOCAB.themes, getProgress: progressData, levelOf });
const { vocabPool, shuffled, bumpWord, bumpStructure, recentWordsSet, rememberSession, pickSessionWords } = Session;
function toQuestion(word) {
  return { de: word.w, en: word.m, wrong: Engine.distractors(word, vocabPool), example: Engine.example(word), theme: word.themeName };
}

// When a theme runs low on unseen words at the current level, ask the server for more.
const EXPAND_BELOW = 12;
const EXPAND_COUNT = 6;
const expandingThemes = new Set();
const exhaustedThemes = new Set();
async function loadExtraVocab() {
  if (!state.profile?.path) return;
  try {
    const data = await (await fetch('/api/vocab', { cache: 'no-store' })).json();
    Object.entries(data.themes || {}).forEach(([themeId, words]) => { Session.addWords(themeId, words); });
  } catch (error) {}
}
async function maybeExpandVocab(theme) {
  const level = state.level;
  if (!window.WORTWEG_AI_ENDPOINT || !state.profile?.path || expandingThemes.has(theme.id) || exhaustedThemes.has(`${theme.id}:${level}`)) return;
  if (Session.unseenCount(theme.id, level) >= EXPAND_BELOW) return;
  expandingThemes.add(theme.id);
  try {
    const response = await fetch('/api/vocab/expand', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ themeId: theme.id, level, count: EXPAND_COUNT }) });
    const data = await response.json();
    if (response.ok) Session.addWords(theme.id, data.words);
    if (response.ok && data.exhausted) exhaustedThemes.add(`${theme.id}:${level}`);
  } catch (error) {}
  finally { expandingThemes.delete(theme.id); }
}

// Progress lives on the local server; without it (static hosting) it falls back to localStorage.
async function loadProfile() {
  try {
    const response = await fetch('/api/profile');
    if (!response.ok) throw new Error('Could not load profile');
    const data = await response.json();
    state.profile = { id: data.id, path: data.path, progress: normalizeProgress(data.progress) };
  } catch (error) {
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null'); } catch (storageError) { stored = null; }
    state.profile = { id: 'browser', path: null, progress: normalizeProgress(stored) };
  }
}
async function saveProfile() {
  if (!state.profile) return;
  state.profile.progress = normalizeProgress(state.profile.progress);
  state.profile.progress.updatedAt = new Date().toISOString();
  if (!state.profile.path) {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(state.profile.progress)); } catch (error) {}
    return;
  }
  try {
    await fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ progress: state.profile.progress }) });
  } catch (error) {}
}

function applySessionLearning(text) {
  state.questions.forEach((question, index) => {
    if (state.answers[index]) bumpWord(question.de, 0.22, { correct: true });
    else bumpWord(question.de, -0.38, { correct: false });
  });
  if (state.direction !== 'de-en') return;
  (state.lesson?.checks || []).forEach(check => {
    const hit = text && text.length >= 12 && Engine.mentions(text, check.words || []);
    bumpStructure(state.level, check, hit ? 0.2 : -0.28);
  });
}
function profileSummaryNote() {
  const words = Object.values(progressData().words);
  const unknown = words.filter(entry => (entry.status || statusFromStrength(entry.strength ?? 0)) === 'unknown').length;
  const known = words.filter(entry => (entry.status || statusFromStrength(entry.strength ?? 0)) === 'known').length;
  const seen = words.filter(entry => entry.seen).length;
  const where = state.profile?.path ? `Profile: ${state.profile.path} (delete the folder to reset).` : 'Progress is stored in this browser.';
  return `So far you have seen ${seen}/${vocabPool.length} words · ${known} known · ${unknown} to review. ${where}`;
}

// Read-aloud with the best available German voice; hidden entirely if there is none.
const Speech = (() => {
  const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
  const RATE_KEY = 'wortweg-speech-rate';
  const MIN_RATE = 0.6;
  const MAX_RATE = 1;
  let voice = null;
  let active = null;
  let rate = 0.9;
  function setRate(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    rate = Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(number * 20) / 20));
    const label = `${rate.toFixed(2).replace(/0$/, '')}×`;
    document.querySelectorAll('.speech-rate').forEach(input => { input.value = String(rate); });
    document.querySelectorAll('.speech-rate-value').forEach(output => { output.textContent = label; });
  }
  function pickVoice() {
    const german = synth.getVoices().filter(item => /^de([-_]|$)/i.test(item.lang));
    voice = german.find(item => /natural/i.test(item.name) && /de-DE/i.test(item.lang))
      || german.find(item => /google/i.test(item.name))
      || german.find(item => /de-DE/i.test(item.lang))
      || german[0] || null;
    document.body.classList.toggle('no-german-voice', !voice);
  }
  function setActive(button) {
    if (active) active.classList.remove('speaking');
    active = button || null;
    if (active) active.classList.add('speaking');
  }
  // Clicking the same button again stops playback; texts are spoken sentence by sentence.
  function speak(text, button) {
    if (!synth || !text) return;
    const again = active === button && synth.speaking;
    synth.cancel();
    setActive(null);
    if (again) return;
    if (!voice) pickVoice();
    if (!voice) return;
    const parts = String(text).split(/(?<=[.!?])\s+/).map(part => part.trim()).filter(Boolean);
    setActive(button);
    parts.forEach((part, index) => {
      const utterance = new SpeechSynthesisUtterance(part);
      utterance.lang = 'de-DE';
      utterance.voice = voice;
      utterance.rate = rate;
      if (index === parts.length - 1) { utterance.onend = () => { if (active === button) setActive(null); }; utterance.onerror = utterance.onend; }
      synth.speak(utterance);
    });
  }
  function stop() { if (synth) synth.cancel(); setActive(null); }
  function setup() {
    if (!synth) { document.body.classList.add('no-speech'); return; }
    let stored = null;
    try { stored = localStorage.getItem(RATE_KEY); } catch (error) {}
    setRate(stored ?? rate);
    document.querySelectorAll('.speech-rate').forEach(input => input.addEventListener('input', (event) => {
      setRate(event.target.value);
      try { localStorage.setItem(RATE_KEY, String(rate)); } catch (error) {}
    }));
    pickVoice();
    synth.addEventListener?.('voiceschanged', pickVoice);
  }
  return { speak, stop, setup };
})();

// Articles mode (known nouns, saved) and Guess mode (whole pool, not saved) share one screen.
const articles = { deck: null, lemma: null, answered: false, right: 0, wrong: 0, ready: false, guess: false };
function syncArticles() {
  return Articles.syncKnown(progressData(), Session.vocabByWord, Session.getWordStatus);
}
function renderArticlesHome() {
  if (!articles.ready) return;
  const count = Articles.deckWords(progressData(), Session.vocabByWord).length;
  $('articles-start').disabled = !count;
  $('articles-status').textContent = count
    ? `${count} nouns in your list.`
    : 'No known nouns yet. Once you get a noun right a few times in Normal mode, it is added here.';
}
function setMode(mode, { remember = true } = {}) {
  if (mode !== 'articles' && mode !== 'guess') mode = 'normal';
  document.querySelectorAll('#mode-switch button').forEach(button => {
    const on = button.dataset.mode === mode;
    button.classList.toggle('on', on);
    button.setAttribute('aria-selected', String(on));
  });
  $('normal-home').hidden = mode !== 'normal';
  $('articles-home').hidden = mode !== 'articles';
  $('guess-home').hidden = mode !== 'guess';
  if (mode === 'articles') renderArticlesHome();
  if (mode === 'guess') $('guess-status').textContent = `${guessWords().length} nouns in the pool.`;
  if (remember) { try { localStorage.setItem(MODE_KEY, mode); } catch (error) {} }
}
function setupModes() {
  document.querySelectorAll('#mode-switch button').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
  let stored = null;
  try { stored = localStorage.getItem(MODE_KEY); } catch (error) {}
  setMode(stored, { remember: false });
}
function startArticles() {
  syncArticles();
  const words = Articles.deckWords(progressData(), Session.vocabByWord);
  if (!words.length) { renderArticlesHome(); return; }
  Object.assign(articles, { guess: false, deck: Articles.createDeck(words, Math.random, { isWeak: lemma => Articles.isWeak(progressData(), lemma) }), right: 0, wrong: 0 });
  show('articles');
  nextArticle();
}
function guessWords() {
  return [...Session.vocabByWord.keys()].filter(lemma => {
    const form = Articles.questionForm(Session.vocabByWord.get(lemma));
    return form && !form.pluralOnly;
  });
}
function startGuess() {
  Object.assign(articles, { guess: true, deck: Articles.createDeck(guessWords()), right: 0, wrong: 0 });
  show('articles');
  nextArticle();
}
function renderArticlesScore() {
  $('articles-count').textContent = `${articles.guess ? 'GUESS' : 'ARTICLES'} · ${articles.right} RIGHT · ${articles.wrong} WRONG`;
}
function nextArticle() {
  Speech.stop();
  articles.lemma = articles.deck.next();
  articles.answered = false;
  const form = Articles.questionForm(Session.vocabByWord.get(articles.lemma));
  $('articles-word').textContent = form.noun;
  $('articles-meaning').textContent = articles.guess ? '' : form.m;
  $('articles-options').innerHTML = Articles.ARTICLES.map(article => `<button class="option" type="button" data-answer="${article}">${article}</button>`).join('');
  $('articles-options').querySelectorAll('.option').forEach(button => button.addEventListener('click', () => answerArticle(button)));
  $('articles-dont-know').disabled = false; $('articles-dont-know').classList.remove('chosen');
  $('articles-feedback').hidden = true; $('articles-next').hidden = true;
  renderArticlesScore();
}
function answerArticle(button) {
  if (articles.answered) return;
  articles.answered = true;
  const form = Articles.questionForm(Session.vocabByWord.get(articles.lemma));
  const { article } = form;
  const skipped = button === $('articles-dont-know');
  const isCorrect = !skipped && button.dataset.answer === article;
  if (isCorrect) articles.right++; else articles.wrong++;
  if (!articles.guess) {
    Articles.record(progressData(), articles.lemma, skipped ? 'skip' : isCorrect ? 'right' : 'wrong');
    if (!isCorrect) articles.deck.requeue(articles.lemma);
  }
  $('articles-dont-know').disabled = true;
  $('articles-options').querySelectorAll('.option').forEach(option => {
    option.disabled = true;
    if (option.dataset.answer === article) option.classList.add('correct');
  });
  if (skipped) button.classList.add('chosen');
  else if (!isCorrect) button.classList.add('wrong');
  $('articles-feedback').hidden = false;
  $('articles-feedback').innerHTML = `${isCorrect ? 'Correct!' : 'Answer:'} <b lang="de">${escapeHtml(form.w)}</b> — ${escapeHtml(form.m)}${form.pluralOnly ? '<br><small>This noun is only used in the plural; plural nouns always take “die”.</small>' : ''}${articles.guess ? `<br><small>${escapeHtml(Articles.ruleNote(form.noun, article))}</small>` : ''}`;
  $('articles-next').hidden = false;
  renderArticlesScore();
  if (!articles.guess) saveProfile();
}

function show(id) { Speech.stop(); document.querySelectorAll('.view').forEach(x => x.classList.remove('active')); $(id).classList.add('active'); }
let prefetchTimer = null;
function selectLevel(level, { remember = true } = {}) {
  if (!labels[level]) return;
  state.level = level;
  document.querySelectorAll('.level').forEach(x => x.classList.toggle('selected', x.dataset.level === level));
  $('start').disabled = false;
  if (remember && progressData().level !== level) { progressData().level = level; saveProfile(); }
  renderPoolStatus();
  clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(() => prefetch(level), 700);
}
function setupLevels() {
  $('levels').innerHTML = Object.entries(labels).map(([level, label]) => `<button class="level" data-level="${level}"><b>${level}</b><span>${label}</span></button>`).join('');
  document.querySelectorAll('.level').forEach(button => button.addEventListener('click', () => selectLevel(button.dataset.level)));
}
function renderPoolStatus() {
  const seen = Object.values(progressData().words).filter(entry => entry.seen).length;
  const atLevel = state.level ? ` ${Session.levelCount(state.level)} of them are up to ${state.level}.` : '';
  $('pool-status').textContent = `Word pool ready: ${VOCAB.themes.length} themes, ${vocabPool.length} words.${atLevel} You have seen ${seen} so far.`;
}
function isLesson(value) {
  return value && Array.isArray(value.questions) && value.questions.length >= 5 && value.lesson && value.lesson.de && value.lesson.en;
}

// A session always has an offline version; the AI version replaces it when it arrives in time and is valid.
async function buildSession(level) {
  await vocabReady;
  const { theme, words } = pickSessionWords(level);
  const focus = Mistakes.focusTopics(progressData(), level);
  const recent = recentWordsSet();
  const artikelNouns = Articles.weakNouns(progressData(), Session.vocabByWord, 2, new Set([...recent, ...words.map(word => word.w)]))
    .map(lemma => Articles.questionForm(Session.vocabByWord.get(lemma)));
  const session = {
    level, theme, words, focus: [], artikelNouns: [],
    questions: words.map(toQuestion),
    lesson: Engine.buildLesson(level, theme, words, grammarFocus[level]),
    source: { kind: 'offline', detail: 'AI not connected; using the offline template.' },
    createdAt: Date.now()
  };
  const endpoint = window.WORTWEG_AI_ENDPOINT;
  if (!endpoint) return session;
  try {
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'generate_lesson',
        level,
        grammarFocus: grammarFocus[level],
        theme: theme.name,
        words: words.map(word => ({ de: word.w, en: word.m, example: Engine.example(word).de })),
        avoidWords: [...recent].slice(0, 60),
        focus,
        artikelNouns: artikelNouns.map(form => ({ de: form.w, en: form.m }))
      })
    });
    const generated = await response.json();
    if (response.ok && isLesson(generated)) {
      const byDe = new Map(generated.questions.map(question => [String(question.de || '').trim(), question]));
      session.questions = session.questions.map(question => {
        const ai = byDe.get(question.de);
        if (!ai || !ai.en || !Array.isArray(ai.wrong) || ai.wrong.length < 3) return question;
        return { ...question, en: ai.en, wrong: ai.wrong.slice(0, 3) };
      });
      session.lesson = { ...generated.lesson, checks: Array.isArray(generated.lesson.checks) && generated.lesson.checks.length ? generated.lesson.checks : session.lesson.checks };
      session.focus = focus;
      session.artikelNouns = artikelNouns.filter(form => Validate.containsWord(session.lesson.de, form.w)).map(form => form.w);
      const meta = generated._meta || {};
      session.source = { kind: 'ai', detail: `Text generated by AI (${meta.model || 'model'}${meta.ms ? ', ' + (meta.ms / 1000).toFixed(1) + ' s' : ''}).` };
    } else {
      session.source = { kind: 'fallback', detail: `AI response unusable (${generated?.error || 'invalid response'}); using the offline template.` };
    }
  } catch (error) {
    session.source = { kind: 'fallback', detail: `Could not reach the AI (${error.message}); using the offline template.` };
  }
  return session;
}
// The next session is prepared in the background so "Start" is instant.
function prefetch(level) {
  if (!level || $('quiz').classList.contains('active') || (state.prefetch && state.prefetch.level === level)) return;
  state.prefetch = { level, promise: buildSession(level).catch(() => null) };
}
function isStale(session) {
  const recent = recentWordsSet();
  return session.words.some(word => recent.has(word.w)) || progressData().recentThemes[0] === session.theme.id;
}
async function takeSession(level) {
  clearTimeout(prefetchTimer);
  const pending = state.prefetch && state.prefetch.level === level ? state.prefetch.promise : null;
  state.prefetch = null;
  let session = pending ? await pending : null;
  if (!session || session.source.kind === 'fallback' || isStale(session)) session = await buildSession(level);
  return session;
}
async function activateSession(session) {
  const direction = Session.nextDirection();
  Object.assign(state, { theme: session.theme, words: session.words, questions: session.questions, lesson: session.lesson, focus: session.focus || [], artikelNouns: session.artikelNouns || [], source: session.source, direction });
  const progress = progressData();
  progress.lastDirection = direction;
  progress.level = session.level;
  rememberSession(session.questions.map(question => question.de), session.theme.id);
  await saveProfile();
  maybeExpandVocab(session.theme);
}

function renderQuestion() {
  Speech.stop();
  const word = state.questions[state.index];
  $('progress').innerHTML = state.questions.map((_, i) => `<span class="${i <= state.index ? 'on' : ''}"></span>`).join('');
  $('question-count').textContent = `WORD ${state.index + 1} / ${state.questions.length} · THEME: ${(state.theme?.name || '').toUpperCase()}`;
  $('word').textContent = word.de;
  $('status').textContent = 'Pick the option that best matches the meaning.';
  const options = shuffled([word.en, ...(word.wrong || []).slice(0, 3)]);
  $('options').innerHTML = options.map((option, i) => `<button class="option" data-index="${i}"><span class="letter">${'ABCD'[i]}</span>${escapeHtml(option)}</button>`).join('');
  $('options').querySelectorAll('.option').forEach(button => { button.dataset.answer = options[Number(button.dataset.index)]; button.addEventListener('click', () => answer(button)); });
  $('dont-know').disabled = false; $('dont-know').classList.remove('chosen');
  $('feedback').hidden = true; $('next').hidden = true; state.answered = false;
}
function answer(button) {
  if (state.answered) return;
  state.answered = true;
  const word = state.questions[state.index];
  const right = word.en;
  const skipped = button === $('dont-know');
  const isCorrect = !skipped && button.dataset.answer === right;
  if (isCorrect) state.correct++;
  state.answers[state.index] = isCorrect;
  $('dont-know').disabled = true;
  $('options').querySelectorAll('.option').forEach(option => {
    option.disabled = true;
    if (option.dataset.answer === right) option.classList.add('correct');
  });
  if (skipped) button.classList.add('chosen');
  else if (!isCorrect) button.classList.add('wrong');
  $('feedback').hidden = false;
  const head = isCorrect ? `Correct! “${word.de}” = “${word.en}”.` : skipped ? `No problem, this word will come back. “${word.de}” = “${right}”.` : `The right answer: “${right}”.`;
  const example = word.example ? `<br><small>Example: <b lang="de">${escapeHtml(word.example.de)}</b> — ${escapeHtml(word.example.en)}</small>` : '';
  $('feedback').innerHTML = escapeHtml(head) + example;
  $('next').hidden = false;
  $('next').textContent = state.index === state.questions.length - 1 ? 'On to the text' : 'Next word';
}
function finishQuiz() {
  const reverse = state.direction === 'en-de';
  $('translation-title').textContent = reverse ? 'Translate the short text into German.' : 'Translate the short text into English.';
  $('paragraph').textContent = reverse ? state.lesson.en : state.lesson.de;
  $('paragraph').lang = reverse ? 'en' : 'de';
  $('speak-paragraph').hidden = reverse;
  $('translation-label').textContent = reverse ? 'Your German translation' : 'Your English translation';
  $('translation-input').placeholder = reverse ? 'Zum Beispiel: Heute stehe ich früh auf…' : 'For example: Today I get up early…';
  $('translation-input').lang = reverse ? 'de' : 'en';
  $('lesson-source').textContent = state.source?.detail || '';
  $('lesson-source').style.color = state.source?.kind === 'fallback' ? 'var(--red)' : '';
  const focusNotes = [];
  if (state.focus.length) focusNotes.push(`This text focuses on topics you found hard in recent translations: ${state.focus.map(Mistakes.label).join(', ')}.`);
  if (state.artikelNouns.length) focusNotes.push(`It also uses nouns whose article you mix up: ${state.artikelNouns.join(', ')}.`);
  $('lesson-focus').hidden = !focusNotes.length;
  $('lesson-focus').textContent = focusNotes.join(' ');
  show('translation');
}
async function loadAiStatus() {
  const pill = $('ai-pill');
  if (!window.WORTWEG_AI_ENDPOINT) { pill.textContent = 'offline mode'; pill.classList.add('ai-off'); return; }
  try {
    const status = await (await fetch(window.WORTWEG_AI_ENDPOINT + '/status')).json();
    pill.textContent = `AI · ${status.model || status.provider}`;
    pill.classList.add('ai-on');
  } catch (error) { pill.textContent = 'AI · status unavailable'; pill.classList.add('ai-off'); }
}
// Offline review: checks that each target word shows up in the translation.
function demoReview(text) {
  const tooShort = text.length < 12;
  const missed = state.direction === 'en-de'
    ? state.words.filter(word => !Validate.containsWord(text, word.w, word)).map(word => `“${word.w}” (${word.m}) does not appear in your translation. Example: ${Engine.example(word).de}`)
    : state.lesson.checks.filter(check => !Engine.mentions(text, check.words || [])).map(check => check.note);
  return {
    score: tooShort ? '—' : `${Math.max(4, 10 - missed.length)}/10`,
    evaluation: tooShort
      ? 'Your translation is very short; you can still compare it with the sample translation and the key structures below.'
      : missed.length
        ? `We found ${missed.length} point${missed.length > 1 ? 's' : ''} to work on in your translation. See below how to fix them.`
        : 'The key meanings look right. Compare your phrasing with the sample below.',
    corrections: missed.length ? missed : [`All target words appear in your translation. Grammar focus: ${grammarFocus[state.level]}`]
  };
}
function nextFocusNote(found) {
  const next = Mistakes.focusTopics(progressData(), state.level);
  if (!found.length && !next.length) return '';
  const parts = [];
  if (found.length) parts.push(`Topics you struggled with in this translation: ${found.map(Mistakes.label).join(', ')}.`);
  if (next.length) parts.push(`Upcoming texts will focus on: ${next.map(Mistakes.label).join(', ')}.`);
  return parts.join(' ');
}
async function renderReview(text, review) {
  applySessionLearning(text);
  syncArticles();
  const found = Array.isArray(review.weakPoints) ? Mistakes.recordReview(progressData(), review.weakPoints, progressData().sessionCount) : [];
  await saveProfile();
  const focusNote = Array.isArray(review.weakPoints) ? nextFocusNote(found) : '';
  $('next-focus').hidden = !focusNote;
  $('next-focus').textContent = focusNote;
  $('score').textContent = review.score;
  $('correct-count').textContent = `${state.correct}/${state.questions.length}`;
  $('level-label').textContent = state.level;
  $('user-translation').textContent = text || 'No translation written yet.';
  $('model-translation').textContent = state.direction === 'en-de' ? state.lesson.de : state.lesson.en;
  $('model-translation').lang = state.direction === 'en-de' ? 'de' : 'en';
  $('speak-answer').hidden = state.direction !== 'en-de';
  $('corrections').innerHTML = review.corrections.map(note => `<li>${escapeHtml(note)}</li>`).join('');
  $('evaluation').textContent = review.evaluation;
  $('profile-note').textContent = profileSummaryNote();
  show('result');
  prefetch(state.level);
}
async function evaluate() {
  const text = $('translation-input').value.trim();
  const reverse = state.direction === 'en-de';
  let review = demoReview(text);
  const endpoint = window.WORTWEG_AI_ENDPOINT;
  if (endpoint && text) {
    const button = $('check-translation');
    button.disabled = true; button.textContent = 'Checking…';
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        action: 'review_translation',
        direction: state.direction,
        level: state.level,
        sourceText: reverse ? state.lesson.en : state.lesson.de,
        referenceTranslation: reverse ? state.lesson.de : state.lesson.en,
        studentTranslation: text
      }) });
      const generated = await response.json();
      if (response.ok && generated.score && generated.evaluation && Array.isArray(generated.corrections)) review = generated;
      else review.evaluation += ` (AI review unavailable: ${generated?.error || 'invalid response'}; showing the offline check.)`;
    } catch (error) { review.evaluation += ` (Could not reach the AI: ${error.message}; showing the offline check.)`; }
    finally { button.disabled = false; button.textContent = 'Check translation'; }
  }
  await renderReview(text, review);
}

$('start').addEventListener('click', async () => {
  const button = $('start'); button.disabled = true; button.textContent = 'Preparing session…';
  state.index = 0; state.correct = 0; state.answers = [];
  let ready = false;
  try { await activateSession(await takeSession(state.level)); ready = true; }
  catch (error) { $('pool-status').textContent = 'Something went wrong while preparing the session; please try again.'; }
  finally { button.disabled = false; button.textContent = 'Start studying'; }
  if (ready && state.questions.length) { $('translation-input').value = ''; show('quiz'); renderQuestion(); }
});
$('next').addEventListener('click', () => { if (state.index === state.questions.length - 1) finishQuiz(); else { state.index++; renderQuestion(); } });
$('check-translation').addEventListener('click', evaluate);
$('dont-know').addEventListener('click', () => answer($('dont-know')));
$('restart').addEventListener('click', () => { $('translation-input').value = ''; renderPoolStatus(); renderArticlesHome(); show('welcome'); });
$('articles-start').addEventListener('click', startArticles);
$('guess-start').addEventListener('click', startGuess);
$('speak-word').addEventListener('click', () => Speech.speak(state.questions[state.index]?.de, $('speak-word')));
$('speak-paragraph').addEventListener('click', () => Speech.speak(state.lesson?.de, $('speak-paragraph')));
$('speak-answer').addEventListener('click', () => Speech.speak(state.lesson?.de, $('speak-answer')));
$('speak-articles').addEventListener('click', () => {
  const form = Articles.questionForm(Session.vocabByWord.get(articles.lemma));
  if (form) Speech.speak(articles.answered ? form.w : form.noun, $('speak-articles'));
});
$('articles-next').addEventListener('click', nextArticle);
$('articles-dont-know').addEventListener('click', () => answerArticle($('articles-dont-know')));
$('articles-exit').addEventListener('click', () => { renderArticlesHome(); show('welcome'); });

// AI settings screen; only available when the local server is running.
const settings = { data: null };
const providerInfo = (id) => settings.data?.providers.find(provider => provider.id === id) || null;
function settingsMessage(text, kind = '') {
  const box = $('settings-feedback');
  box.hidden = !text;
  box.className = `feedback ${kind}`;
  box.textContent = text || '';
}
async function settingsRequest(path, method, body) {
  const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
function settingsForm() {
  return { provider: $('set-provider').value, keys: $('set-keys').value, model: $('set-model').value, fallbacks: $('set-fallbacks').value, baseUrl: $('set-base').value };
}
function fillProviderFields(id, { useCurrent = false } = {}) {
  const provider = providerInfo(id);
  const current = settings.data.current;
  $('set-keys-field').hidden = !provider || provider.keyless;
  $('set-base-field').hidden = !provider?.custom;
  $('set-model-field').hidden = !provider;
  $('set-fallbacks-field').hidden = !provider;
  $('settings-test').hidden = !provider;
  const link = provider?.keyUrl ? ` <a href="${escapeHtml(provider.keyUrl)}" target="_blank" rel="noopener">Get an API key ↗</a>` : '';
  $('set-note').innerHTML = provider ? `${escapeHtml(provider.note || '')}${link}` : 'Offline mode: stories come from built-in templates and translations get a simple word check.';
  if (!provider) return;
  const same = useCurrent && current.provider === id;
  $('set-model').value = same ? current.model : provider.model;
  $('set-fallbacks').value = same ? current.fallbacks : provider.fallbacks;
  $('set-base').value = same ? current.baseUrl : provider.baseUrl;
  $('set-keys').value = '';
  $('set-keys').placeholder = provider.keys.length ? `Saved: ${provider.keys.join(', ')} · leave empty to keep` : 'Paste your key';
  $('set-model-list').innerHTML = '';
}
async function openSettings() {
  try { settings.data = await settingsRequest('/api/settings', 'GET'); }
  catch (error) { alert(error.message); return; }
  $('set-provider').innerHTML = '<option value="none">Off (offline mode)</option>' + settings.data.providers.map(provider => `<option value="${provider.id}">${escapeHtml(provider.label)}</option>`).join('');
  $('set-provider').value = providerInfo(settings.data.current.provider) ? settings.data.current.provider : 'none';
  fillProviderFields($('set-provider').value, { useCurrent: true });
  settingsMessage(!settings.data.configured && settings.data.problem ? `AI is not active yet: ${settings.data.problem}.` : '', 'bad');
  show('settings');
}
async function busy(button, label, task) {
  const text = button.textContent;
  button.disabled = true; button.textContent = label;
  try { await task(); } catch (error) { settingsMessage(error.message, 'bad'); }
  finally { button.disabled = false; button.textContent = text; }
}
$('settings-open').addEventListener('click', openSettings);
$('settings-back').addEventListener('click', () => { renderPoolStatus(); show('welcome'); });
$('set-provider').addEventListener('change', () => { fillProviderFields($('set-provider').value); settingsMessage(''); });
$('set-load-models').addEventListener('click', () => busy($('set-load-models'), 'Loading…', async () => {
  const { models } = await settingsRequest('/api/settings/models', 'POST', settingsForm());
  $('set-model-list').innerHTML = models.map(model => `<option value="${escapeHtml(model)}"></option>`).join('');
  settingsMessage(models.length ? `${models.length} models available. Click the model field to pick one.` : 'The provider returned no models.', models.length ? 'ok' : 'bad');
}));
$('settings-test').addEventListener('click', () => busy($('settings-test'), 'Testing…', async () => {
  const { model, results } = await settingsRequest('/api/settings/test', 'POST', settingsForm());
  const failed = results.filter(result => !result.ok);
  const slowest = Math.max(...results.map(result => result.ms || 0));
  settingsMessage(failed.length
    ? failed.map(result => `${results.length > 1 ? `Key ${result.key}: ` : ''}${result.error}`).join('\n')
    : `It works: ${model} answered${results.length > 1 ? ` with all ${results.length} keys` : ''} in ${(slowest / 1000).toFixed(1)} s. Don't forget to save.`, failed.length ? 'bad' : 'ok');
}));
$('settings-form').addEventListener('submit', (event) => {
  event.preventDefault();
  busy($('settings-save'), 'Saving…', async () => {
    settings.data = await settingsRequest('/api/settings', 'PUT', settingsForm());
    window.WORTWEG_AI_ENDPOINT = settings.data.configured ? '/api/ai' : '';
    state.prefetch = null;
    $('ai-pill').className = 'pill';
    loadAiStatus();
    fillProviderFields($('set-provider').value, { useCurrent: true });
    const { current } = settings.data;
    settingsMessage(settings.data.configured ? `Saved. AI is on: ${providerInfo(current.provider).label} · ${current.model}.`
      : current.provider === 'none' ? 'Saved. Wortweg runs in offline mode.' : `Saved, but AI is not active: ${settings.data.problem}.`, settings.data.configured || current.provider === 'none' ? 'ok' : 'bad');
  });
});

// Tells the user when the local server has stopped (it exits after idling).
function startHeartbeat() {
  if (!state.profile?.path) return;
  let down = false;
  const ping = async () => {
    try {
      const response = await fetch('/api/ping', { cache: 'no-store' });
      if (!response.ok) throw new Error(response.status);
      if (down) { down = false; $('ai-pill').className = 'pill'; loadAiStatus(); }
    } catch (error) {
      down = true;
      const pill = $('ai-pill');
      pill.textContent = 'server stopped · reopen Wortweg';
      pill.className = 'pill ai-off';
    }
  };
  setInterval(ping, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ping(); });
}

setupTheme();
setupLevels();
setupModes();
Speech.setup();
const vocabReady = loadProfile().then(loadExtraVocab);
vocabReady.then(() => {
  articles.ready = true;
  if (syncArticles().length) saveProfile();
  renderArticlesHome();
  renderPoolStatus();
  startHeartbeat();
  $('settings-open').hidden = !state.profile?.path;
  const remembered = progressData().level;
  if (remembered) selectLevel(remembered, { remember: false });
});
loadAiStatus();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
