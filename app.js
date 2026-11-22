import * as core from './core.js';
import { THEMES, drawBackground, layoutVerse, loadFonts, palette, renderWallpaper, topIsLight } from './render.js';
import { crc32, makeZip } from './zip.js';

const SETTINGS_KEY = 'daily-ayah-settings';
const PHOTO_KEY = 'daily-ayah-photo';
const TEXT_KEYS = ['show', 'arFont', 'enFont', 'arSize', 'enSize', 'position', 'reference', 'divider', 'arColor', 'enColor', 'accent'];

const $ = (id) => document.getElementById(id);

let data;
let settings;
let schedule;
let photo = null;
let offset = 0;             // periods after the current one
let pack = null;            // the last generated file
let photos = null;          // the last set made for Photo Shuffle
let job = null;             // the running generation
let drawQueued = false;
let noticeTimer = 0;
const customOpen = { every: false, length: false };

const today = () => core.dayNumber(new Date());

function screenSize() {
  if (settings.screen !== 'auto') {
    const [w, h, ratio] = settings.screen.split('x').map(Number);
    return { w, h, ratio };
  }
  const w = Math.min(screen.width, screen.height);
  const h = Math.max(screen.width, screen.height);
  // Anything that isn't phone-shaped (a laptop) gets iPhone 16 Pro size.
  if (w > 500 || h / w < 1.6) return { w: 402, h: 874, ratio: 3 };
  return { w, h, ratio: Math.min(3, Math.max(2, Math.round(devicePixelRatio))) };
}

function store(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function load(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function notify(message, stay = false) {
  clearTimeout(noticeTimer);
  $('notice').textContent = message;
  $('notice').hidden = !message;
  if (message && !stay) noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 4000);
}

function current() {
  const base = schedule.at(today());
  return schedule.at(base.start + offset * settings.every);
}

function clearPack() {
  if (job) job.cancelled = true;
  pack = null;
  photos = null;
  $('save-pack').hidden = $('save-photos').hidden = true;
  $('generate-status').textContent = $('photos-status').textContent = '';
}

/** restart: the schedule begins again today, so manual picks for the old one are dropped. */
function update(changes, { restart = false } = {}) {
  Object.assign(settings, changes);
  if (restart) {
    settings.anchor = core.dayKey(today());
    settings.overrides = {};
    settings.pin = '';
    offset = 0;
  }
  schedule = core.makeSchedule(data, settings);
  store(SETTINGS_KEY, JSON.stringify(settings));
  clearPack();
  syncControls();
  queueDraw();
}

// ---------- preview

function queueDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(draw);
}

async function draw() {
  drawQueued = false;
  try {
    await loadFonts(settings);
  } catch {
    $('when').textContent = 'Quran font not loaded';
    notify('Connect to the internet once so the Quran font can load, then reopen the app.', true);
    return;
  }
  const size = screenSize();
  const slot = current();
  const verse = slot.ref ? core.getVerse(data, slot.ref) : null;
  // Draw near the on-screen size: shrinking a full export this far makes the text jagged.
  const ratio = Math.min(size.ratio, ($('phone').clientHeight * devicePixelRatio) / size.h);
  const drawn = renderWallpaper($('preview'), { ...size, ratio }, settings, verse, photo);

  const short = { weekday: 'short', month: 'short', day: 'numeric' };
  const from = core.formatDay(slot.start, short);
  let when = slot.start === slot.end ? from : `${from} to ${core.formatDay(slot.end, short)}`;
  if (settings.pin) when = 'Every day';
  else if (slot.start === today() && slot.end === today()) when = 'Today';

  $('when').textContent = when;
  $('which').textContent = verse ? `${verse.surah} ${verse.ref}` : '';
  $('preview').setAttribute('aria-label', verse ? `${verse.surah} ${verse.ref}: ${verse.en}` : 'No verse selected');
  $('lock-date').textContent = core.formatDay(Math.max(slot.start, today()), { weekday: 'long', month: 'long', day: 'numeric' });
  $('lock').classList.toggle('dark', topIsLight(settings));
  $('phone').style.aspectRatio = `${size.w} / ${size.h}`;

  $('prev').disabled = offset === 0 || !!settings.pin;
  $('next').disabled = !verse || !!settings.pin;
  $('another').disabled = schedule.pool.length < 2;
  $('favorite').disabled = $('pin').disabled = $('save-one').disabled = !verse;
  const isFavorite = !!verse && settings.favorites.includes(verse.ref);
  $('favorite').setAttribute('aria-pressed', isFavorite);
  $('favorite').textContent = isFavorite ? 'Favorited' : 'Favorite';
  $('pin').setAttribute('aria-pressed', !!settings.pin);
  $('pin').textContent = settings.pin ? 'Kept' : 'Keep';

  if (!verse) notify('No verses here yet. Pick another option under Verses.', true);
  else if (!drawn) notify('This verse is too long to fit. Pick another or show one language.', true);
  else if ($('notice').textContent.startsWith('No verses') || $('notice').textContent.startsWith('This verse')) notify('');
}

