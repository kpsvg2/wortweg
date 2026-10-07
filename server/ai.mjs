// AI layer: prompts, response schemas and a resilient call loop
// (model fallback chain, multiple API keys, per-slot cooldowns on rate limits).
import { createRequire } from 'node:module';
import { AiError, DRIVERS } from './providers.mjs';

export { AiError, getConfig, loadEnvFile, listModels, PROVIDERS } from './providers.mjs';

const require = createRequire(import.meta.url);
export const Mistakes = require('../app/js/mistakes.js');

// Random scene settings so consecutive lessons don't read alike.
const NARRATORS = ['ich', 'ich', 'wir (ein Paar)', 'eine Kollegin namens Lena', 'mein Nachbar Herr Demir', 'ein Student namens Jonas', 'meine Schwester', 'ein Rentner namens Klaus', 'eine junge Mutter namens Aylin'];
const MOMENTS = ['früh am Morgen', 'in der Mittagspause', 'am späten Nachmittag', 'am Abend', 'am Wochenende', 'an einem regnerischen Montag', 'kurz vor dem Urlaub', 'an einem Feiertag', 'nach einem langen Arbeitstag'];
const TWISTS = ['etwas geht schief und wird gelöst', 'eine unerwartete Begegnung', 'ein kleines Missverständnis', 'eine gute Nachricht', 'Zeitdruck', 'eine Entscheidung muss getroffen werden', 'jemand braucht Hilfe', 'ein Plan ändert sich', 'ein kleiner Erfolg'];
const FORMS = ['Erzählung', 'Tagebucheintrag', 'kurze Nachricht an einen Freund', 'Erzählung mit einem kurzen Dialog', 'Bericht'];

export function pickVariation(random = Math.random) {
  const pick = (list) => list[Math.floor(random() * list.length)];
  return { narrator: pick(NARRATORS), moment: pick(MOMENTS), twist: pick(TWISTS), form: pick(FORMS) };
}

const LESSON_SCHEMA = {
  type: 'OBJECT',
  properties: {
    questions: {
      type: 'ARRAY', minItems: 5, maxItems: 5,
      items: { type: 'OBJECT', properties: { de: { type: 'STRING' }, en: { type: 'STRING' }, wrong: { type: 'ARRAY', minItems: 3, maxItems: 3, items: { type: 'STRING' } } }, required: ['de', 'en', 'wrong'] }
    },
    lesson: {
      type: 'OBJECT',
      properties: {
        de: { type: 'STRING' },
        en: { type: 'STRING' },
        checks: { type: 'ARRAY', items: { type: 'OBJECT', properties: { words: { type: 'ARRAY', items: { type: 'STRING' } }, note: { type: 'STRING' } }, required: ['words', 'note'] } }
      },
      required: ['de', 'en', 'checks']
    }
  },
  required: ['questions', 'lesson']
};
const REVIEW_SCHEMA = {
  type: 'OBJECT',
  properties: {
    score: { type: 'STRING' },
    evaluation: { type: 'STRING' },
    corrections: { type: 'ARRAY', items: { type: 'STRING' } },
    weakPoints: { type: 'ARRAY', items: { type: 'OBJECT', properties: { topic: { type: 'STRING', enum: Mistakes.KEYS }, example: { type: 'STRING' } }, required: ['topic', 'example'] } }
  },
  required: ['score', 'evaluation', 'corrections', 'weakPoints']
};

const TEACHER = 'You are a meticulous teacher of German for English speakers.';
const TOPIC_GUIDE = Mistakes.KEYS.map(key => `${key} = ${Mistakes.TOPICS[key].label}`).join('; ');
function weakPointsRule(direction) {
  const what = direction === 'en-de'
    ? "the student's German mistakes"
    : 'the German structures the student misunderstood (e.g. tense if they got the time wrong, subclause if they mixed up a subordinate clause, separable if they missed a separable verb; meaning if it is not about a structure)';
  return ` weakPoints: tag ${what} with one of these topic keys: ${TOPIC_GUIDE}. One item per real mistake; example = a short "wrong → right" example. Return an empty array if there are no mistakes; do not count style differences or correct solutions that differ from the reference.`;
}
const REVIEW_EXAMPLE = '{"score":"8/10","evaluation":"short explanation in English","corrections":["a concrete mistake by the student and its correction"],"weakPoints":[{"topic":"perfekt","example":"ich habe gefahren → ich bin gefahren"}]}';
function articleBlock(input) {
  const nouns = (Array.isArray(input.artikelNouns) ? input.artikelNouns : [])
    .filter(noun => noun && /^(der|die|das) \S/.test(String(noun.de || '')))
    .slice(0, 2)
    .map(noun => `${noun.de} (${String(noun.en || '').slice(0, 60)})`);
  if (!nouns.length) return '';
  return `\nThe student mixes up the articles of these nouns; also use each of them once in the text, fitting the theme, with the article clearly visible (preferably nominative singular): ${nouns.join('; ')}. These nouns do not replace the 5 target words.`;
}
function focusBlock(input) {
  const keys = (Array.isArray(input.focus) ? input.focus : []).filter(key => Mistakes.isTopic(key) && Mistakes.TOPICS[key].focus).slice(0, 2);
  if (!keys.length) return '';
  return `\nThe student recently made mistakes in these areas; use them naturally and several times in the text, without going above the level: ${keys.map(key => Mistakes.TOPICS[key].focus).join('; ')}.`;
}

