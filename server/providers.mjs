// AI providers: presets, config from environment variables, .env read/write, and one call
// function per API style (Gemini, Anthropic, OpenAI-compatible).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Keys are stored per provider, so switching providers never sends one provider's key to another.
// Each key variable may hold several comma-separated keys; the settings screen saves to the first one.
export const PROVIDERS = {
  gemini: { label: 'Google Gemini', driver: 'gemini', keyVars: ['GEMINI_API_KEY', 'GEMINI_API_KEYS', 'GOOGLE_API_KEY'], model: 'gemini-3.8-flash', fallbacks: ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'], keyUrl: 'https://aistudio.google.com/apikey', note: 'Free tier available.' },
  anthropic: { label: 'Anthropic Claude', driver: 'anthropic', keyVars: ['ANTHROPIC_API_KEY'], model: 'claude-sonnet-5-5', fallbacks: ['claude-haiku-4-5-20251001'], keyUrl: 'https://console.anthropic.com/settings/keys' },
  openai: { label: 'OpenAI', driver: 'openai', baseUrl: 'https://api.openai.com/v1', keyVars: ['OPENAI_API_KEY', 'AI_API_KEY'], keyUrl: 'https://platform.openai.com/api-keys' },
  openrouter: { label: 'OpenRouter', driver: 'openai', baseUrl: 'https://openrouter.ai/api/v1', keyVars: ['OPENROUTER_API_KEY'], keyUrl: 'https://openrouter.ai/keys', note: 'One key for many models, some free.' },
  groq: { label: 'Groq', driver: 'openai', baseUrl: 'https://api.groq.com/openai/v1', keyVars: ['GROQ_API_KEY'], keyUrl: 'https://console.groq.com/keys', note: 'Free tier available.' },
  mistral: { label: 'Mistral', driver: 'openai', baseUrl: 'https://api.mistral.ai/v1', keyVars: ['MISTRAL_API_KEY'], keyUrl: 'https://console.mistral.ai/api-keys' },
  deepseek: { label: 'DeepSeek', driver: 'openai', baseUrl: 'https://api.deepseek.com/v1', keyVars: ['DEEPSEEK_API_KEY'], keyUrl: 'https://platform.deepseek.com/api_keys' },
  ollama: { label: 'Ollama (local)', driver: 'openai', baseUrl: 'http://localhost:11434/v1', keyless: true, note: 'Runs on your computer, no key needed.' },
  lmstudio: { label: 'LM Studio (local)', driver: 'openai', baseUrl: 'http://localhost:1234/v1', keyless: true, note: 'Runs on your computer, no key needed.' },
  custom: { label: 'Other (OpenAI-compatible)', driver: 'openai', keyVars: ['CUSTOM_API_KEY', 'AI_API_KEY'], custom: true }
};

const list = (value) => String(value || '').split(',').map(item => item.trim()).filter(Boolean);
export function keysFor(id, env = process.env) {
  const preset = PROVIDERS[id];
  if (!preset || preset.keyless) return [];
  return [...new Set(preset.keyVars.flatMap(name => list(env[name])))];
}

export function getConfig(env = process.env) {
  let id = String(env.AI_PROVIDER || '').trim().toLowerCase();
  if (id === 'none' || id === 'off') return { configured: false, provider: 'none', model: null };
  // No AI_PROVIDER: use the first provider that has a key (older .env files only had GEMINI_API_KEY).
  if (!id) id = Object.keys(PROVIDERS).find(key => !PROVIDERS[key].custom && keysFor(key, env).length) || (env.AI_BASE_URL ? 'custom' : '');
  if (!id) return { configured: false, provider: null, model: null };
  const preset = PROVIDERS[id];
  if (!preset) return { configured: false, provider: id, model: null, problem: `unknown AI_PROVIDER "${id}"` };
  const keys = preset.keyless ? ['local'] : keysFor(id, env);
  const baseUrl = String(env.AI_BASE_URL || preset.baseUrl || '').replace(/\/+$/, '');
  const model = env.AI_MODEL || (id === 'gemini' && env.GEMINI_MODEL) || preset.model || '';
  const fallbackSetting = env.AI_FALLBACK_MODELS ?? (id === 'gemini' ? env.GEMINI_FALLBACK_MODELS : undefined);
  const fallbacks = (fallbackSetting !== undefined ? list(fallbackSetting) : preset.fallbacks || []).filter(name => name !== model);
  const problem = !keys.length ? 'no API key' : !model ? 'no model' : preset.driver === 'openai' && !baseUrl ? 'no base URL' : null;
  return {
    configured: !problem, problem, provider: id, label: preset.label, driver: preset.driver,
    apiKey: keys[0], apiKeys: keys, model, models: [model, ...fallbacks], baseUrl,
    thinking: String(env.AI_THINKING || env.GEMINI_THINKING || 'low').toLowerCase()
  };
}

// Minimal .env reader; real environment variables always win.
export function loadEnvFile(path) {
  const file = /\.env$/.test(path) ? path : join(path, '.env');
  if (!existsSync(file)) return false;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || line.trim().startsWith('#')) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
    if (value && process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
  return true;
}

// Sets, replaces or (with an empty value) removes variables in a .env file, keeping everything else.
export function updateEnvFile(file, changes) {
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/) : [];
  const done = new Set();
  const out = [];
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match && !line.trim().startsWith('#') && Object.hasOwn(changes, match[1])) {
      if (!done.has(match[1]) && changes[match[1]]) out.push(`${match[1]}=${changes[match[1]]}`);
      done.add(match[1]);
      continue;
    }
    out.push(line);
  }
  while (out.length && out[out.length - 1].trim() === '') out.pop();
  for (const [name, value] of Object.entries(changes)) if (!done.has(name) && value) out.push(`${name}=${value}`);
  writeFileSync(file, out.join('\n') + '\n');
}

