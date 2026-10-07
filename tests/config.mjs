// AI provider configuration: presets, legacy variables, .env editing and schema conversion.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getConfig, updateEnvFile, toJsonSchema, PROVIDERS } from '../server/providers.mjs';
import { report, heading, summary } from './lib.mjs';

const check = (ok, title, detail = '') => report(ok ? 'PASS' : 'FAIL', title, detail);

heading('Provider config');
{
  check(!getConfig({}).configured, 'No settings: offline');
  const legacy = getConfig({ GEMINI_API_KEY: 'a', GEMINI_API_KEYS: 'b,a', GEMINI_MODEL: 'm1' });
  check(legacy.provider === 'gemini' && legacy.apiKeys.join() === 'a,b' && legacy.model === 'm1' && legacy.models.length === 4, 'Old Gemini variables still work (keys merged, default fallbacks)', JSON.stringify(legacy.models));
  const claude = getConfig({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k', GEMINI_API_KEY: 'g' });
  check(claude.configured && claude.driver === 'anthropic' && claude.apiKey === 'k' && claude.model === PROVIDERS.anthropic.model, 'Anthropic uses its own key, never the Gemini one');
  const groq = getConfig({ AI_PROVIDER: 'groq', GROQ_API_KEY: 'k' });
  check(!groq.configured && groq.problem === 'no model' && groq.baseUrl === PROVIDERS.groq.baseUrl, 'Preset fills the base URL; a model is still required', groq.problem);
  const ollama = getConfig({ AI_PROVIDER: 'ollama', AI_MODEL: 'llama3' });
  check(ollama.configured && ollama.apiKeys.length === 1, 'Local providers need no key');
  const oldOpenAi = getConfig({ AI_PROVIDER: 'openai', AI_BASE_URL: 'http://x/v1/', AI_API_KEY: 'k', AI_MODEL: 'm' });
  check(oldOpenAi.configured && oldOpenAi.baseUrl === 'http://x/v1', 'Old OpenAI-compatible variables still work');
  check(getConfig({ AI_PROVIDER: 'none', GEMINI_API_KEY: 'a' }).configured === false, 'AI_PROVIDER=none switches AI off even with a key');
  check(getConfig({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'a', AI_FALLBACK_MODELS: '' }).models.length === 1, 'Empty AI_FALLBACK_MODELS means no fallbacks');
}

heading('.env editing');
{
  const file = join(mkdtempSync(join(tmpdir(), 'wortweg-')), '.env');
  writeFileSync(file, '# my notes\r\nGEMINI_API_KEY=old\r\nPORT=5000\r\nGEMINI_API_KEY=dupe\r\n');
  updateEnvFile(file, { GEMINI_API_KEY: 'new', PORT: '', AI_PROVIDER: 'gemini' });
  const text = readFileSync(file, 'utf8');
  check(text === '# my notes\nGEMINI_API_KEY=new\nAI_PROVIDER=gemini\n', 'Replaces, removes and appends while keeping comments', JSON.stringify(text));
}

heading('Schema conversion');
{
  const converted = toJsonSchema({ type: 'OBJECT', properties: { a: { type: 'ARRAY', items: { type: 'STRING', enum: ['x'] } } }, required: ['a'] });
  check(JSON.stringify(converted) === '{"type":"object","properties":{"a":{"type":"array","items":{"type":"string","enum":["x"]}}},"required":["a"]}', 'Gemini schema → JSON Schema');
}
summary();
