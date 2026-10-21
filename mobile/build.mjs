// Builds the Android app: app/ + the bundled server (with the keys from .env) -> Desktop\Wortweg.apk
import { build } from 'esbuild';
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, copyFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const here = resolve(import.meta.dirname);
const project = resolve(here, '..');
const www = join(here, 'www');
const shim = (file) => join(here, 'shims', file);
const SEED = ['.env', 'app/js/articles.js', 'app/js/mistakes.js', 'app/js/engine.js', 'app/js/validate.js', 'app/data/vocabulary.js', 'app/data/vocabulary.tr.js','server/levels.cjs', 'data/goethe/wordlist.json', 'data/goethe/tags.json'];

rmSync(www, { recursive: true, force: true });
cpSync(join(project, 'app'), www, { recursive: true });

await build({
  entryPoints: [join(here, 'entry.js')],
  outfile: join(www, 'ai-config.js'),
  bundle: true,
  format: 'iife',
  banner: { js: "var process = { env: { IDLE_MINUTES: '0' }, exit() {}, cwd: () => '/w' };" },
  define: { 'import.meta.url': '"file:///w/server/server.mjs"' },
  alias: { 'node:fs': shim('fs.js'), 'node:fs/promises': shim('fs.js'), 'node:path': 'path-browserify', 'node:module': shim('node.js'), 'node:vm': shim('node.js'), 'node:http': shim('node.js'), 'node:crypto': shim('node.js'), 'node:os': shim('node.js'), 'node:url': shim('node.js') },
  plugins: [{
    name: 'wortweg',
    setup(b) {
      b.onResolve({ filter: /^virtual:seed$/ }, () => ({ path: 'seed', namespace: 'seed' }));
      b.onLoad({ filter: /.*/, namespace: 'seed' }, () => {
        const files = Object.fromEntries(SEED.filter(file => existsSync(join(project, file))).map(file => [`/w/${file}`, readFileSync(join(project, file), 'utf8')]));
        return { contents: `export default ${JSON.stringify(files)};`, loader: 'js' };
      });
      // A classic script can't use top-level await; ensureProfile() is idempotent and every reader calls it again.
      b.onLoad({ filter: /server[\\/]server\.mjs$/ }, (args) => ({ contents: readFileSync(args.path, 'utf8').replace('\nawait ensureProfile();', '\nensureProfile();'), loader: 'js' }));
    }
  }]
});
if (!process.argv.includes('--apk')) process.exit(0);

const tools = join(homedir(), 'Android');
process.env.ANDROID_HOME ||= join(tools, 'sdk');
process.env.JAVA_HOME = join(tools, readdirSync(tools).find(name => name.startsWith('jdk-21')));
const run = (cmd, cwd = here) => execSync(cmd, { cwd, stdio: 'inherit' });
if (!existsSync(join(here, 'android'))) run('npx cap add android');
run('npx cap sync android');
const res = join(here, 'android', 'app', 'src', 'main', 'res');
rmSync(join(res, 'mipmap-anydpi-v26'), { recursive: true, force: true });
for (const dir of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) for (const name of ['ic_launcher.png', 'ic_launcher_round.png']) copyFileSync(join(project, 'app', 'icons', 'icon-192.png'), join(res, `mipmap-${dir}`, name));
run('.\\gradlew.bat assembleDebug', join(here, 'android'));
copyFileSync(join(here, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'), join(homedir(), 'Desktop', 'Wortweg.apk'));
console.log('Done: Desktop\\Wortweg.apk');
