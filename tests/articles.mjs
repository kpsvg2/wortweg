// Article practice: which nouns enter the deck, endless shuffled rounds, extra repeats for hard nouns.
import { loadThemes, SessionLib, Articles, seeded, report, heading, summary } from './lib.mjs';
import { promptFor } from '../server/ai.mjs';

const themes = loadThemes();
const pool = themes.flatMap(theme => theme.words);
const nouns = pool.filter(word => word.k === 'n');
const plural = nouns.filter(word => word.pl);

heading('Article deck');
const ineligible = nouns.filter(word => !Articles.isEligible(word));
report(ineligible.length ? 'FAIL' : 'PASS', 'Every noun, plurals included, can be asked', ineligible.map(w => w.w).join(', ') || `${nouns.length} nouns`);
const pluralForms = plural.map(word => ({ word, form: Articles.questionForm(word) }));
const wrongPlural = pluralForms.filter(({ word, form }) => word.sg ? form.w !== word.sg || form.pluralOnly : form.article !== 'die' || !form.pluralOnly);
report(wrongPlural.length ? 'FAIL' : 'PASS', 'Plural entries are asked with their singular article; plural-only nouns with "die" and a note', pluralForms.map(({ word, form }) => `${word.w} → ${form.w}${form.pluralOnly ? ' (plural only)' : ''}`).join(', '));
const singularDie = pluralForms.filter(({ form }) => !form.pluralOnly && form.article !== 'die').length;
report(singularDie > 0 ? 'PASS' : 'FAIL', 'Nouns with plural "die" but singular der/das are asked with the right article', `${singularDie} nouns`);

{
  const progress = SessionLib.emptyProgress();
  const session = SessionLib.create({ themes: loadThemes(), getProgress: () => progress, random: seeded(3) });
  const verb = pool.find(word => word.k === 'v');
  const noun = nouns.find(word => !word.pl);
  const pluralNoun = plural.find(word => word.sg);
  [verb, noun, pluralNoun].forEach(word => { for (let i = 0; i < 3; i++) session.bumpWord(word.w, 0.22, { correct: true }); });
  const learning = nouns.find(word => !word.pl && word !== noun);
  session.bumpWord(learning.w, 0.22, { correct: true });
  const added = Articles.syncKnown(progress, session.vocabByWord, session.getWordStatus);
  report(added.length === 2 && added.includes(noun.w) && added.includes(pluralNoun.w) ? 'PASS' : 'FAIL', 'Only known nouns are added (no verbs, no words still being learned)', added.join(', '));
  report(Articles.syncKnown(progress, session.vocabByWord, session.getWordStatus).length === 0 ? 'PASS' : 'FAIL', 'A noun is never added twice');
  for (let i = 0; i < 3; i++) session.bumpWord(noun.w, -0.38, { correct: false });
  report(Articles.deckWords(progress, session.vocabByWord).includes(noun.w) ? 'PASS' : 'FAIL', 'A noun forgotten later in Normal mode stays in the article list');
  Articles.record(progress, noun.w, 'right');
  Articles.record(progress, noun.w, 'skip');
  Articles.record(progress, noun.w, 'wrong');
  const entry = progress.artikel.nouns[noun.w];
  report(entry.right === 1 && entry.wrong === 1 && entry.skipped === 1 ? 'PASS' : 'FAIL', 'Right / wrong / don\'t know are counted', JSON.stringify(entry));
  const roundTrip = Articles.normalizeArtikel(JSON.parse(JSON.stringify(SessionLib.normalizeProgress(progress).artikel)));
  report(roundTrip.nouns[noun.w]?.right === 1 ? 'PASS' : 'FAIL', 'The list survives a profile save and load');
  report(Object.keys(Articles.normalizeArtikel({ nouns: { Tisch: {}, 'der Tisch': { right: -2 } } }).nouns).join() === 'der Tisch' ? 'PASS' : 'FAIL', 'Broken entries are cleaned');
}

heading('Endless deck');
{
  const lemmas = nouns.filter(word => !word.pl).slice(0, 23).map(word => word.w);
  const deck = Articles.createDeck(lemmas, seeded(11));
  const ROUNDS = 40;
  let fullRounds = 0, boundaryRepeats = 0, previous = null, positionsOk = true;
  for (let r = 1; r <= ROUNDS; r++) {
    const round = [];
    for (let i = 0; i < lemmas.length; i++) {
      const lemma = deck.next();
      if (deck.round() !== r) positionsOk = false;
      if (i === 0 && lemma === previous) boundaryRepeats++;
      round.push(lemma);
      previous = lemma;
    }
    if (new Set(round).size === lemmas.length) fullRounds++;
  }
  report(fullRounds === ROUNDS ? 'PASS' : 'FAIL', 'Each round asks every noun exactly once', `${fullRounds}/${ROUNDS} rounds`);
  report(boundaryRepeats === 0 ? 'PASS' : 'FAIL', 'No back-to-back repeat across round boundaries', `${boundaryRepeats} times`);
  report(positionsOk ? 'PASS' : 'FAIL', 'A new round only starts when the list is exhausted');
  const firstRounds = new Set();
  const fresh = Articles.createDeck(lemmas, seeded(5));
  for (let r = 0; r < 5; r++) firstRounds.add(Array.from({ length: lemmas.length }, () => fresh.next()).join('|'));
  report(firstRounds.size === 5 ? 'PASS' : 'FAIL', 'Each round is reshuffled', `${firstRounds.size}/5 different orders`);
  const single = Articles.createDeck(['der Tisch']);
  report(single.next() === 'der Tisch' && single.next() === 'der Tisch' && single.round() === 2 ? 'PASS' : 'FAIL', 'A one-noun list also loops forever');
  report(Articles.createDeck([]).next() === null ? 'PASS' : 'FAIL', 'An empty list returns no question');
}

