// Verse picking and dates. No DOM in here, so it can be tested on its own.

export const DEFAULTS = {
  source: 'popular',      // popular | meaningful | topics | any | surah | favorites
  topics: ['hope'],
  surah: 67,
  order: 'shuffle',       // shuffle | ordered
  longer: false,
  every: 1,               // days each verse stays
  length: 7,              // days to make ahead. 366 = a whole year that repeats
  seed: 1,
  anchor: '',             // first day of the schedule
  pin: '',
  overrides: {},          // first day of a period -> verse
  favorites: [],

  theme: 'dusk',
  color1: '#24324a',
  color2: '#101722',
  dim: 40,
  blur: 0,

  show: 'both',           // both | ar | en
  arFont: 'amiri',
  enFont: 'garamond',
  arSize: 100,
  enSize: 100,
  position: 0,
  reference: true,
  divider: true,
  arColor: '',            // '' = the design's own color
  enColor: '',
  accent: '',
  screen: 'auto',
};

const ALLOWED = {
  source: ['popular', 'meaningful', 'topics', 'any', 'surah', 'favorites'],
  order: ['shuffle', 'ordered'],
  theme: ['midnight', 'dusk', 'emerald', 'sand', 'black', 'color', 'photo'],
  show: ['both', 'ar', 'en'],
  arFont: ['amiri', 'scheherazade'],
  enFont: ['garamond', 'inter', 'system'],
};
const RANGES = {
  surah: [1, 114], every: [1, 90], length: [1, 366], dim: [0, 90], blur: [0, 100],
  arSize: [60, 125], enSize: [70, 125], position: [-100, 100], seed: [1, 4294967295],
};

/** Accept only well-formed settings (saved copies and restored backups go through this). */
export function cleanSettings(raw, data) {
  const out = structuredClone(DEFAULTS);
  if (!raw || typeof raw !== 'object') return out;
  const validRef = (r) => typeof r === 'string' && /^\d+:\d+$/.test(r) && !!getVerse(data, r);
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    const value = raw[key];
    if (ALLOWED[key]) {
      if (ALLOWED[key].includes(value)) out[key] = value;
    } else if (RANGES[key]) {
      if (Number.isFinite(value)) out[key] = clamp(Math.round(value), ...RANGES[key]);
    } else if (typeof fallback === 'boolean') {
      if (typeof value === 'boolean') out[key] = value;
    }
  }
  if (/^\d{4}-\d\d-\d\d$/.test(raw.anchor)) out.anchor = raw.anchor;
  if (validRef(raw.pin)) out.pin = raw.pin;
  if (raw.screen === 'auto' || /^\d{3}x\d{3,4}x[23]$/.test(raw.screen)) out.screen = raw.screen;
  if (Array.isArray(raw.topics)) out.topics = raw.topics.filter((t) => Object.hasOwn(data.sets.topics, t));
  if (Array.isArray(raw.favorites)) out.favorites = [...new Set(raw.favorites.filter(validRef))];
  for (const key of ['color1', 'color2', 'arColor', 'enColor', 'accent']) {
    if (/^#[0-9a-f]{6}$/i.test(raw[key])) out[key] = raw[key];
  }
  if (raw.overrides && typeof raw.overrides === 'object') {
    for (const [day, ref] of Object.entries(raw.overrides)) {
      if (/^\d{4}-\d\d-\d\d$/.test(day) && validRef(ref)) out.overrides[day] = ref;
    }
  }
  return out;
}

export function clamp(n, low, high) {
  return Math.min(high, Math.max(low, n));
}

export function getVerse(data, ref) {
  const [s, v] = ref.split(':').map(Number);
  const surah = data.surahs[s - 1];
  const verse = surah?.verses[v - 1];
  return verse ? { ref, surah: surah.name, ar: displayArabic(s, v, verse[0]), en: verse[1] } : null;
}

/** The stored text is verbatim. The basmala joined onto verse 1 is separated here, for display only. */
export function displayArabic(s, v, stored) {
  const text = stored.replace(/^\uFEFF/, '').trim();
  if (v !== 1 || s === 1 || s === 9) return text;
  return text.split(' ').slice(4).join(' ');
}

function byQuranOrder(a, b) {
  const [s1, v1] = a.split(':').map(Number);
  const [s2, v2] = b.split(':').map(Number);
  return s1 - s2 || v1 - v2;
}

export function buildPool(data, s) {
  const { popular, topics } = data.sets;
  const limit = s.longer ? [220, 300] : [120, 160];
  const fromSurah = (number) => data.surahs[number - 1].verses.flatMap(([ar, en], i) => {
    const short = displayArabic(number, i + 1, ar).length <= limit[0] && en.length <= limit[1];
    return short ? [`${number}:${i + 1}`] : [];
  });

  let refs;
  switch (s.source) {
    case 'meaningful': refs = Object.values(topics).flatMap((t) => t.refs); break;
    case 'topics': refs = s.topics.flatMap((t) => topics[t].refs); break;
    case 'any': refs = data.surahs.flatMap((_, i) => fromSurah(i + 1)); break;
    case 'surah': refs = fromSurah(s.surah); break;
    case 'favorites': refs = s.favorites; break;
    default: refs = popular;
  }
  return [...new Set(refs)].sort(byQuranOrder);
}

function random(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(list, seed) {
  const next = random(seed);
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Dates are whole local days, handled as day numbers so daylight saving can't shift them.
export function dayNumber(date) {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 864e5);
}

export function dayKey(day) {
  return new Date(day * 864e5).toISOString().slice(0, 10);
}

export function parseDay(key) {
  return Math.floor(Date.parse(`${key}T00:00:00Z`) / 864e5);
}

export function formatDay(day, options) {
  return new Date(day * 864e5).toLocaleDateString('en-US', { timeZone: 'UTC', ...options });
}

/** Returns a function: day number -> which verse shows, and from when to when. */
export function makeSchedule(data, s) {
  const pool = buildPool(data, s);
  const anchor = parseDay(s.anchor);
  const rounds = new Map();

  // Every verse is used once before any repeats.
  const round = (n) => {
    if (s.order === 'ordered') return pool;
    if (!rounds.has(n)) {
      const list = shuffled(pool, s.seed + Math.imul(n, 7919));
      if (n > 0 && list.length > 1) {
        const before = shuffled(pool, s.seed + Math.imul(n - 1, 7919));
        if (list[0] === before[before.length - 1]) list.push(list.shift());
      }
      rounds.set(n, list);
    }
    return rounds.get(n);
  };

  const at = (day) => {
    const index = Math.max(0, Math.floor((day - anchor) / s.every));
    const start = anchor + index * s.every;
    const picked = pool.length ? round(Math.floor(index / pool.length))[index % pool.length] : '';
    const ref = s.pin || s.overrides[dayKey(start)] || picked;
    return { ref, index, start, end: start + s.every - 1 };
  };

  return { pool, at };
}

/** One entry per file in the pack. Names are month-day, so a year pack repeats forever. */
export function packPlan(schedule, today, length) {
  const year = length >= 365;
  const files = new Map();
  for (let i = 0; i < (year ? 365 : length); i++) {
    const day = today + i;
    files.set(dayKey(day).slice(5), schedule.at(day).ref);
  }
  if (year) {
    if (!files.has('02-29')) files.set('02-29', files.get('02-28'));
    // A year starting before Feb 29 stops one date short of a full calendar.
    const last = dayKey(today + 365).slice(5);
    if (!files.has(last)) files.set(last, schedule.at(today + 365).ref);
  }
  return [...files].map(([name, ref]) => ({ name: `${name}.jpg`, ref }));
}
