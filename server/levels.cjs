// CEFR level lookup against the (optional) Goethe-Institut word lists in data/goethe/.
const LEVELS = ['A1', 'A2', 'B1', 'B2'];
const LISTED = ['A1', 'A2', 'B1'];
const SKIP = new Set(['der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'sich', 'zu', 'zum', 'zur', 'am', 'im', 'in', 'an', 'auf', 'mit', 'von', 'nach', 'bei', 'aus', 'für', 'um', 'gehen']);
const UMLAUT = { ä: 'a', ö: 'o', ü: 'u' };

function rank(level) { return LEVELS.indexOf(level); }
function isLevel(level) { return LEVELS.includes(level); }
function lemmaKey(word) {
  return String(word || '').toLowerCase().replace(/^(der|die|das)(\/(der|die|das))?\s+/, '').replace(/^(sich|den)\s+/, '').trim();
}
function allows(wordLevel, level) { return !level || rank(wordLevel) <= rank(level); }
function higher(a, b) { return rank(a) >= rank(b) ? a : b; }
function forms(key) {
  const out = [key];
  if (key.length > 5 && key.endsWith('in')) out.push(key.slice(0, -2));
  if (key.length > 5 && key.endsWith('innen')) out.push(key.slice(0, -5));
  for (const end of ['en', 'n', 'e']) if (key.length > 4 && key.endsWith(end)) out.push(key.slice(0, -end.length));
  out.slice().forEach(form => { const plain = form.replace(/[äöü]/, char => UMLAUT[char]); if (plain !== form) out.push(plain); });
  return out;
}

function create(goethe) {
  const map = new Map();
  const levels = (goethe && goethe.levels) || {};
  LISTED.forEach(level => (levels[level] || []).forEach(w => { const key = lemmaKey(w); if (key && !map.has(key)) map.set(key, level); }));

  function feminineBase(key) {
    const base = key.replace(/(innen|in)$/, '');
    if (base === key || base.length < 3) return null;
    return [base, base.replace(/[äöü]/, char => UMLAUT[char])].find(form => map.has(form)) || null;
  }
  function single(key) {
    const base = feminineBase(key);
    if (map.has(key)) return base && rank(map.get(base)) < rank(map.get(key)) ? map.get(base) : map.get(key);
    if (base) return map.get(base);
    for (const form of forms(key).slice(1)) if (map.has(form)) return map.get(form);
    return null;
  }
  function listLevel(w) {
    const key = lemmaKey(w);
    if (!key) return null;
    const direct = single(key);
    if (direct) return direct;
    const parts = key.split(/\s+/).filter(part => part.length > 2 && !SKIP.has(part));
    if (!key.includes(' ') || !parts.length) return null;
    let level = 'A1';
    for (const part of parts) { const found = single(part); if (!found) return null; level = higher(level, found); }
    return level;
  }
  function levelOf(word) {
    if (!word) return 'B2';
    const listed = listLevel(word.w);
    if (listed) return listed;
    return isLevel(word.level) ? word.level : 'B2';
  }
  function entries(level) { return (levels[level] || []).slice(); }
  return { levelOf, listLevel, entries, size: map.size };
}

module.exports = { LEVELS, LISTED, rank, isLevel, lemmaKey, allows, create };
