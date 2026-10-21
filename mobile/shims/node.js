// Browser stand-ins for the few Node built-ins the server uses (module, vm, http, crypto, os, url).
import { readFileSync } from './fs.js';
import path from 'path-browserify';

const cache = {};
export function createRequire(base) {
  const dir = path.dirname(fileURLToPath(base));
  return (file) => {
    const full = path.resolve(dir, file);
    if (!cache[full]) {
      const module = { exports: {} };
      new Function('module', 'exports', readFileSync(full))(module, module.exports);
      cache[full] = module.exports;
    }
    return cache[full];
  };
}

export const createContext = (context) => context;
export const runInContext = (code, context) => new Function('window', code)(context.window);

export let handler = null;
export function createServer(fn) {
  handler = fn;
  return { on() {}, listen(port, host, ready) { ready(); } };
}

export const createHash = () => ({ update() { return this; }, digest: () => 'phone0000000' });
export const hostname = () => 'phone';
export const fileURLToPath = (url) => decodeURIComponent(new URL(url).pathname);

export default { createRequire, createContext, runInContext, createServer, createHash, hostname, fileURLToPath };
