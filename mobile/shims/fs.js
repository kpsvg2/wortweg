// Virtual file system for the phone build: bundled files are read-only seeds, writes go to localStorage.
import seed from 'virtual:seed';

const KEY = 'wortweg-fs:';
const MAX_LOG_LINES = 300;
const local = (path) => { try { return localStorage.getItem(KEY + path); } catch { return null; } };
const notFound = (path) => Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });

export function existsSync(path) { return local(path) !== null || path in seed || Object.keys(seed).some(file => file.startsWith(path + '/')); }
export function readFileSync(path) {
  const text = local(path) ?? seed[path];
  if (text === undefined) throw notFound(path);
  return text;
}
export function writeFileSync(path, text) { localStorage.setItem(KEY + path, String(text)); }

export const promises = {
  mkdir: async () => {},
  access: async (path) => { if (!existsSync(path)) throw notFound(path); },
  readFile: async (path) => readFileSync(path),
  writeFile: async (path, text) => writeFileSync(path, text),
  // ponytail: keeps only the last 300 log lines so localStorage (≈5 MB) never fills up; the server only reads the last few.
  appendFile: async (path, text) => {
    const lines = ((local(path) ?? '') + text).split('\n');
    writeFileSync(path, lines.slice(-MAX_LOG_LINES - 1).join('\n'));
  }
};
export const { mkdir, access, readFile, writeFile, appendFile } = promises;
export default { existsSync, readFileSync, writeFileSync, promises };