function move(step) {
  if (settings.pin) return;
  offset = Math.max(0, offset + step);
  queueDraw();
}

// ---------- controls

function setRadio(group, value) {
  for (const button of $(group).querySelectorAll('[role="radio"]')) {
    button.setAttribute('aria-checked', button.dataset.value === String(value));
  }
}

function syncControls() {
  const s = settings;
  for (const key of ['order', 'show', 'method', 'count']) setRadio(key, s[key]);
  const easy = s.method === 'shuffle';
  $('easy').hidden = !easy;
  $('exact').hidden = easy;
  $('timeline').hidden = easy;
  $('timeline-note').hidden = !easy;
  setRadio('sources', s.source);
  setRadio('themes', s.theme);

  for (const key of ['every', 'length']) {
    const presets = [...$(key).querySelectorAll('[data-value]')].map((b) => b.dataset.value);
    const custom = customOpen[key] || !presets.includes(String(s[key]));
    setRadio(key, custom ? 'custom' : s[key]);
    $(`${key}-row`).hidden = !custom;
    if (document.activeElement !== $(`${key}-custom`)) $(`${key}-custom`).value = s[key];
  }

  $('topics').hidden = s.source !== 'topics';
  for (const chip of $('topics').children) chip.setAttribute('aria-pressed', s.topics.includes(chip.dataset.value));
  $('surah-row').hidden = s.source !== 'surah';
  $('surah').value = s.surah;
  $('longer-row').hidden = s.source !== 'any' && s.source !== 'surah';
  $('reshuffle').hidden = s.order !== 'shuffle' && !easy;
  $('color-options').hidden = s.theme !== 'color';
  $('photo-options').hidden = s.theme !== 'photo';

  for (const key of ['color1', 'color2', 'dim', 'blur', 'arSize', 'enSize', 'position', 'arFont', 'enFont']) $(key).value = s[key];
  for (const key of ['longer', 'reference', 'divider']) $(key).checked = s[key];
  const colors = palette(s);
  $('arColor').value = colors.ar;
  $('enColor').value = colors.en;
  $('accent').value = colors.accent;

  const count = schedule.pool.length;
  $('favorites-count').textContent = `${s.favorites.length} saved`;
  let info = `${count.toLocaleString()} verse${count === 1 ? '' : 's'}. None repeats until all have been shown.`;
  if (s.source === 'any') info += ' Random verses can read as part of a longer passage.';
  if (!count) info = 'No verses here yet.';
  if (s.pin) info = `Keeping ${s.pin} every day. Tap Kept to go back to changing verses.`;
  $('pool-info').textContent = info;

  $('length-info').textContent = lengthInfo();
  const made = Math.min(s.count, count);
  $('count-info').textContent = count < s.count
    ? `Only ${count} verse${count === 1 ? '' : 's'} to choose from, so you get ${made}.`
    : `${made} different verses, a new one each day for ${made} days.`;
}

function lengthInfo() {
  const days = settings.length;
  if (days >= 365) return 'A wallpaper for every date. It repeats each year, so you only do this once.';
  if (days === 1) return 'One wallpaper to set by hand from Photos.';
  const last = core.formatDay(today() + days - 1, { month: 'long', day: 'numeric' });
  return `Changes automatically until ${last}. After that the last one stays until you generate more.`;
}

