// Tags the optional Goethe word list (data/goethe/wordlist.json) with themes in one go.
// Usage: npm run goethe:tags [-- --batches 5]   (resumes where it stopped)
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile, getConfig } from './ai.mjs';
import { loadAssets } from './vocab-expand.mjs';
import { tagThemes, untaggedCount, WORDLIST_PATH } from './goethe.mjs';

const projectRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
loadEnvFile(projectRoot);
const config = getConfig();
if (!config.configured) { console.error('AI is not configured (.env).'); process.exit(2); }
const assets = loadAssets(join(projectRoot, 'app'));
const { goethe } = assets;
if (!goethe) { console.error(`No word list found at ${WORDLIST_PATH}. See docs/GOETHE.md.`); process.exit(2); }
const argIndex = process.argv.indexOf('--batches');
const maxBatches = argIndex > -1 ? Number(process.argv[argIndex + 1]) : Infinity;

console.log(`Goethe list: A1 ${goethe.levels.A1.length} · A2 ${goethe.levels.A2.length} · B1 ${goethe.levels.B1.length} · untagged ${untaggedCount(goethe)}`);
try {
  const result = await tagThemes(config, { goethe, themes: assets.themes, log: line => console.log(`  ${line}`), maxBatches });
  console.log(result.done ? 'Theme tags complete.' : `Theme tags incomplete, ${result.remaining} left. Run the script again to continue.`);
} catch (error) {
  console.error(`Theme tagging stopped: ${error.message}. Run the script again to continue.`);
  process.exitCode = 1;
}
