// Tracks which grammar topics the learner keeps getting wrong, so the next AI texts can focus on them.
(function (root) {
  const LEVELS = ['A1', 'A2', 'B1', 'B2'];
  const DECAY = 0.75;
  const FOCUS_THRESHOLD = 0.9;
  const FOCUS_LIMIT = 2;
  const EXAMPLE_LIMIT = 3;

  const TOPICS = {
    'verb-position': { label: 'Verb position (2nd in main clauses, last in subclauses)', focus: 'mehrere Haupt- und Nebensätze, in denen das konjugierte Verb deutlich an zweiter Stelle bzw. am Satzende steht; Sätze, die mit einer Zeitangabe beginnen (Heute gehe ich …)', min: 'A1' },
    conjugation: { label: 'Verb conjugation', focus: 'verschiedene Subjekte (ich, du, er/sie, wir, ihr, sie), damit viele unterschiedliche Verbformen vorkommen', min: 'A1' },
    separable: { label: 'Separable verbs', focus: 'mindestens zwei trennbare Verben (z. B. anrufen, einkaufen, aufstehen), im Hauptsatz getrennt', min: 'A1' },
    'article-case': { label: 'Articles and cases (nominative/accusative/dative)', focus: 'mehrere Nomen im Akkusativ und Dativ mit deutlich sichtbaren Artikeln (den, dem, einen, einem, der)', min: 'A1' },
    preposition: { label: 'Prepositions', focus: 'häufige Präpositionen mit festem Kasus (mit, zu, bei, für, ohne, aus, in/auf + Akkusativ oder Dativ)', min: 'A1' },
    perfekt: { label: 'Perfect tense (haben/sein + past participle)', focus: 'Perfekt-Formen mit haben UND mit sein (z. B. ist gefahren, hat gekauft)', min: 'A2' },
    tense: { label: 'Choice of tense', focus: 'einen deutlichen Wechsel zwischen Gegenwart und Vergangenheit mit klaren Zeitsignalen', min: 'A2' },
    subclause: { label: 'Subordinate clauses (weil, dass, wenn, obwohl …)', focus: 'mehrere Nebensätze mit weil, dass, wenn oder obwohl', min: 'A2' },
    adjective: { label: 'Adjective endings', focus: 'Adjektive vor Nomen mit unterschiedlichen Endungen (ein großer Tisch, mit dem neuen Auto)', min: 'A2' },
    'word-choice': { label: 'Word choice', focus: null, min: 'A1' },
    spelling: { label: 'Spelling and capitalisation', focus: null, min: 'A1' },
    meaning: { label: 'Getting the meaning across', focus: null, min: 'A1' }
  };
  const KEYS = Object.keys(TOPICS);

  function isTopic(key) { return Object.prototype.hasOwnProperty.call(TOPICS, key); }
  function label(key) { return isTopic(key) ? TOPICS[key].label : key; }

  function cleanWeakPoints(list) {
    if (!Array.isArray(list)) return [];
    return list
      .filter(item => item && isTopic(item.topic))
      .map(item => ({ topic: item.topic, example: String(item.example || '').trim().slice(0, 200) }));
  }

  function recordReview(progress, weakPoints, sessionCount = 0) {
    const mistakes = progress.mistakes && typeof progress.mistakes === 'object' ? progress.mistakes : {};
    Object.keys(mistakes).forEach(key => {
      mistakes[key].weight = (mistakes[key].weight || 0) * DECAY;
      if (mistakes[key].weight < 0.1) mistakes[key].weight = 0;
    });
    const byTopic = new Map();
    cleanWeakPoints(weakPoints).forEach(item => {
      if (!byTopic.has(item.topic)) byTopic.set(item.topic, []);
      if (item.example) byTopic.get(item.topic).push(item.example);
    });
    byTopic.forEach((examples, topic) => {
      const entry = mistakes[topic] || { weight: 0, count: 0, examples: [] };
      entry.weight = (entry.weight || 0) + 1;
      entry.count = (entry.count || 0) + 1;
      entry.lastSession = sessionCount;
      entry.examples = [...examples, ...(entry.examples || [])].slice(0, EXAMPLE_LIMIT);
      mistakes[topic] = entry;
    });
    progress.mistakes = mistakes;
    return [...byTopic.keys()];
  }

  function focusTopics(progress, level, limit = FOCUS_LIMIT) {
    const levelIndex = LEVELS.indexOf(level);
    return Object.entries(progress?.mistakes || {})
      .filter(([key, entry]) => isTopic(key) && TOPICS[key].focus && (entry.weight || 0) >= FOCUS_THRESHOLD && LEVELS.indexOf(TOPICS[key].min) <= levelIndex)
      .sort((a, b) => b[1].weight - a[1].weight)
      .slice(0, limit)
      .map(([key]) => key);
  }

  function normalizeMistakes(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out = {};
    Object.entries(raw).forEach(([key, entry]) => {
      if (!isTopic(key) || !entry || typeof entry !== 'object') return;
      out[key] = {
        weight: Number.isFinite(entry.weight) ? Math.max(0, entry.weight) : 0,
        count: Number.isInteger(entry.count) ? entry.count : 0,
        lastSession: Number.isInteger(entry.lastSession) ? entry.lastSession : 0,
        examples: Array.isArray(entry.examples) ? entry.examples.filter(x => typeof x === 'string').slice(0, EXAMPLE_LIMIT) : []
      };
    });
    return out;
  }

  const api = { TOPICS, KEYS, DECAY, FOCUS_THRESHOLD, isTopic, label, cleanWeakPoints, recordReview, focusTopics, normalizeMistakes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WortwegMistakes = api;
})(typeof window !== 'undefined' ? window : globalThis);