function bindRadio(group, handler) {
  $(group).addEventListener('click', (event) => {
    const button = event.target.closest('[data-value]');
    if (button) handler(button.dataset.value);
  });
}

function buildControls() {
  for (const [key, topic] of Object.entries(data.sets.topics)) {
    const chip = document.createElement('button');
    chip.dataset.value = key;
    chip.textContent = topic.label;
    $('topics').append(chip);
  }
  data.surahs.forEach((surah, i) => $('surah').append(new Option(`${i + 1}. ${surah.name}`, i + 1)));
  for (const [key, theme] of Object.entries(THEMES)) {
    const button = document.createElement('button');
    button.setAttribute('role', 'radio');
    button.dataset.value = key;
    const thumb = document.createElement('canvas');
    thumb.width = 201;
    thumb.height = 437;
    button.append(thumb, theme.label);
    $('themes').append(button);
  }
}

function drawSwatches() {
  for (const button of $('themes').children) {
    const ctx = button.querySelector('canvas').getContext('2d');
    ctx.setTransform(0.5, 0, 0, 0.5, 0, 0);
    drawBackground(ctx, 402, 874, { ...settings, theme: button.dataset.value }, photo);
  }
}

function bindControls() {
  bindRadio('sources', (source) => {
    update({ source, order: source === 'surah' ? 'ordered' : 'shuffle' }, { restart: true });
  });
  bindRadio('topics', (key) => {
    const topics = settings.topics.includes(key) ? settings.topics.filter((t) => t !== key) : [...settings.topics, key];
    update({ topics }, { restart: true });
  });
  bindRadio('order', (order) => update({ order }, { restart: true }));
  bindRadio('show', (show) => update({ show }));
  bindRadio('method', (method) => update({ method, every: method === 'shuffle' ? 1 : settings.every }, { restart: method === 'shuffle' && settings.every !== 1 }));
  bindRadio('count', (count) => update({ count: Number(count) }));
  bindRadio('themes', (theme) => {
    update({ theme, arColor: '', enColor: '', accent: '' });
    if (theme === 'photo' && !photo) $('photo').click();
  });

  bindRadio('every', (value) => {
    customOpen.every = value === 'custom';
    if (customOpen.every) syncControls();
    else update({ every: Number(value) }, { restart: true });
  });
  bindRadio('length', (value) => {
    customOpen.length = value === 'custom';
    if (customOpen.length) syncControls();
    else update({ length: Number(value) });
  });
  for (const [key, max] of [['every', 90], ['length', 364]]) {
    const input = $(`${key}-custom`);
    input.addEventListener('change', () => {
      const value = core.clamp(Math.round(Number(input.value)) || 1, 1, max);
      input.value = value;
      update({ [key]: value }, { restart: key === 'every' });
    });
  }

  $('surah').addEventListener('change', (e) => update({ surah: Number(e.target.value) }, { restart: true }));
  $('longer').addEventListener('change', (e) => update({ longer: e.target.checked }, { restart: true }));
  for (const key of ['dim', 'blur', 'arSize', 'enSize', 'position']) {
    $(key).addEventListener('input', (e) => update({ [key]: Number(e.target.value) }));
  }
  for (const key of ['color1', 'color2', 'arColor', 'enColor', 'accent']) {
    $(key).addEventListener('input', (e) => {
      update({ [key]: e.target.value });
      drawSwatches();
    });
  }
  for (const key of ['arFont', 'enFont']) $(key).addEventListener('change', (e) => update({ [key]: e.target.value }));
  for (const key of ['reference', 'divider']) $(key).addEventListener('change', (e) => update({ [key]: e.target.checked }));

  $('reset-text').addEventListener('click', () => {
    update(Object.fromEntries(TEXT_KEYS.map((key) => [key, core.DEFAULTS[key]])));
  });
  $('reshuffle').addEventListener('click', () => {
    update({ seed: crypto.getRandomValues(new Uint32Array(1))[0] || 1 }, { restart: true });
  });
}

