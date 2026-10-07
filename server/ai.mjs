// AI layer: provider config, prompts, response schemas and a resilient call loop
// (model fallback chain, multiple API keys, per-slot cooldowns on rate limits).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const Mistakes = require('../app/js/mistakes.js');

// Minimal .env reader; real environment variables always win.
export function loadEnvFile(dir) {
  const file = join(dir, '.env');
  if (!existsSync(file)) return false;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || line.trim().startsWith('#')) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
    if (value && process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
  return true;
}

export function getConfig(env = process.env) {
  const geminiKeys = [...new Set([env.GEMINI_API_KEY, env.GEMINI_API_KEYS, env.GOOGLE_API_KEY].flatMap(value => String(value || '').split(',')).map(key => key.trim()).filter(Boolean))];
  const provider = (env.AI_PROVIDER || (geminiKeys.length ? 'gemini' : env.AI_BASE_URL ? 'openai' : '')).toLowerCase();
  if (provider === 'gemini' && geminiKeys.length) {
    const model = env.GEMINI_MODEL || 'gemini-3.8-flash';
    const fallbacks = (env.GEMINI_FALLBACK_MODELS ?? 'gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash')
      .split(',').map(name => name.trim()).filter(name => name && name !== model);
    return { configured: true, provider, apiKey: geminiKeys[0], apiKeys: geminiKeys, model, models: [model, ...fallbacks], thinking: (env.GEMINI_THINKING || 'low').toLowerCase() };
  }
  if (provider === 'openai' && env.AI_BASE_URL && env.AI_API_KEY && env.AI_MODEL) {
    return { configured: true, provider, apiKey: env.AI_API_KEY, model: env.AI_MODEL, baseUrl: env.AI_BASE_URL.replace(/\/$/, '') };
  }
  return { configured: false, provider: provider || null, model: null };
}

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

class AiError extends Error {
  constructor(message, status, retryable = false) { super(message); this.status = status; this.retryable = retryable; }
}

async function callGemini(config, prompt, { temperature, schema }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`;
  const thinking = config.thinking && config.thinking !== 'default' ? { thinkingLevel: config.thinking } : null;
  const request = (withThinking) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature, responseMimeType: 'application/json', responseSchema: schema, ...(withThinking ? { thinkingConfig: thinking } : {}) }
    })
  });
  let response = await request(Boolean(thinking));
  let data = await response.json().catch(() => ({}));
  // Older models reject thinkingConfig; retry once without it.
  if (thinking && response.status === 400 && /thinking/i.test(data?.error?.message || '')) {
    response = await request(false);
    data = await response.json().catch(() => ({}));
  }
  if (!response.ok) {
    const message = String(data?.error?.message || response.statusText).split('\n')[0].replace(/ For more information.*$/, '');
    const retry = (data?.error?.details || []).find(detail => detail.retryDelay)?.retryDelay;
    throw new AiError(`${config.model} ${response.status}: ${message}${retry ? ` (retry in ${retry})` : ''}`, response.status, response.status === 429 || response.status >= 500);
  }
  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts || []).filter(part => !part.thought).map(part => part.text || '').join('');
  if (!text) throw new AiError(`Gemini returned an empty response (finishReason: ${candidate?.finishReason || data.promptFeedback?.blockReason || '?'})`, 502, true);
  return { text, usage: { input: data.usageMetadata?.promptTokenCount, output: data.usageMetadata?.candidatesTokenCount, thinking: data.usageMetadata?.thoughtsTokenCount, total: data.usageMetadata?.totalTokenCount } };
}

async function callOpenAi(config, prompt, { temperature }) {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: config.model, temperature, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new AiError(`AI ${response.status}: ${data?.error?.message || response.statusText}`, response.status, response.status === 429 || response.status >= 500);
  return { text: data.choices?.[0]?.message?.content || '', usage: { input: data.usage?.prompt_tokens, output: data.usage?.completion_tokens, total: data.usage?.total_tokens } };
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
  const call = config.provider === 'gemini' ? callGemini : callOpenAi;
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

export { AiError };

export async function listModels(config) {
  if (config.provider !== 'gemini') return [];
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': config.apiKey } });
  const data = await response.json();
  if (!response.ok) throw new AiError(`Gemini ${response.status}: ${data?.error?.message || response.statusText}`, response.status);
  return (data.models || []).filter(model => (model.supportedGenerationMethods || []).includes('generateContent')).map(model => model.name.replace(/^models\//, ''));
}