export class AiError extends Error {
  constructor(message, status, retryable = false) { super(message); this.status = status; this.retryable = retryable; }
}
const retryable = (status) => status === 429 || status >= 500;
const retryHint = (response) => { const seconds = Number(response.headers.get('retry-after')); return seconds > 0 ? ` (retry in ${seconds}s)` : ''; };

// Response schemas are written in Gemini's dialect (type: 'OBJECT'); other APIs want JSON Schema.
export function toJsonSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'type') out.type = String(value).toLowerCase();
    else if (key === 'properties') out.properties = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, toJsonSchema(child)]));
    else if (key === 'items') out.items = toJsonSchema(value);
    else out[key] = value;
  }
  return out;
}

async function callGemini(config, prompt, { temperature, schema }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`;
  const thinking = config.thinking && config.thinking !== 'default' ? { thinkingLevel: config.thinking } : null;
  const request = (withThinking) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature, responseMimeType: 'application/json', ...(schema ? { responseSchema: schema } : {}), ...(withThinking ? { thinkingConfig: thinking } : {}) }
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
    throw new AiError(`${config.model} ${response.status}: ${message}${retry ? ` (retry in ${retry})` : ''}`, response.status, retryable(response.status));
  }
  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts || []).filter(part => !part.thought).map(part => part.text || '').join('');
  if (!text) throw new AiError(`Gemini returned an empty response (finishReason: ${candidate?.finishReason || data.promptFeedback?.blockReason || '?'})`, 502, true);
  return { text, usage: { input: data.usageMetadata?.promptTokenCount, output: data.usageMetadata?.candidatesTokenCount, thinking: data.usageMetadata?.thoughtsTokenCount, total: data.usageMetadata?.totalTokenCount } };
}

// Claude: a forced tool call guarantees the reply matches the schema.
async function callAnthropic(config, prompt, { temperature, schema }) {
  const tool = { name: 'answer', description: 'Return the result.', input_schema: toJsonSchema(schema || { type: 'OBJECT', properties: {} }) };
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: config.model, max_tokens: 8192, temperature: Math.min(1, temperature), tools: [tool], tool_choice: { type: 'tool', name: 'answer' }, messages: [{ role: 'user', content: prompt }] })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new AiError(`${config.model} ${response.status}: ${data?.error?.message || response.statusText}${retryHint(response)}`, response.status, retryable(response.status));
  const input = (data.content || []).find(part => part.type === 'tool_use')?.input;
  if (!input) throw new AiError(`${config.model}: no structured answer (stop_reason: ${data.stop_reason || '?'})`, 502, true);
  return { text: JSON.stringify(input), usage: { input: data.usage?.input_tokens, output: data.usage?.output_tokens, total: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0) } };
}

async function callOpenAi(config, prompt, { temperature }) {
  const request = (jsonMode) => fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: config.model, temperature, ...(jsonMode ? { response_format: { type: 'json_object' } } : {}), messages: [{ role: 'user', content: prompt }] })
  });
  let response = await request(true);
  let data = await response.json().catch(() => ({}));
  // Some local servers don't support json_object; the prompt asks for JSON anyway.
  if (response.status === 400 && /response_format|json/i.test(data?.error?.message || '')) {
    response = await request(false);
    data = await response.json().catch(() => ({}));
  }
  if (!response.ok) throw new AiError(`${config.model} ${response.status}: ${data?.error?.message || response.statusText}${retryHint(response)}`, response.status, retryable(response.status));
  return { text: data.choices?.[0]?.message?.content || '', usage: { input: data.usage?.prompt_tokens, output: data.usage?.completion_tokens, total: data.usage?.total_tokens } };
}

export const DRIVERS = { gemini: callGemini, anthropic: callAnthropic, openai: callOpenAi };

export async function listModels(config) {
  const fail = async (response) => { const data = await response.json().catch(() => ({})); throw new AiError(`${response.status}: ${data?.error?.message || response.statusText}`, response.status); };
  if (config.driver === 'gemini') {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': config.apiKey } });
    if (!response.ok) await fail(response);
    const data = await response.json();
    return (data.models || []).filter(model => (model.supportedGenerationMethods || []).includes('generateContent')).map(model => model.name.replace(/^models\//, ''));
  }
  const anthropic = config.driver === 'anthropic';
  const response = await fetch(anthropic ? 'https://api.anthropic.com/v1/models?limit=100' : `${config.baseUrl}/models`, {
    headers: anthropic ? { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' } : { Authorization: `Bearer ${config.apiKey}` }
  });
  if (!response.ok) await fail(response);
  const data = await response.json();
  return (data.data || []).map(model => model.id).filter(Boolean).sort();
}