function bindPreview() {
  $('prev').addEventListener('click', () => move(-1));
  $('next').addEventListener('click', () => move(1));

  let startX = null;
  $('phone').addEventListener('pointerdown', (e) => { startX = e.clientX; });
  $('phone').addEventListener('pointercancel', () => { startX = null; });
  addEventListener('pointerup', (e) => {
    if (startX === null) return;
    const distance = e.clientX - startX;
    startX = null;
    if (Math.abs(distance) > 30) move(distance < 0 ? 1 : -1);
  });

  $('another').addEventListener('click', () => {
    const slot = current();
    const others = schedule.pool.filter((ref) => ref !== slot.ref);
    if (others.length) useVerse(others[Math.floor(Math.random() * others.length)]);
  });
  $('favorite').addEventListener('click', () => {
    const { ref, start } = current();
    const saved = settings.favorites.includes(ref);
    const favorites = saved ? settings.favorites.filter((r) => r !== ref) : [...settings.favorites, ref];
    // Editing favorites mustn't change the verse on screen, except when it is removed from its own list.
    const overrides = { ...settings.overrides };
    if (settings.source === 'favorites' && !saved) overrides[core.dayKey(start)] = ref;
    update({ favorites, overrides });
  });
  $('pin').addEventListener('click', () => update({ pin: settings.pin ? '' : current().ref }));
}

function useVerse(ref) {
  if (settings.pin) update({ pin: ref });
  else update({ overrides: { ...settings.overrides, [core.dayKey(current().start)]: ref } });
}

// ---------- verse picker

function verseButton(ref) {
  const verse = core.getVerse(data, ref);
  const button = document.createElement('button');
  button.className = 'result';
  button.dataset.ref = ref;
  const add = (tag, className, text) => {
    const el = document.createElement(tag);
    el.className = className;
    el.textContent = text;
    button.append(el);
    return el;
  };
  add('small', '', `${verse.surah} ${ref}`);
  add('span', 'ar', verse.ar).dir = 'rtl';
  add('span', 'en', verse.en);
  return button;
}

function search() {
  const query = $('search').value.trim().toLowerCase();
  let refs = [];
  if (!query) {
    refs = schedule.pool.slice(0, 80);
  } else if (/^\d+\s*[: ]\s*\d+$/.test(query)) {
    const ref = query.split(/[\s:]+/).map(Number).join(':');
    if (core.getVerse(data, ref)) refs = [ref];
  } else {
    data.surahs.forEach((surah, s) => {
      const named = surah.name.toLowerCase().includes(query);
      surah.verses.forEach(([, en], v) => {
        if (refs.length < 80 && (named || en.toLowerCase().includes(query))) refs.push(`${s + 1}:${v + 1}`);
      });
    });
  }
  const results = refs.map(verseButton);
  if (!results.length) {
    const empty = document.createElement('p');
    empty.className = 'help';
    empty.textContent = 'No verses found.';
    results.push(empty);
  }
  $('results').replaceChildren(...results);
}

function bindPicker() {
  $('choose').addEventListener('click', () => {
    $('search').value = '';
    search();
    $('picker').showModal();
  });
  $('picker-close').addEventListener('click', () => $('picker').close());
  $('search').addEventListener('input', search);
  $('results').addEventListener('click', (event) => {
    const button = event.target.closest('[data-ref]');
    if (!button) return;
    const { w, h } = screenSize();
    const ctx = document.createElement('canvas').getContext('2d');
    if (layoutVerse(ctx, w, h, settings, core.getVerse(data, button.dataset.ref))) {
      useVerse(button.dataset.ref);
    } else {
      notify('That verse is too long to fit. Show one language or choose another.');
    }
    $('picker').close();
  });
}

// ---------- saving

function toJpeg(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Out of memory'))), 'image/jpeg', 0.92);
  });
}

async function saveFile(file) {
  const touch = navigator.maxTouchPoints > 0;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
    }
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(file);
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 60000);
}