heading('Hard nouns more often');
{
  const lemmas = nouns.filter(word => !word.pl).slice(0, 20).map(word => word.w);
  const weakSet = new Set(lemmas.slice(0, 3));
  const deck = Articles.createDeck(lemmas, seeded(21), { isWeak: lemma => weakSet.has(lemma) });
  let ok = true, minGap = Infinity, previous = null, backToBack = 0;
  for (let r = 1; r <= 30; r++) {
    const seen = [];
    for (let i = 0; i < lemmas.length + weakSet.size; i++) {
      const lemma = deck.next();
      if (lemma === previous) backToBack++;
      previous = lemma;
      seen.push(lemma);
    }
    const counts = new Map();
    seen.forEach((lemma, i) => {
      if (counts.has(lemma)) minGap = Math.min(minGap, i - counts.get(lemma).at);
      counts.set(lemma, { n: (counts.get(lemma)?.n || 0) + 1, at: i });
    });
    if (!lemmas.every(lemma => counts.get(lemma)?.n === (weakSet.has(lemma) ? 2 : 1))) ok = false;
  }
  report(ok ? 'PASS' : 'FAIL', 'Hard nouns come twice per round, others once', `${weakSet.size} hard nouns, 30 rounds`);
  report(minGap >= 4 && backToBack === 0 ? 'PASS' : 'FAIL', 'At least 3 other nouns between two appearances, no back-to-back', `shortest gap ${minGap - 1} nouns`);

  const plain = Articles.createDeck(lemmas, seeded(8));
  const first = plain.next();
  const requeued = plain.requeue(first);
  const order = Array.from({ length: lemmas.length }, () => plain.next());
  const at = order.indexOf(first);
  report(requeued && at >= 3 && at <= 6 && plain.round() === 1 ? 'PASS' : 'FAIL', 'A missed noun returns 3-6 questions later in the same round', `${at} questions later`);
  report(!plain.requeue(order[order.length - 1]) || order.filter(x => x === first).length === 1 ? 'PASS' : 'FAIL', 'A requeued noun is not requeued again in the same round');

  const progress = SessionLib.emptyProgress();
  const session = SessionLib.create({ themes: loadThemes(), getProgress: () => progress, random: seeded(4) });
  const [a, b, c] = nouns.filter(word => !word.pl).slice(0, 3);
  [a, b, c].forEach(word => { for (let i = 0; i < 3; i++) session.bumpWord(word.w, 0.22, { correct: true }); });
  Articles.syncKnown(progress, session.vocabByWord, session.getWordStatus);
  let tick = 0;
  const now = () => Date.UTC(2026, 9, 2, 12, 0, tick++);
  Articles.record(progress, a.w, 'wrong', now);
  Articles.record(progress, b.w, 'right', now);
  Articles.record(progress, c.w, 'skip', now);
  report(Articles.isWeak(progress, a.w) && !Articles.isWeak(progress, b.w) && Articles.isWeak(progress, c.w) ? 'PASS' : 'FAIL', 'A noun answered wrong or skipped counts as hard');
  Articles.record(progress, a.w, 'right', now);
  report(!Articles.isWeak(progress, a.w) ? 'PASS' : 'FAIL', 'Answering it right afterwards clears it');
  const weak = Articles.weakNouns(progress, session.vocabByWord, 2);
  report(weak.length === 1 && weak[0] === c.w ? 'PASS' : 'FAIL', 'Hard nouns are picked for the Normal-mode text', weak.join(', '));
  report(Articles.weakNouns(progress, session.vocabByWord, 2, new Set([c.w])).length === 0 ? 'PASS' : 'FAIL', 'The lesson\'s own and recently seen words are excluded');
}

heading('Normal-mode prompt');
{
  const base = { action: 'generate_lesson', level: 'A2', words: [{ de: 'der Tisch', en: 'table' }] };
  const withNouns = promptFor({ ...base, artikelNouns: [{ de: 'der Handschuh', en: 'glove' }, { de: 'Unsinn', en: 'x' }] });
  report(withNouns.includes('der Handschuh (glove)') && !withNouns.includes('Unsinn') ? 'PASS' : 'FAIL', 'Mixed-up nouns reach the lesson prompt (invalid ones are dropped)');
  report(!promptFor(base).includes('mixes up the articles') ? 'PASS' : 'FAIL', 'Without hard nouns the prompt is unchanged');
}

summary();
