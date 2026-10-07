# Vocabulary format

Built-in words live in [`app/data/vocabulary.js`](../app/data/vocabulary.js), grouped into themes. Words the AI adds are stored per user in `data/profiles/<id>/vocab-extra.json` in the same format.

Every entry carries the pieces the offline sentence engine needs to build one example sentence in several grammatical forms (present, Perfekt, dass-clause, nachdem + Plusquamperfekt, zu-infinitive), together with its English translations.

```js
{ w: 'aufstehen', m: 'to get up', k: 'v', v: 'stehe', sep: 'auf', r: 'um sieben Uhr', aux: 'bin', pp: 'aufgestanden', inf: 'stehen',
  t: 'I get up at seven.', tp: 'I got up at seven.', ti: 'get up at seven', c: ['get up', 'got up'], level: 'A1' }
```

| Field | Meaning |
|---|---|
| `w` | Dictionary form: nouns with article (`der Fahrplan`), verbs in the infinitive (`sich beeilen`), adjectives plain |
| `m` | Short English meaning |
| `k` | `n` noun, `v` verb, `a` adjective/adverb |
| `s` | Subject; omitted means `ich`. Other subjects start lower-case (`der Zug`, `meine Schwester`) |
| `v` | Present-tense verb, conjugated for the subject |
| `r` | Rest of the sentence, without verb and separable prefix. No time words (heute, gestern …), since the sentence is used in both present and past |
| `sep` | Separable prefix (`auf`, `an` …) |
| `pp`, `aux` | Partizip II (with prefix) and the conjugated Perfekt auxiliary (`habe`/`bin`, `hat`/`ist`, `haben`/`sind`) |
| `pret` | Präteritum, only for state verbs (`war`, `gab`) |
| `inf`, `ti` | Infinitive without prefix and the English infinitive phrase without "to"; only for plannable actions with subject `ich` (used for zu-infinitive sentences) |
| `t`, `tp` | English translation in present and past |
| `c` | Lower-case English word starts that a correct translation contains (used by the offline review) |
| `p` | `1` if the sentence is a mishap (placed after "obwohl" in B1/B2 stories) |
| `pl`, `sg`, `sgm` | Plural nouns: `pl: 1`, singular form with article and its English meaning (used by the article modes) |
| `level` | CEFR level `A1`–`B2` |

Each theme has an `id`, an English `name`, and `pres` / `past` opening lines as `[German, English]` pairs.

`npm test` validates every entry with [`app/js/validate.js`](../app/js/validate.js) (conjugation matches the subject, the word appears in its own sentence, prefixes and auxiliaries are consistent …) and builds thousands of lessons from them. AI-generated words must pass the same validator before they are saved.
