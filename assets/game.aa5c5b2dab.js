import { createView } from './view3d.fded8abd00.js';
import {
  MAX_GUESSES, STAGES, stageFor, hintsFor, dayNumber, puzzleId, msUntilTomorrow,
  searchPlaces, scoreGuess, formatKm, proximity, arrowFor, shareText, emptyStats, recordResult,
} from './logic.f41d0313c3.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, fallback) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked: play on without saving */ } },
};

const params = new URLSearchParams(location.search);
const [meta, places] = await Promise.all([
  fetch('data/puzzles.json').then((r) => r.json()),
  fetch('data/places.json').then((r) => r.json()),
]);

const today = dayNumber(meta.epoch);
const view = createView($('map'), window.maplibregl);
window.__view = view;
let game; // { n, id, answer, practice, guesses: [], map }

async function start({ practiceId } = {}) {
  const practice = !!practiceId;
  const n = practice ? 0 : (Number(params.get('day')) || today);
  const id = practiceId || params.get('city') || puzzleId(meta.order, n);
  const answer = meta.cities[id];
  const saved = practice ? null : store.get(`foldout:day:${n}`, null);
  game = { n, id, answer, practice, guesses: saved?.id === id ? saved.guesses : [], map: null };
  $('sub').textContent = practice ? 'Practice map' : `No. ${n} · ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}`;
  $('loading').hidden = false;
  $('guessInput').value = '';
  hideSuggest();
  try {
    const res = await fetch(`data/3d/${id}.json`);
    if (!res.ok) throw new Error(res.status);
    game.map = await res.json();
  } catch {
    $('loading').textContent = 'This map could not be loaded. Please reload the page.';
    return;
  }
  $('loading').hidden = true;
  draw({ animate: false });
  update({ redraw: false });
}

const won = () => game.guesses.some((g) => g.correct);
const finished = () => won() || game.guesses.length >= MAX_GUESSES;

function draw({ animate = true } = {}) {
  if (!game.map) return;
  view.show(game.map, stageFor(game.guesses.length, finished()), { animate });
}

function update({ redraw = true } = {}) {
  if (redraw) draw();
  const done = finished();
  const count = game.guesses.length;

  const dots = $('dots');
  dots.innerHTML = '';
  for (let i = 0; i < MAX_GUESSES; i++) {
    const li = document.createElement('li');
    if (i < count) li.className = 'used';
    else if (i === count && !done) li.className = 'now';
    dots.append(li);
  }
  const stage = stageFor(count, done);
  $('stageLabel').textContent = done ? `${(stage.view * 2) / 1000} km across` : `Guess ${count + 1}/${MAX_GUESSES} · ${stage.label} · ${(stage.view * 2 / 1000).toFixed(1)} km`;

  const hints = $('hints');
  hints.innerHTML = '';
  const a = game.answer;
  const text = { pattern: ['Pattern', a.pattern], continent: ['Continent', a.continent], country: ['Country', a.country] };
  for (const h of hintsFor(count, done)) {
    if (done && h === 'country') continue;
    const li = document.createElement('li');
    li.innerHTML = `<b>${text[h][0]}</b>`;
    li.append(text[h][1]);
    hints.append(li);
  }

  const list = $('guesses');
  list.innerHTML = '';
  for (const g of game.guesses) {
    const li = document.createElement('li');
    li.className = g.correct ? 'ok' : g.km < 500 ? 'near' : g.km < 2000 ? 'mid' : '';
    const name = document.createElement('span');
    name.textContent = g.name + ' ';
    const c = document.createElement('span');
    c.className = 'c';
    c.textContent = g.country;
    name.append(c);
    li.append(name);
    li.insertAdjacentHTML('beforeend', `<span class="km">${g.correct ? '—' : formatKm(g.km)}</span>` +
      `<span class="arrow" aria-label="direction">${g.correct ? '🎯' : arrowFor(g.deg)}</span>` +
      `<span class="pct">${proximity(g.km)}%</span>`);
    list.append(li);
  }

  $('guessForm').hidden = done;
  $('result').hidden = !done;
  if (done) {
    $('verdict').textContent = won() ? ['First try!', 'Splendid.', 'Well read.', 'Got there.', 'Close call.', 'Phew — last guess.'][count - 1] : 'Out of guesses. It was…';
    $('answerName').textContent = `${a.name}, ${a.country}`;
    $('answerPattern').textContent = a.pattern;
    $('answerNote').textContent = a.note;
    $('practiceBtn').textContent = game.practice ? 'Another practice map' : 'Practice another';
    $('nextIn').textContent = game.practice ? 'Practice maps don’t count towards your stats.' : nextText();
  }
}