async function generate() {
  if (job) {
    job.cancelled = true;
    return;
  }
  clearPack();
  const thisJob = { cancelled: false };
  job = thisJob;
  $('generate').textContent = 'Cancel';
  $('progress').hidden = false;
  $('progress').value = 0;
  const status = $('generate-status');
  const canvas = document.createElement('canvas');

  try {
    const s = structuredClone(settings);
    await loadFonts(s);
    const size = screenSize();
    const plan = core.packPlan(schedule, today(), s.length);
    if (plan.some((item) => !item.ref)) throw new Error('Pick some verses first.');

    const unique = [...new Set(plan.map((item) => item.ref))];
    const images = new Map();
    for (const [i, ref] of unique.entries()) {
      if (thisJob.cancelled) break;
      if (!renderWallpaper(canvas, size, s, core.getVerse(data, ref), photo)) {
        throw new Error(`${ref} is too long to fit. Change it or show one language.`);
      }
      const blob = await toJpeg(canvas);
      images.set(ref, { blob, crc: crc32(new Uint8Array(await blob.arrayBuffer())) });
      $('progress').value = (i + 1) / unique.length;
      status.textContent = `Making ${i + 1} of ${unique.length}`;
    }

    if (thisJob.cancelled) {
      status.textContent = 'Stopped.';
      return;
    }
    if (plan.length === 1) {
      pack = new File([images.get(plan[0].ref).blob], `Ayah-${plan[0].name}`, { type: 'image/jpeg' });
    } else {
      const zip = makeZip(plan.map(({ name, ref }) => ({ name: `Ayah/${name}`, ...images.get(ref) })));
      pack = new File([zip], 'Ayah.zip', { type: 'application/zip' });
    }
    const days = plan.length === 1 ? 'Today’s wallpaper' : `${plan.length} days, ${unique.length} different verse${unique.length === 1 ? '' : 's'}`;
    status.textContent = `${days}. Ready (${(pack.size / 1048576).toFixed(1)} MB).`;
    $('save-pack').textContent = plan.length === 1 ? 'Save wallpaper' : 'Save to Files';
    $('save-pack').hidden = false;
  } catch (error) {
    status.textContent = error.message || 'Could not finish. Try fewer days.';
  } finally {
    canvas.width = canvas.height = 1; // Safari frees canvas memory late otherwise
    job = null;
    $('generate').textContent = 'Generate';
    $('progress').hidden = true;
  }
}

async function makePhotos() {
  if (job) {
    job.cancelled = true;
    return;
  }
  clearPack();
  const thisJob = { cancelled: false };
  job = thisJob;
  const status = $('photos-status');
  $('make-photos').textContent = 'Cancel';
  $('photos-progress').hidden = false;
  $('photos-progress').value = 0;
  const canvas = document.createElement('canvas');
  try {
    const s = structuredClone(settings);
    await loadFonts(s);
    const size = screenSize();
    const refs = core.shuffleSet(schedule, today(), s.count);
    if (!refs.length) throw new Error('Pick some verses first.');
    const files = [];
    for (const [i, ref] of refs.entries()) {
      if (thisJob.cancelled) break;
      if (!renderWallpaper(canvas, size, s, core.getVerse(data, ref), photo)) {
        throw new Error(`${ref} is too long to fit. Change it or show one language.`);
      }
      files.push(new File([await toJpeg(canvas)], `Ayah ${ref.replace(':', '-')}.jpg`, { type: 'image/jpeg' }));
      $('photos-progress').value = (i + 1) / refs.length;
      status.textContent = `Making ${i + 1} of ${refs.length}`;
    }
    if (thisJob.cancelled) {
      status.textContent = 'Stopped.';
      return;
    }
    photos = files;
    status.textContent = `${files.length} wallpapers ready. Tap Save to Photos, then Save Images.`;
    $('save-photos').hidden = false;
  } catch (error) {
    status.textContent = error.message || 'Could not finish. Try fewer wallpapers.';
  } finally {
    canvas.width = canvas.height = 1;
    job = null;
    $('make-photos').textContent = 'Make wallpapers';
    $('photos-progress').hidden = true;
  }
}

async function savePhotos() {
  if (!photos) return;
  // On iPhone the share sheet offers "Save Images". Anywhere else, download them as one zip.
  if (navigator.maxTouchPoints > 0 && navigator.canShare?.({ files: photos })) {
    try {
      await navigator.share({ files: photos });
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
    }
  }
  const entries = await Promise.all(photos.map(async (file) => ({
    name: file.name, blob: file, crc: crc32(new Uint8Array(await file.arrayBuffer())),
  })));
  await saveFile(new File([makeZip(entries)], 'Ayah wallpapers.zip', { type: 'application/zip' }));
}

