// Offline sentence engine: turns vocabulary entries into German sentences
// (present, perfect, subordinate clauses, zu-infinitive) plus English translations.
(function (root) {
  const join = (...parts) => parts.filter(part => part !== undefined && part !== null && String(part).trim() !== '').join(' ');
  const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);
  const low = (text) => (/^I\b/.test(text) ? text : text.charAt(0).toLowerCase() + text.slice(1));
  const stripDot = (text) => text.replace(/[.!?]\s*$/, '');
  const sentence = (text) => cap(text) + '.';

  const AUX_PAST = { habe: 'hatte', hat: 'hatte', haben: 'hatten', bin: 'war', ist: 'war', sind: 'waren' };
  const PRET_OF = { bin: 'war', ist: 'war', sind: 'waren', habe: 'hatte', hat: 'hatte', haben: 'hatten' };

  // Fill in defaults: subject "ich", perfect auxiliary, and sein/haben special cases.
  function normalize(entry) {
    const e = { ...entry };
    e.s = e.s || 'ich';
    const isIch = e.s === 'ich';
    if (!e.pp && ['bin', 'ist', 'sind'].includes(e.v)) { e.pp = 'gewesen'; e.aux = e.aux || e.v; e.pret = e.pret || PRET_OF[e.v]; }
    if (!e.pp && ['habe', 'hat', 'haben'].includes(e.v)) { e.pp = 'gehabt'; e.aux = e.aux || e.v; e.pret = e.pret || PRET_OF[e.v]; }
    if (!e.aux) e.aux = isIch ? 'habe' : (e.s === 'wir' || /^die .*(kosten|eltern)$/i.test(e.s) ? 'haben' : 'hat');
    return e;
  }

  const form = {
    presMain: (e) => join(e.s, e.v, e.r, e.sep),
    presInv: (adv, e) => join(adv, e.v, e.s, e.r, e.sep),
    presSub: (e) => join(e.s, e.r, e.sep ? e.sep + e.v : e.v),
    pastMain: (e) => (e.pret ? join(e.s, e.pret, e.r) : join(e.s, e.aux, e.r, e.pp)),
    pastInv: (adv, e) => (e.pret ? join(adv, e.pret, e.s, e.r) : join(adv, e.aux, e.s, e.r, e.pp)),
    pastSub: (e) => (e.pret ? join(e.s, e.r, e.pret) : join(e.s, e.r, e.pp, e.aux)),
    plusqSub: (e) => join(e.s, e.r, e.pp, AUX_PAST[e.aux] || e.aux),
    zuInf: (e) => join(e.r, e.sep ? e.sep + 'zu' + e.inf : 'zu ' + e.inf)
  };
  const canZu = (e) => Boolean(e.inf && e.ti && e.s === 'ich');

  // B1/B2 texts open (and B2 closes) with a zu-infinitive when a word allows it.
  function arrange(level, entries) {
    const list = entries.map(normalize);
    if (level !== 'B1' && level !== 'B2') return list;
    const zu = list.filter(canZu);
    const rest = list.filter(e => !canZu(e));
    if (level === 'B1') return [...zu.slice(0, 1), ...rest, ...zu.slice(1)].slice(0, list.length);
    const first = zu.shift();
    const last = zu.shift();
    const middle = [...rest, ...zu];
    return [first, ...middle, last].filter(Boolean);
  }
  // Put a "problem" sentence (p: 1) in the slot that is followed by "obwohl".
  function placeProblem(level, list) {
    if (level !== 'B1' && level !== 'B2' || list.length < 5 || list[3].p) return list;
    const movable = level === 'B1' ? [1, 2, 4] : [1, 2];
    const from = movable.find(index => list[index] && list[index].p);
    if (from === undefined) return list;
    const copy = [...list];
    [copy[3], copy[from]] = [copy[from], copy[3]];
    return copy;
  }
  // The "nachdem" slot needs a real action, not a state verb with a Präteritum form.
  function placeAction(level, list) {
    if (level !== 'B1' && level !== 'B2' || list.length < 5 || !list[1].pret) return list;
    const candidates = (level === 'B1' ? [2, 4, 3] : [2, 3]).filter(index => !list[index].pret && !(index === 3 && list[3].p));
    if (!candidates.length) return list;
    const copy = [...list];
    [copy[1], copy[candidates[0]]] = [copy[candidates[0]], copy[1]];
    return copy;
  }

  const templates = {
    A1(theme, [a, b, c, d, e]) {
      return {
        de: [
          theme.pres[0],
          sentence(form.presMain(a)),
          sentence(form.presMain(b)),
          sentence(form.presInv('dann', c)),
          cap(form.presMain(d)) + ', und ' + form.presMain(e) + '.'
        ],
        en: [theme.pres[1], a.t, b.t, 'Then ' + low(c.t), stripDot(d.t) + ', and ' + low(e.t)]
      };
    },
    A2(theme, [a, b, c, d, e]) {
      return {
        de: [
          theme.past[0],
          sentence(form.pastInv('zuerst', a)),
          sentence(form.pastInv('danach', b)),
          sentence(form.pastMain(c)),
          'Ich habe meiner Freundin erzählt, dass ' + form.pastSub(d) + '.',
          sentence(form.pastInv('am Abend', e))
        ],
        en: [
          theme.past[1],
          'First, ' + low(a.tp),
          'After that, ' + low(b.tp),
          c.tp,
          'I told my friend that ' + low(d.tp),
          'In the evening, ' + low(e.tp)
        ]
      };
    },
    B1(theme, [a, b, c, d, e]) {
      const zuA = canZu(a);
      return {
        de: [
          theme.past[0],
          zuA ? 'Ich hatte mir vorgenommen, ' + form.zuInf(a) + '.' : sentence(form.pastMain(a)),
          'Nachdem ' + form.plusqSub(b) + ', ' + form.pastInv('', c) + '.',
          d.p ? 'Obwohl ' + form.pastSub(d) + ', war der Tag am Ende ziemlich gut.' : 'Weil ' + form.pastSub(d) + ', war ich am Ende zufrieden.',
          sentence(form.pastInv('außerdem', e)),
          'Abends war ich müde, deshalb bin ich früh ins Bett gegangen.'
        ],
        en: [
          theme.past[1],
          zuA ? 'I had planned to ' + a.ti + '.' : a.tp,
          'After ' + low(stripDot(b.tp)) + ', ' + low(c.tp),
          (d.p ? 'Although ' : 'Because ') + low(stripDot(d.tp)) + (d.p ? ', the day turned out quite well in the end.' : ', I was happy in the end.'),
          'Besides, ' + low(e.tp),
          'In the evening I was tired, so I went to bed early.'
        ]
      };
    },
    B2(theme, [a, b, c, d, e]) {
      const zuA = canZu(a);
      const zuE = canZu(e);
      return {
        de: [
          theme.past[0],
          'Rückblickend lässt sich sagen, dass der Tag ereignisreicher war als erwartet.',
          zuA ? 'Vor allem war es mir wichtig, ' + form.zuInf(a) + '.' : 'Vor allem ist mir in Erinnerung geblieben, dass ' + form.pastSub(a) + '.',
          'Nachdem ' + form.plusqSub(b) + ', ' + form.pastInv('', c) + '.',
          d.p ? 'Obwohl ' + form.pastSub(d) + ', verlief insgesamt alles reibungslos.' : 'Da ' + form.pastSub(d) + ', war ich insgesamt zufrieden.',
          zuE ? 'Hätte ich mehr Zeit gehabt, hätte ich außerdem versucht, ' + form.zuInf(e) + '.' : 'Hinzu kam, dass ' + form.pastSub(e) + '.'
        ],
        en: [
          theme.past[1],
          'Looking back, I can say the day was more eventful than expected.',
          zuA ? 'Above all, it was important to me to ' + a.ti + '.' : 'What stuck in my mind most was that ' + low(a.tp),
          'After ' + low(stripDot(b.tp)) + ', ' + low(c.tp),
          (d.p ? 'Although ' : 'Since ') + low(stripDot(d.tp)) + (d.p ? ', everything went smoothly overall.' : ', I was satisfied overall.'),
          zuE ? 'If I had had more time, I would also have tried to ' + e.ti + '.' : 'On top of that, ' + low(e.tp)
        ]
      };
    }
  };

  const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'your', 'something', 'someone']);
  // Lower-case English word starts that a translation must contain to count as "mentioning" the word.
  function checkStems(entry) {
    if (Array.isArray(entry.c) && entry.c.length) return entry.c.map(s => s.toLowerCase());
    return [...new Set(entry.m.toLowerCase().replace(/^to /, '').split(/[\s/·,()]+/)
      .filter(part => part.length > 2 && !STOPWORDS.has(part)))].slice(0, 4);
  }
  function mentions(text, stems) {
    const normalized = ' ' + (text || '').toLowerCase().replace(/[.,;:!?"'“”‘’()\-]/g, ' ') + ' ';
    return stems.some(stem => normalized.includes(' ' + stem));
  }

  function buildLesson(level, theme, entries, grammarNote) {
    const ordered = placeAction(level, placeProblem(level, arrange(level, entries)));
    const pack = (templates[level] || templates.A1)(theme, ordered);
    return {
      de: pack.de.join(' '),
      en: pack.en.join(' '),
      checks: ordered.map(e => ({
        words: checkStems(e),
        lemma: e.w,
        note: `“${e.w}” = “${e.m}”. Its meaning in the text should show up in your translation. Example: ${sentence(form.presMain(e))} → ${e.t}${grammarNote ? ' · Grammar focus: ' + grammarNote : ''}`
      }))
    };
  }

  // Wrong answer options: same part of speech, unrelated meaning, preferably from another theme.
  function distractors(entry, pool, count = 3, random = Math.random, field = 'm') {
    const stems = new Set(checkStems(entry));
    const ok = pool.filter(other => other.w !== entry.w && other.k === entry.k && other.m !== entry.m
      && !checkStems(other).some(stem => stems.has(stem)));
    const otherTheme = ok.filter(other => other.theme !== entry.theme);
    const source = otherTheme.length >= count ? otherTheme : ok;
    const copy = [...source];
    const picked = [];
    while (picked.length < count && copy.length) picked.push(copy.splice(Math.floor(random() * copy.length), 1)[0][field]);
    return picked;
  }

  function example(entry) {
    const e = normalize(entry);
    return { de: sentence(form.presMain(e)), en: e.t };
  }

  const api = { buildLesson, distractors, example, checkStems, mentions, normalize, form };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WortwegEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
