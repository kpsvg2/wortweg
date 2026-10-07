// der/die/das practice: the deck of known nouns, spaced repeats of misses, and ending-based article rules.
(function (root) {
  const ARTICLES = ['der', 'die', 'das'];
  const RESULTS = ['right', 'wrong', 'skip'];
  const REQUEUE_GAP = 3;

  function splitNoun(w) {
    const match = /^(der|die|das)\s+(.+)$/.exec(String(w || '').trim());
    return match ? { article: match[1], noun: match[2] } : null;
  }
  function questionForm(word) {
    if (!word || word.k !== 'n') return null;
    const w = word.pl && word.sg ? word.sg : word.w;
    const parts = splitNoun(w);
    if (!parts) return null;
    return { ...parts, w, m: word.pl && word.sg ? (word.sgm || word.m) : word.m, pluralOnly: Boolean(word.pl && !word.sg) };
  }
  function isEligible(word) {
    return Boolean(questionForm(word));
  }
  function emptyArtikel() { return { nouns: {} }; }
  function normalizeArtikel(raw) {
    const out = emptyArtikel();
    if (!raw || typeof raw !== 'object' || !raw.nouns || typeof raw.nouns !== 'object' || Array.isArray(raw.nouns)) return out;
    Object.entries(raw.nouns).forEach(([lemma, entry]) => {
      if (!splitNoun(lemma) || !entry || typeof entry !== 'object') return;
      const count = (value) => (Number.isInteger(value) && value > 0 ? value : 0);
      out.nouns[lemma] = { addedAt: entry.addedAt || null, right: count(entry.right), wrong: count(entry.wrong), skipped: count(entry.skipped), lastResult: RESULTS.includes(entry.lastResult) ? entry.lastResult : null, lastSeen: entry.lastSeen || null };
    });
    return out;
  }
  function bucket(progress) {
    if (!progress.artikel || typeof progress.artikel !== 'object' || !progress.artikel.nouns) progress.artikel = emptyArtikel();
    return progress.artikel;
  }

  function syncKnown(progress, vocabByWord, statusOf, now = Date.now) {
    const nouns = bucket(progress).nouns;
    const added = [];
    vocabByWord.forEach((word, lemma) => {
      if (nouns[lemma] || !isEligible(word) || statusOf(lemma) !== 'known') return;
      nouns[lemma] = { addedAt: new Date(now()).toISOString(), right: 0, wrong: 0, skipped: 0, lastSeen: null };
      added.push(lemma);
    });
    return added;
  }
  function deckWords(progress, vocabByWord) {
    return Object.keys(bucket(progress).nouns).filter(lemma => isEligible(vocabByWord.get(lemma)));
  }
  function record(progress, lemma, result, now = Date.now) {
    const entry = bucket(progress).nouns[lemma];
    if (!entry) return;
    if (result === 'right') entry.right = (entry.right || 0) + 1;
    else if (result === 'skip') entry.skipped = (entry.skipped || 0) + 1;
    else entry.wrong = (entry.wrong || 0) + 1;
    entry.lastResult = RESULTS.includes(result) ? result : 'wrong';
    entry.lastSeen = new Date(now()).toISOString();
  }
  function isWeak(progress, lemma) {
    const entry = bucket(progress).nouns[lemma];
    if (!entry) return false;
    const missed = (entry.wrong || 0) + (entry.skipped || 0);
    return (entry.lastResult && entry.lastResult !== 'right') || missed > (entry.right || 0);
  }
  function weakNouns(progress, vocabByWord, limit = 2, exclude = new Set()) {
    return deckWords(progress, vocabByWord)
      .filter(lemma => isWeak(progress, lemma) && !exclude.has(lemma))
      .sort((a, b) => String(bucket(progress).nouns[b].lastSeen || '').localeCompare(String(bucket(progress).nouns[a].lastSeen || '')))
      .slice(0, limit);
  }

  function createDeck(lemmas, random = Math.random, { isWeak: weak = () => false } = {}) {
    const items = [...new Set(lemmas)];
    let queue = [];
    let round = 0;
    let last = null;
    let extra = new Set();
    function shuffle(list) {
      const copy = [...list];
      for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
      return copy;
    }
    function insertAt(lemma, positions) {
      if (!positions.length) return false;
      queue.splice(positions[Math.floor(random() * positions.length)], 0, lemma);
      extra.add(lemma);
      return true;
    }
    function range(from, to) {
      const out = [];
      for (let p = Math.max(0, from); p <= Math.min(queue.length, to); p++) out.push(p);
      return out;
    }
    function addSecondCopy(lemma) {
      const at = queue.indexOf(lemma);
      const later = range(at + 1 + REQUEUE_GAP, queue.length);
      const earlier = range(lemma === last ? 1 : 0, at - REQUEUE_GAP);
      insertAt(lemma, later.length ? later : earlier);
    }
    function refill() {
      queue = shuffle(items);
      if (queue.length > 1 && queue[0] === last) { const j = 1 + Math.floor(random() * (queue.length - 1)); [queue[0], queue[j]] = [queue[j], queue[0]]; }
      round++;
      extra = new Set();
      items.filter(lemma => weak(lemma)).forEach(addSecondCopy);
    }
    function next() {
      if (!items.length) return null;
      if (!queue.length) refill();
      last = queue.shift();
      return last;
    }
    function requeue(lemma) {
      if (extra.has(lemma) || queue.includes(lemma) || queue.length < 2) return false;
      const positions = range(REQUEUE_GAP, REQUEUE_GAP * 2);
      return insertAt(lemma, positions.length ? positions : [queue.length]);
    }
    return { next, requeue, size: () => items.length, round: () => round };
  }

  const STRENGTH_TEXT = { always: 'always', almost: 'almost always', mostly: 'usually' };
  const ENDING_RULES = [
    { test: /[^aeiouäöü]chen$/, label: '-chen (diminutive)', article: 'das', strength: 'always' },
    { test: /lein$/, label: '-lein (diminutive)', article: 'das', strength: 'always' },
    { test: /ung$/, label: '-ung', article: 'die', strength: 'always' },
    { test: /heit$/, label: '-heit', article: 'die', strength: 'always' },
    { test: /keit$/, label: '-keit', article: 'die', strength: 'always' },
    { test: /schaft$/, label: '-schaft', article: 'die', strength: 'always' },
    { test: /tät$/, label: '-tät', article: 'die', strength: 'always' },
    { test: /ling$/, label: '-ling', article: 'der', strength: 'always' },
    { test: /ismus$/, label: '-ismus', article: 'der', strength: 'always' },
    { test: /.{3,}(enz|anz)$/, label: '-enz / -anz', article: 'die', strength: 'always' },
    { test: /ion$/, label: '-ion', article: 'die', strength: 'almost' },
    { test: /(ade|age|ette|ine)$/, label: '-ade / -age / -ette / -ine', article: 'die', strength: 'almost' },
    { test: /(ei|ie)$/, label: '-ei / -ie', article: 'die', strength: 'almost' },
    { test: /eur$/, label: '-eur', article: 'der', strength: 'almost' },
    { test: /ik$/, label: '-ik', article: 'die', strength: 'mostly' },
    { test: /ur$/, label: '-ur', article: 'die', strength: 'mostly' },
    { test: /[^e]in$/, label: '-in (female person)', article: 'die', strength: 'mostly' },
    { test: /ment$/, label: '-ment', article: 'das', strength: 'mostly' },
    { test: /[^a]um$/, label: '-um / -tum', article: 'das', strength: 'mostly' },
    { test: /(ma|o)$/, label: '-ma / -o', article: 'das', strength: 'mostly' },
    { test: /e$/, label: '-e', article: 'die', strength: 'mostly' },
    { test: /.{3,}(ist|ant|or)$/, label: '-ist / -ant / -or', article: 'der', strength: 'mostly' },
    { test: /(ig|ich|ast)$/, label: '-ig / -ich / -ast', article: 'der', strength: 'mostly' },
    { test: /er$/, label: '-er', article: 'der', strength: 'mostly' }
  ];
  function endingRule(noun) {
    const rule = ENDING_RULES.find(item => item.test.test(String(noun || '')));
    return rule ? { label: rule.label, article: rule.article, strength: rule.strength } : null;
  }
  function ruleNote(noun, article) {
    const rule = endingRule(noun);
    if (!rule) return 'There is no general rule for this ending; learn the article together with the word. In compound nouns the article comes from the last part.';
    const base = `Rule: nouns ending in ${rule.label} ${STRENGTH_TEXT[rule.strength]} take “${rule.article}”`;
    return rule.article === article ? `${base}.` : `${base}; this word is an exception.`;
  }

  const api = { ARTICLES, splitNoun, questionForm, isEligible, emptyArtikel, normalizeArtikel, syncKnown, deckWords, record, isWeak, weakNouns, createDeck, endingRule, ruleNote };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WortwegArticles = api;
})(typeof window !== 'undefined' ? window : globalThis);
