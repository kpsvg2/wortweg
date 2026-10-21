// Phone build: runs server/server.mjs inside the app and routes the page's /api/ requests to it.
import { handler } from './shims/node.js';
import '../server/server.mjs';
import { TextToSpeech, QueueStrategy } from '@capacitor-community/text-to-speech';

function call(method, url, body = '', contentType = '') {
  return new Promise((done) => {
    const request = {
      method, url, headers: { host: 'localhost', 'content-type': contentType }, socket: { remoteAddress: '127.0.0.1' },
      async *[Symbol.asyncIterator]() { if (body) yield body; }
    };
    let status = 200, headers = {};
    handler(request, { writeHead(code, head) { status = code; headers = head; }, end(text) { done({ status, headers, text }); } });
  });
}

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return realFetch(input, init);
  const headers = new Headers(init.headers);
  const result = await call(init.method || 'GET', url.pathname + url.search, init.body || '', headers.get('content-type') || '');
  return new Response(result.text, { status: result.status, headers: result.headers });
};

// Android's WebView has no speechSynthesis; this stand-in covers what app.js uses, backed by the phone's TTS engine.
const voices = [];
const voiceListeners = [];
let pending = 0;
let generation = 0;
window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
window.speechSynthesis = {
  get speaking() { return pending > 0; },
  getVoices: () => voices,
  addEventListener(type, listener) { if (type === 'voiceschanged') voiceListeners.push(listener); },
  cancel() { generation++; pending = 0; TextToSpeech.stop(); },
  speak(utterance) {
    const current = generation;
    pending++;
    const finish = (callback) => () => { if (current !== generation) return; pending--; callback?.(); };
    TextToSpeech.speak({ text: utterance.text, lang: 'de-DE', rate: utterance.rate, queueStrategy: QueueStrategy.Add })
      .then(finish(() => utterance.onend?.()), finish(() => utterance.onerror?.()));
  }
};
TextToSpeech.isLanguageSupported({ lang: 'de-DE' }).then(({ supported }) => {
  if (!supported) return;
  voices.push({ name: 'Google Deutsch', lang: 'de-DE' });
  voiceListeners.forEach(listener => listener());
}).catch(() => {});

// The desktop server serves this script dynamically; the handler answers it synchronously.
call('GET', '/ai-config.js').then(result => new Function(result.text)());
