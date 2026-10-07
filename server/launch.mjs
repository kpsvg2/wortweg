// Double-click entry point: starts the server in the background if needed, then opens the browser.
import { spawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = resolve(fileURLToPath(new URL('.', import.meta.url)));
const projectRoot = resolve(serverDir, '..');
const port = Number(process.env.PORT || 4173);
const url = `http://localhost:${port}`;

async function alive() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/ai/status`, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch { return false; }
}

if (!(await alive())) {
  mkdirSync(join(projectRoot, 'data'), { recursive: true });
  const log = openSync(join(projectRoot, 'data', 'server.log'), 'w');
  const child = spawn(process.execPath, [join(serverDir, 'server.mjs')], { cwd: projectRoot, detached: true, windowsHide: true, stdio: ['ignore', log, log] });
  child.unref();
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) { await new Promise(r => setTimeout(r, 250)); ready = await alive(); }
  if (!ready) {
    console.error(`Could not start the Wortweg server. See data\\server.log for details.`);
    process.exit(1);
  }
}

if (!process.env.WORTWEG_NO_BROWSER) {
  const [command, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
  spawn(command, args, { detached: true, windowsHide: true, stdio: 'ignore' }).on('error', () => {}).unref();
}
console.log(`Wortweg is running: ${url}`);