function readImage(url) {
  const image = new Image();
  image.src = url;
  return image.decode().then(() => image);
}

async function usePhoto(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  const url = URL.createObjectURL(file);
  try {
    const image = await readImage(url);
    // Crop and shrink to the screen first: full camera photos exhaust Safari's memory.
    const { w, h, ratio } = screenSize();
    const canvas = document.createElement('canvas');
    canvas.width = w * ratio;
    canvas.height = h * ratio;
    const scale = Math.max(canvas.width / image.width, canvas.height / image.height);
    canvas.getContext('2d').drawImage(
      image,
      (canvas.width - image.width * scale) / 2,
      (canvas.height - image.height * scale) / 2,
      image.width * scale,
      image.height * scale,
    );
    const saved = canvas.toDataURL('image/jpeg', 0.8);
    photo = await readImage(saved);
    if (!store(PHOTO_KEY, saved)) notify('Photo works now, but is too large to remember for next time.');
    update({ theme: 'photo' });
    drawSwatches();
  } catch {
    notify('That photo could not be opened. Try another.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function restore(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    const raw = JSON.parse(await file.text());
    if (!Object.hasOwn(raw, 'source') || !Object.hasOwn(raw, 'theme')) throw new Error('not a backup');
    settings = core.cleanSettings(raw, data);
    settings.anchor ||= core.dayKey(today());
    offset = 0;
    update({});
    drawSwatches();
    notify('Settings restored.');
  } catch {
    notify('That is not a Daily Ayah backup.');
  }
}

function bindSaving() {
  $('generate').addEventListener('click', generate);
  $('make-photos').addEventListener('click', makePhotos);
  $('save-photos').addEventListener('click', savePhotos);
  $('save-pack').addEventListener('click', () => pack && saveFile(pack));
  $('save-one').addEventListener('click', async () => {
    const { ref } = current();
    const canvas = document.createElement('canvas');
    await loadFonts(settings);
    if (!renderWallpaper(canvas, screenSize(), settings, core.getVerse(data, ref), photo)) return;
    await saveFile(new File([await toJpeg(canvas)], `Ayah-${ref.replace(':', '-')}.jpg`, { type: 'image/jpeg' }));
  });
  $('photo').addEventListener('change', usePhoto);
  $('backup').addEventListener('click', () => {
    saveFile(new File([JSON.stringify(settings, null, 2)], 'daily-ayah-backup.json', { type: 'application/json' }));
  });
  $('restore').addEventListener('change', restore);
}

function bindTabs() {
  const tabs = [...document.querySelectorAll('[data-tab]')];
  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      for (const other of tabs) {
        other.setAttribute('aria-selected', other === tab);
        $(`panel-${other.dataset.tab}`).hidden = other !== tab;
      }
      document.querySelector('.panels').scrollTop = 0;
    });
  }
}

async function start() {
  const response = await fetch('data/quran.json');
  if (!response.ok) throw new Error('data');
  data = await response.json();

  let saved = null;
  try {
    saved = JSON.parse(load(SETTINGS_KEY));
  } catch { /* unreadable settings: start fresh */ }
  settings = core.cleanSettings(saved, data);
  if (!settings.anchor) {
    settings.anchor = core.dayKey(today());
    settings.seed = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
  }
  const savedPhoto = load(PHOTO_KEY);
  if (savedPhoto?.startsWith('data:image/')) photo = await readImage(savedPhoto).catch(() => null);

  schedule = core.makeSchedule(data, settings);
  buildControls();
  bindControls();
  bindPreview();
  bindPicker();
  bindSaving();
  bindTabs();
  drawSwatches();
  update({});

  // An app left open overnight should move on to the new day.
  addEventListener('resize', queueDraw);
  let shownDay = today();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || today() === shownDay) return;
    shownDay = today();
    offset = 0;
    update({});
  });

  navigator.storage?.persist?.().catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

start().catch(() => {
  $('when').textContent = 'Could not load. Reopen the app.';
});