const LEVEL_GRAMMAR = 'A1: present tense and main clauses; A2: Perfekt, weil/dass; B1: subordinate clauses, Präteritum, zu + infinitive; B2: Konjunktiv II, passive, nominal style';

export function promptFor(input, context = {}) {
  if (input.action === 'generate_lesson') {
    const avoid = (input.avoidWords || []).slice(0, 60).join(', ') || 'none';
    const words = Array.isArray(input.words) && input.words.length
      ? input.words.map(word => `${word.de} (${word.en})`).join('; ')
      : (input.candidates || []).slice(0, 40).join(', ');
    const v = context.variation || pickVariation();
    const recent = (context.recentLessons || []).filter(Boolean).slice(0, 6);
    const recentBlock = recent.length
      ? ` These texts were written in recent lessons; do NOT repeat their sentences, openings or plots, build completely different sentences:\n${recent.map((text, i) => `${i + 1}) ${text}`).join('\n')}\n`
      : '';
    return `${TEACHER} Grammar level: ${input.level} (${input.grammarFocus || ''}). Theme: ${input.theme || 'everyday life'}.
The words the student will practise in this session have already been chosen for their level: ${words}. The other words in the text must not go above ${input.level} either.
1) Put these 5 words into the questions array in the same order (keep the de field exactly as given); for each, give a natural English meaning (en) and 3 English distractors (wrong) of the same part of speech that are NOT close in meaning.
2) Write a realistic German text of 5-7 sentences on the theme that uses ALL 5 words (lesson.de). lesson.de must be entirely German; not a single English word may slip in. Only the grammar changes with the level (${LEVEL_GRAMMAR}).
Scene for this lesson (build the text around it, avoid stock phrases): narrator/main character: ${v.narrator}; time: ${v.moment}; event: ${v.twist}; form: ${v.form}.
Do not additionally use these words in the text: ${avoid}.${focusBlock(input)}${articleBlock(input)}${recentBlock}
3) lesson.en: a natural English translation of the text. lesson.checks: one item per target word; words = English word starts that must appear in the student's translation (lower case, e.g. "get up", "alarm"), note = a short English note on the word's meaning in the text and the grammar point to watch.
Return JSON only: {"questions":[{"de":"","en":"","wrong":["","",""]}],"lesson":{"de":"","en":"","checks":[{"words":[""],"note":""}]}}`;
  }
  if (input.direction === 'en-de') {
    return `${TEACHER} Level: ${input.level}. The student translated an English text INTO GERMAN. Original English: ${input.sourceText}. Reference German: ${input.referenceTranslation}. Student's German translation: ${input.studentTranslation}. Judge whether the meaning came across and check the German grammar (verb form and position, articles and cases, word choice, spelling, capitalisation); accept correct solutions that differ from the reference. Give feedback in English; in corrections, show the student's wrong German phrase and the correct one.${weakPointsRule('en-de')} Return only this JSON shape: ${REVIEW_EXAMPLE}.`;
  }
  return `${TEACHER} Level: ${input.level}. Original German: ${input.sourceText}. Reference English: ${input.referenceTranslation}. Student's translation: ${input.studentTranslation}. Give constructive, meaning-focused feedback in English.${weakPointsRule('de-en')} Return only this JSON shape: ${REVIEW_EXAMPLE}.`;
}

function validateLesson(result, input) {
  if (!result || !Array.isArray(result.questions) || !result.lesson?.de || !result.lesson?.en) throw new AiError('Response is missing questions/lesson fields.', 422, true);
  const requested = (input.words || []).map(word => word.de);
  if (requested.length) {
    const byDe = new Map(result.questions.map(question => [String(question.de || '').trim(), question]));
    const missing = requested.filter(de => !byDe.has(de));
    if (missing.length) throw new AiError(`Model did not return these words in questions: ${missing.join(', ')}`, 422, true);
    result.questions = requested.map(de => byDe.get(de));
  }
  const english = findEnglish(result.lesson.de);
  if (english.length) throw new AiError(`English leaked into the German text: ${english.slice(0, 4).join(', ')}`, 422, true);
  return result;
}

// Cheap leak detector: common English function words never appear in German prose.
const ENGLISH_WORDS = new Set(['the', 'and', 'with', 'this', 'that', 'very', 'but', 'then', 'of', 'is', 'are', 'were', 'my', 'your', 'you', 'it', 'to', 'for']);
export function findEnglish(text) {
  return String(text).split(/[^\p{L}]+/u).filter(word => ENGLISH_WORDS.has(word.toLowerCase()));
}