function nextText() {
  const ms = msUntilTomorrow();
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return `Next map in ${h} h ${m} min.`;
}

function submit(place) {
  if (!place || finished()) return;
  if (game.guesses.some((g) => g.name === place[0] && g.country === place[1])) {
    toast('Already guessed');
    return;
  }
  game.guesses.push(scoreGuess(game.answer, place));
  $('guessInput').value = '';
  hideSuggest();
  if (!game.practice) {
    store.set(`foldout:day:${game.n}`, { id: game.id, guesses: game.guesses });
    if (finished()) store.set('foldout:stats', recordResult(store.get('foldout:stats', emptyStats()), game.n, won(), game.guesses.length));
  }
  update();
  if (finished() && !game.practice) setTimeout(() => $('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 150);
}

// Autocomplete
let matches = [], active = -1;
function showSuggest() {
  const ul = $('suggest');
  ul.innerHTML = '';
  matches.forEach((p, i) => {
    const li = document.createElement('li');
    li.role = 'option';
    li.setAttribute('aria-selected', String(i === active));
    li.textContent = p[0] + ' ';
    const s = document.createElement('span');
    s.textContent = p[1];
    li.append(s);
    li.addEventListener('mousedown', (e) => { e.preventDefault(); submit(p); });
    ul.append(li);
  });
  ul.hidden = !matches.length;
}
function hideSuggest() { matches = []; active = -1; $('suggest').hidden = true; }

$('guessInput').addEventListener('input', (e) => {
  matches = searchPlaces(places, e.target.value);
  active = matches.length ? 0 : -1;
  showSuggest();
});
$('guessInput').addEventListener('keydown', (e) => {
  if (!matches.length) return;
  if (e.key === 'ArrowDown') { active = (active + 1) % matches.length; showSuggest(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { active = (active - 1 + matches.length) % matches.length; showSuggest(); e.preventDefault(); }
  else if (e.key === 'Escape') hideSuggest();
});
$('guessInput').addEventListener('blur', () => setTimeout(hideSuggest, 120));
$('guessForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (active >= 0 && matches[active]) submit(matches[active]);
  else {
    const m = searchPlaces(places, $('guessInput').value, 1);
    if (m.length) submit(m[0]);
    else toast('Pick a city from the list');
  }
});

// Result actions
$('shareBtn').addEventListener('click', async () => {
  const text = shareText({ n: game.n, guesses: game.guesses, won: won(), practice: game.practice }) + '\n' + location.origin + location.pathname;
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ text });
    else { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); }
  } catch { /* share sheet dismissed */ }
});
$('practiceBtn').addEventListener('click', () => {
  const ids = meta.order.filter((id) => id !== puzzleId(meta.order, today) && id !== game.id);
  start({ practiceId: ids[Math.floor(Math.random() * ids.length)] });
  scrollTo({ top: 0, behavior: 'smooth' });
});

// Dialogs
for (const d of document.querySelectorAll('dialog')) {
  d.addEventListener('click', (e) => { if (e.target === d || e.target.hasAttribute('data-close')) d.close(); });
}
$('helpBtn').addEventListener('click', () => $('help').showModal());
$('statsBtn').addEventListener('click', () => {
  const s = store.get('foldout:stats', emptyStats());
  $('nums').innerHTML = [['Played', s.played], ['Win %', s.played ? Math.round((100 * s.won) / s.played) : 0], ['Streak', s.streak], ['Best', s.best]]
    .map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('');
  const max = Math.max(1, ...s.dist);
  const mine = !game.practice && won() ? game.guesses.length : 0;
  $('dist').innerHTML = s.dist.map((v, i) => `<div><span>${i + 1}</span><i class="${mine === i + 1 ? 'me' : ''}" style="width:${Math.max(8, (100 * v) / max)}%">${v}</i></div>`).join('');
  $('stats').showModal();
});

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
}

let lastWidth = 0;
new ResizeObserver(() => {
  const w = $('mapwrap').clientWidth;
  if (Math.abs(w - lastWidth) > 2) { lastWidth = w; view.resize(); }
}).observe($('mapwrap'));
$('recenter').addEventListener('click', () => view.resetCamera());

if (!store.get('foldout:seenHelp', false)) {
  store.set('foldout:seenHelp', true);
  $('help').showModal();
}
await start();
window.__foldout = { get game() { return game; }, STAGES };
