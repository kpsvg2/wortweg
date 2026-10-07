// Rule checks for vocabulary entries (built-in and AI-generated) and word matching in German text.
(function (root) {
  const SEP_PREFIXES = ['herunter', 'hinunter', 'vorbei', 'krank', 'dazu', 'zurück', 'zusammen', 'heraus', 'herein', 'weiter', 'statt', 'nach', 'fern', 'fest', 'fort', 'weh', 'hin', 'her', 'vor', 'weg', 'mit', 'auf', 'aus', 'ein', 'ab', 'an', 'bei', 'zu', 'los', 'um', 'teil'];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function wordStems(de) {
    const core = de.replace(/^(der|die|das|sich)\s+/i, '').trim();
    const parts = core.split(/\s+/);
    const main = parts[parts.length - 1].toLowerCase();
    const cut = (word) => word.replace(/(ern|eln|en|n)$/, '');
    if (/^[a-zäöüß]/.test(parts[parts.length - 1]) && /(en|ern|eln|n)$/.test(main)) {
      const prefix = SEP_PREFIXES.find(p => main.startsWith(p) && main.length - p.length >= 3);
      return { stems: [cut(main)], split: prefix ? { prefix, stem: cut(main.slice(prefix.length)) } : null, verb: true };
    }
    const stems = [main.length > 5 ? main.slice(0, main.length - 2) : main.replace(/e$/, '')];
    if (main.length >= 5 && /e[rl]$/.test(main)) stems.push(main.slice(0, -2) + main.slice(-1));
    return { stems, split: null, verb: false };
  }

  function entryForms(entry) {
    if (!entry || entry.k !== 'v') return [];
    return [entry.pp, entry.pret, ...(entry.v && entry.v !== 'habe' && entry.v !== 'bin' ? [entry.v] : [])].filter(f => f && f.length >= 3).map(f => f.toLowerCase());
  }

  function containsWord(text, de, entry) {
    const lower = String(text).toLowerCase();
    if (entryForms(entry).some(form => new RegExp(`(?<!\\p{L})${esc(form)}(?!\\p{L})`, 'u').test(lower))) return true;
    const { stems, split, verb } = wordStems(de);
    if (split && new RegExp(`(?<!\\p{L})${esc(split.prefix)}(ge|zu)?${esc(split.stem)}`, 'u').test(lower)) return true;
    const found = stems.some(stem => verb
      ? new RegExp(`(?<!\\p{L})(ge|zu)?${esc(stem)}`, 'u').test(lower) || (stem.length >= 4 && lower.includes(stem))
      : lower.includes(stem));
    if (found || !split) return found;
    return new RegExp(`(?<!\\p{L})${esc(split.stem)}`, 'u').test(lower) && new RegExp(`(?<!\\p{L})${esc(split.prefix)}(?!\\p{L})`, 'u').test(lower);
  }

  const DAYS = 'Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag|Wochenende';
  const TIME_EXPRESSIONS = new RegExp(`(?<!\\p{L})(heute|gestern|vorgestern|morgen|übermorgen|bald|demnächst|(nächste|letzte|diese)[nmrs]? (Woche|Monat|Jahr)|jeden (Tag|Morgen|Abend|Monat|${DAYS})|(am|diesen|nächsten|letzten) (${DAYS}))(?!\\p{L})`, 'u');
  const AUX = { habe: 'ich', bin: 'ich', haben: 'plural', sind: 'plural', hat: 'single', ist: 'single' };
  function subjectKind(e) {
    if (e.s === 'ich') return 'ich';
    if (e.s === 'wir' || /en$|^sind$/.test(e.v)) return 'plural';
    return 'single';
  }

  function validateEntry(word, Engine) {
    const problems = [];
    const fail = (message) => problems.push(message);
    for (const field of ['w', 'm', 'k', 'v', 't', 'tp']) if (!word[field] || typeof word[field] !== 'string') fail(`missing field: ${field}`);
    if (problems.length) return problems;
    if (!['n', 'v', 'a'].includes(word.k)) fail(`invalid kind k=${word.k}`);
    if (word.k === 'n' && !/^(der|die|das) [A-ZÄÖÜ]/.test(word.w)) fail('a noun must start with an article and a capital letter');
    if (word.pl && (word.k !== 'n' || !/^die /.test(word.w))) fail('pl is only allowed on plural nouns starting with "die"');
    if ((word.sg || word.sgm) && !word.pl) fail('sg/sgm are only allowed on plural (pl) nouns');
    if (word.sg && (typeof word.sg !== 'string' || !/^(der|die|das) [A-ZÄÖÜ]/.test(word.sg))) fail(`sg must start with an article and a capital letter: ${word.sg}`);
    if (word.sgm !== undefined && typeof word.sgm !== 'string') fail('sgm must be a string');
    if (!/[.!?]$/.test(word.t) || !/[.!?]$/.test(word.tp)) fail('t/tp must end with punctuation');
    if (word.s && /^[A-ZÄÖÜ]/.test(word.s) && !/^(Herr|Frau)\b/.test(word.s)) fail(`subject must start lower-case: ${word.s}`);
    for (const field of ['s', 'v', 'r', 'sep', 'aux', 'pp', 'pret', 'inf', 'ti']) if (word[field] !== undefined && typeof word[field] !== 'string') fail(`${field} must be a string`);
    if (word.c !== undefined && (!Array.isArray(word.c) || word.c.some(stem => typeof stem !== 'string' || !stem.trim()))) fail('c must be an array of strings');
    if (problems.length) return problems;

    const e = Engine.normalize(word);
    if (!e.pp && !e.pret) fail('no past form (pp or pret)');
    if (e.sep && e.pp && !e.pp.startsWith(e.sep)) fail(`Partizip II must start with the separable prefix: ${e.sep} / ${e.pp}`);
    if (word.inf && !word.ti && (word.s === undefined || word.s === 'ich')) fail('inf is set but ti (English infinitive phrase) is missing');
    if (word.ti && (/^to\s/i.test(word.ti) || /[.!?]$/.test(word.ti))) fail(`ti must be a bare phrase without "to" or final punctuation: ${word.ti}`);
    if (e.aux && !AUX[e.aux]) fail(`invalid auxiliary: ${e.aux}`);

    const kind = subjectKind(e);
    if (AUX[e.aux] && AUX[e.aux] !== kind) fail(`auxiliary does not match subject: ${e.s} + ${e.aux}`);
    if (kind === 'ich' && !/e$/.test(e.v) && e.v !== 'bin') fail(`verb form with "ich" must end in -e: ${e.v}`);
    if (kind === 'single' && !/t$/.test(e.v) && !['ist', 'hat'].includes(e.v)) fail(`3rd person singular must end in -t: ${e.s} ${e.v}`);
    if (/^sich /.test(word.w) && kind === 'ich' && !/\b(mich|mir)\b/.test(e.r || '')) fail('reflexive verb needs mich/mir in r');
    const timeWord = TIME_EXPRESSIONS.exec(`${e.s || ''} ${e.r || ''}`);
    if (timeWord) fail(`sentence contains a time expression: "${timeWord[0]}"`);

    const example = Engine.example(word);
    if (!containsWord(example.de, word.w, word)) fail(`example sentence does not contain the word itself: ${example.de}`);
    if (e.sep && new RegExp(`(?<!\\p{L})${esc(e.sep)}$`, 'iu').test((e.r || '').trim())) fail(`separable prefix repeated in r: ${e.r}`);
    const forms = [Engine.form.presMain(e), Engine.form.pastMain(e), Engine.form.pastSub(e)];
    const doubled = forms.map(text => /(?<!\p{L})(\p{L}+) \1(?!\p{L})/iu.exec(text)).find(Boolean);
    if (doubled) fail(`doubled word in sentence: "${doubled[0]}"`);
    const stems = Engine.checkStems(word);
    if (!stems.length) fail('no English check stems (c)');
    else if (!Engine.mentions(word.t, stems) && !Engine.mentions(word.tp, stems)) fail(`English check stems (${stems.join(', ')}) do not appear in the translation: ${word.t}`);
    const bad = /undefined|(?<!unter )\bnull\b|NaN/.exec([word.t, word.tp, word.ti, example.de].join(' '));
    if (bad) fail(`broken value: ${bad[0]}`);
    return problems;
  }

  const api = { wordStems, containsWord, entryForms, validateEntry, SEP_PREFIXES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WortwegValidate = api;
})(typeof window !== 'undefined' ? window : globalThis);
