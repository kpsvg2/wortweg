// Mistake tracking and how focus topics feed into AI prompts.
import { Mistakes, SessionLib, report, heading, summary } from './lib.mjs';
import { promptFor } from '../server/ai.mjs';

const wp = (...topics) => topics.map(topic => ({ topic, example: `${topic} example` }));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

heading('Mistake log');
{
  const progress = SessionLib.emptyProgress();
  const found = Mistakes.recordReview(progress, [...wp('perfekt', 'perfekt', 'spelling'), { topic: 'made-up', example: 'x' }], 1);
  report(same(found, ['perfekt', 'spelling']) ? 'PASS' : 'FAIL', 'Invalid topics are dropped, a topic counts once per review', found.join(', '));
  report(progress.mistakes.perfekt.examples.length === 2 ? 'PASS' : 'FAIL', 'Examples are stored', `${progress.mistakes.perfekt.examples.length} examples`);
  report(same(Mistakes.focusTopics(progress, 'A2'), ['perfekt']) ? 'PASS' : 'FAIL', 'A single mistake becomes the next focus; spelling never does', Mistakes.focusTopics(progress, 'A2').join(', '));
  report(Mistakes.focusTopics(progress, 'A1').length === 0 ? 'PASS' : 'FAIL', 'No Perfekt focus at A1');
  Mistakes.recordReview(progress, [], 2);
  report(Mistakes.focusTopics(progress, 'A2').length === 0 ? 'PASS' : 'FAIL', 'A one-off mistake leaves the focus after one clean translation');
}
{
  const progress = SessionLib.emptyProgress();
  Mistakes.recordReview(progress, wp('separable'), 1);
  Mistakes.recordReview(progress, wp('separable', 'article-case'), 2);
  Mistakes.recordReview(progress, wp('separable', 'subclause', 'preposition'), 3);
  const focus = Mistakes.focusTopics(progress, 'B1');
  report(focus.length === 2 && focus[0] === 'separable' ? 'PASS' : 'FAIL', 'At most 2 focus topics; the most frequent comes first', focus.join(', '));
  let lessons = 0;
  while (Mistakes.focusTopics(progress, 'B1').includes('separable')) { Mistakes.recordReview(progress, [], 4 + lessons); lessons++; }
  report(lessons >= 2 && lessons <= 5 ? 'PASS' : 'WARN', 'A persistent mistake leaves the focus after a few clean lessons', `${lessons} clean lessons`);
}

heading('Profile storage');
{
  const raw = { mistakes: { perfekt: { weight: 1.5, count: 2, lastSession: 3, examples: ['a', 5] }, fake: { weight: 9 } } };
  const normalized = Mistakes.normalizeMistakes(SessionLib.normalizeProgress(raw).mistakes);
  report(Object.keys(normalized).join() === 'perfekt' && same(normalized.perfekt.examples, ['a']) ? 'PASS' : 'FAIL', 'Broken entries are cleaned when the profile is read', JSON.stringify(normalized));
}

heading('AI prompts');
{
  const lesson = promptFor({ action: 'generate_lesson', level: 'A2', words: [{ de: 'der Tisch', en: 'table' }], focus: ['perfekt', 'spelling', 'made-up'] });
  report(lesson.includes(Mistakes.TOPICS.perfekt.focus) && !lesson.includes('made-up') ? 'PASS' : 'FAIL', 'Only valid focus topics reach the lesson prompt');
  const plain = promptFor({ action: 'generate_lesson', level: 'A2', words: [{ de: 'der Tisch', en: 'table' }] });
  report(!plain.includes('recently made mistakes') ? 'PASS' : 'FAIL', 'Without focus topics the prompt is unchanged');
  const reviews = ['de-en', 'en-de'].map(direction => promptFor({ action: 'review_translation', direction, level: 'A2', sourceText: 'x', referenceTranslation: 'y', studentTranslation: 'z' }));
  report(reviews.every(text => text.includes('weakPoints') && Mistakes.KEYS.every(key => text.includes(key))) ? 'PASS' : 'FAIL', 'Review prompts list the topic keys in both directions');
}

summary();
