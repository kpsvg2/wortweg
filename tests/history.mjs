// Analyses your real usage (data/profiles/*/ai-log.jsonl and progress.json): AI reliability, repetition, spacing.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectRoot, report, heading, summary, pct, sentences, normalizeSentence, ngrams, jaccard } from './lib.mjs';

const profilesDir = join(projectRoot, 'data', 'profiles');
const envs = existsSync(profilesDir) ? readdirSync(profilesDir).filter(name => name.startsWith('env-')) : [];
if (!envs.length) { console.log('No profile yet. Use the app a few times (npm start) and run this again.'); process.exit(0); }

for (const env of envs) {
  const dir = join(profilesDir, env);
  heading(`Profile ${env}`);
  const logPath = join(dir, 'ai-log.jsonl');
  const entries = existsSync(logPath) ? readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean) : [];
  const lessons = entries.filter(e => e.action === 'generate_lesson');
  const okLessons = lessons.filter(e => e.ok && e.lessonDe);
  const failed = entries.filter(e => !e.ok);

  if (!entries.length) report('INFO', 'AI log is empty', 'No AI lessons generated yet.');
  else {
    const failRate = failed.length / entries.length;
    report(failRate === 0 ? 'PASS' : failRate < 0.1 ? 'WARN' : 'FAIL', 'AI calls succeed', `${entries.length - failed.length}/${entries.length} succeeded${failed.length ? ' · last error: ' + failed[failed.length - 1].error : ''}`);
    const ms = okLessons.map(e => e.meta?.ms).filter(Boolean).sort((a, b) => a - b);
    if (ms.length) report('INFO', 'Lesson generation time', `median ${(ms[Math.floor(ms.length / 2)] / 1000).toFixed(1)} s, longest ${(ms[ms.length - 1] / 1000).toFixed(1)} s`);
    const totalTokens = entries.reduce((sum, e) => sum + (e.meta?.usage?.total || 0), 0);
    report('INFO', 'Total tokens', `${totalTokens} (${entries.length} calls)`);
  }

  if (okLessons.length >= 2) {
    const seen = new Map();
    const dupes = [];
    okLessons.forEach((lesson, i) => sentences(lesson.lessonDe).map(normalizeSentence).filter(s => s.split(' ').length >= 5).forEach(s => {
      if (seen.has(s) && seen.get(s) !== i) dupes.push(s); else seen.set(s, i);
    }));
    report(dupes.length === 0 ? 'PASS' : 'WARN', 'No repeated sentences across real lessons (5+ words)', dupes.length ? `${dupes.length} repeats, e.g. "${dupes[0]}"` : `${okLessons.length} lessons checked`);
    const sims = [];
    for (let i = 1; i < okLessons.length; i++) for (let j = Math.max(0, i - 5); j < i; j++) sims.push(jaccard(ngrams(okLessons[i].lessonDe), ngrams(okLessons[j].lessonDe)));
    const maxSim = Math.max(...sims);
    report(maxSim < 0.15 ? 'PASS' : maxSim < 0.3 ? 'WARN' : 'FAIL', 'Nearby lessons do not look alike', `highest overlap ${pct(maxSim)}`);
  }

  const progressPath = join(dir, 'progress.json');
  if (existsSync(progressPath)) {
    const progress = JSON.parse(readFileSync(progressPath, 'utf8'));
    const sessionsLog = lessons.filter(e => e.ok && Array.isArray(e.words)).map(e => e.words);
    const recent = progress.recentSessions || [];
    const history = sessionsLog.length >= recent.length ? sessionsLog : [...recent].reverse();
    const lastAt = new Map(); const gaps = [];
    history.forEach((words, s) => words.forEach(w => { if (lastAt.has(w)) gaps.push(s - lastAt.get(w)); lastAt.set(w, s); }));
    const words = Object.values(progress.words || {});
    const by = (st) => words.filter(w => w.status === st).length;
    report('INFO', 'Word status', `${words.filter(w => w.seen).length} words seen · ${by('known')} known · ${by('learning')} learning · ${by('unknown')} to review`);
    if (history.length >= 3) {
      const quick = gaps.filter(g => g <= 2).length;
      report(quick === 0 ? 'PASS' : 'WARN', 'Words do not come back within 1-2 sessions', `${history.length} sessions, ${gaps.length} repeats, ${quick} of them ≤2 sessions apart`);
    }
    const maxSeen = words.reduce((m, w) => Math.max(m, w.seen || 0), 0);
    if (maxSeen) report('INFO', 'Most seen word', `${maxSeen} times: ${Object.entries(progress.words).filter(([, w]) => w.seen === maxSeen).map(([k]) => k).slice(0, 5).join(', ')}`);
  }
}
summary();