const cooldownUntil = new Map();
function retryDelayMs(message) {
  const match = /\(retry in (\d+(?:\.\d+)?)s\)/.exec(message);
  return match ? Math.ceil(Number(match[1]) * 1000) : null;
}
// A "slot" is one model + one API key; rate-limited slots cool down and are tried last.
const slotId = (slot) => `${slot.keyIndex}:${slot.model}`;
function orderedSlots(config) {
  const now = Date.now();
  const models = config.models || [config.model];
  const keys = config.apiKeys || [config.apiKey];
  const slots = models.flatMap(model => keys.map((apiKey, keyIndex) => ({ model, apiKey, keyIndex })));
  const ready = slots.filter(slot => (cooldownUntil.get(slotId(slot)) || 0) <= now);
  const cooling = slots.filter(slot => (cooldownUntil.get(slotId(slot)) || 0) > now);
  return [...ready, ...cooling];
}
function coolDown(config, slot, status, message) {
  if (status === 429) {
    cooldownUntil.set(slotId(slot), Date.now() + (retryDelayMs(message) || 60000));
    return;
  }
  // A 5xx means the model itself is overloaded, so every key for it cools down.
  const until = Date.now() + 120000;
  (config.apiKeys || [config.apiKey]).forEach((_, keyIndex) => cooldownUntil.set(slotId({ model: slot.model, keyIndex }), until));
}

export async function runAi(config, input, context = {}) {
  const isLesson = input.action === 'generate_lesson';
  const variation = isLesson ? (context.variation || pickVariation()) : undefined;
  const result = await callModel(config, {
    prompt: promptFor(input, { ...context, variation }),
    schema: isLesson ? LESSON_SCHEMA : REVIEW_SCHEMA,
    temperature: isLesson ? 1.0 : 0.3,
    validate: (data, model) => {
      if (isLesson) validateLesson(data, input);
      else {
        if (!data.score || !data.evaluation || !Array.isArray(data.corrections)) throw new AiError(`${model}: review response is missing fields.`, 422, true);
        data.weakPoints = Mistakes.cleanWeakPoints(data.weakPoints);
      }
      return data;
    }
  });
  if (variation) result._meta.variation = variation;
  return result;
}

export async function callModel(config, { prompt, schema, temperature, validate }) {
  if (!config.configured) throw new AiError('AI is not configured (see .env.example).', 503);
  const call = DRIVERS[config.driver];
  const started = Date.now();
  const errors = [];
  let attempts = 0;
  for (let round = 1; round <= 2; round++) {
    let allBusy = true;
    const multiKey = (config.apiKeys || []).length > 1;
    const slots = orderedSlots(config);
    const coolingAtStart = new Set(slots.filter(slot => (cooldownUntil.get(slotId(slot)) || 0) > Date.now()).map(slotId));
    for (const slot of slots) {
      const { model } = slot;
      if (!coolingAtStart.has(slotId(slot)) && (cooldownUntil.get(slotId(slot)) || 0) > Date.now()) continue;
      const label = multiKey ? `${model} (key ${slot.keyIndex + 1})` : model;
      const modelConfig = { ...config, model, apiKey: slot.apiKey };
      for (let attempt = 1; attempt <= 2; attempt++) {
        attempts++;
        try {
          const { text, usage } = await call(modelConfig, prompt, { temperature, schema });
          let data;
          try { data = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')); }
          catch { throw new AiError(`${model}: did not return valid JSON.`, 422, true); }
          const result = validate ? validate(data, model) : data;
          result._meta = { source: 'ai', provider: config.provider, model, ...(multiKey ? { key: slot.keyIndex + 1 } : {}), ms: Date.now() - started, attempts, usage, ...(errors.length ? { recovered: errors } : {}) };
          return result;
        } catch (error) {
          const err = error instanceof AiError ? error : new AiError(`${model}: ${error.message}`, 502, true);
          errors.push(multiKey ? err.message.replace(model, label) : err.message);
          if (!err.retryable) throw err;
          if (err.status < 500) allBusy = false;
          if (err.status === 429 || err.status >= 500) {
            coolDown(config, slot, err.status, err.message);
            break;
          }
        }
      }
    }
    // Every slot was rate-limited or overloaded: wait briefly and try one more round.
    if (!allBusy || round === 2) break;
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw new AiError(errors.length > 1 ? `All models failed: ${errors.join(' | ')}` : errors[0], 502);
}

// One tiny request per key with the main model; used by the settings screen's "Test" button.
export async function testConnection(config) {
  const call = DRIVERS[config.driver];
  const schema = { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } }, required: ['ok'] };
  const results = [];
  for (const [index, apiKey] of config.apiKeys.entries()) {
    const started = Date.now();
    try {
      const { text } = await call({ ...config, apiKey }, 'Reply with the JSON object {"ok": true}.', { temperature: 0, schema });
      JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
      results.push({ key: index + 1, ok: true, ms: Date.now() - started });
    } catch (error) { results.push({ key: index + 1, ok: false, error: error.message }); }
  }
  return results;
}