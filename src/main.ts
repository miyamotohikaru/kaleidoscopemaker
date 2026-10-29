import './style.css';
import { GEM, Kind, LIQUIDS, MORTAR_STONES, SHELF, TINTS, type GemName, type Item } from './catalog';
import { Cell, mulberry, type Body } from './sim';
import { Renderer, type ViewState } from './render';
import { sound } from './audio';
import { Mortar } from './mortar';
import { appraise } from './appraise';
import { drawCard } from './card';
import { decode, dust, encode } from './share';
import { Kuma3D, preloadKuma } from './kuma3d';

type Stage = 'intro' | 'fill1' | 'fill2' | 'look' | 'name' | 'appraise';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const body = document.body;
const DOMAIN = 'kaleidoscopemaker.vercel.app';
const MAX_BIG = 48;
const MAX_SMALL = 640;

const canvas = $<HTMLCanvasElement>('#gl');
let R: Renderer;
try {
  R = new Renderer(canvas);
} catch {
  document.body.innerHTML = '<p class="nojs">この万華鏡は WebGL2 が使えるブラウザで動きます。</p>';
  throw new Error('no webgl');
}
const rnd = mulberry((Math.random() * 1e9) | 0);
let cell = new Cell();
let stage: Stage = 'intro';
let mirrors = 8;
let tintIdx = 0;
let liquidIdx = -1;
let shared: { name: string } | null = null;

const v: ViewState = {
  mode: 1,
  iris: 1.3,
  fade: 0,
  ring: 0,
  mirrors: 8,
  R: 300,
  cx: 200,
  cy: 400,
  edge: 1,
  trail: 0.8,
  bloom: 0.9,
  back: 0.02,
  tint: [1, 1, 1],
  span: 0.66,
  wedge: -Math.PI / 2,
};
// 位置と大きさは目標へなめらかに寄せる
const goal = { R: 300, cx: 200, cy: 400 };

// ---------- 中身をつくる ----------
function makeBody(it: Item, x: number, y: number, seed = rnd()): Body {
  const r = it.size[0] + rnd() * (it.size[1] - it.size[0]);
  return {
    x,
    y,
    vx: (rnd() - 0.5) * 0.3,
    vy: 0,
    r,
    a: rnd() * Math.PI * 2,
    w: (rnd() - 0.5) * 4,
    kind: it.kind,
    color: it.color,
    rgb: [...GEM[it.color]] as [number, number, number],
    seed,
    density: it.density,
    small: it.kind === Kind.Glitter,
    photo: -1,
    born: cell.time,
  };
}

function bigCount() {
  return cell.bodies.filter((b) => !b.small).length;
}
function smallCount() {
  return cell.bodies.length - bigCount();
}

function addItem(it: Item, x0?: number) {
  if (it.pinch) {
    if (smallCount() >= MAX_SMALL) return say('もう、入らないかも。');
    const [x, y] = cell.dropPoint(rnd);
    for (let i = 0; i < it.pinch; i++) {
      const b = makeBody(it, x + (rnd() - 0.5) * 0.25, y + (rnd() - 0.5) * 0.12);
      b.vx = (rnd() - 0.5) * 0.4;
      b.vy = (rnd() - 0.5) * 0.2;
      cell.add(b);
    }
  } else {
    if (bigCount() >= MAX_BIG) return say('もう、いっぱい。');
    const [x, y] = cell.dropPoint(rnd);
    cell.add(makeBody(it, x0 ?? x, y));
    if (it.kind === Kind.Charm && !cell.bodies.some((b, i) => b.kind === Kind.Charm && i < cell.bodies.length - 1)) say('それ、ぼく。');
  }
  sound.drop(it.kind, (it.size[0] + it.size[1]) / 2, (x0 ?? 0) * 0.5, cell.liquid && cell.level > 0.3 ? cell.liquid.id : null);
  updateCount();
}

function updateCount() {
  $('#count').textContent = String(bigCount());
}

function sample(seed: number) {
  // 入口の見本：オイルに宝石を沈めたもの
  const r = mulberry(seed);
  const c = new Cell();
  const pick = ['g-sap', 'g-sap', 'g-eme', 'g-rub', 'g-amb', 'g-clr', 'pearl', 'gold', 'gold', 'm-ame', 'm-sap', 'm-eme', 'm-clr', 'f-rose', 'f-ind', 'g-rub', 'g-sap', 'm-clr', 'pearl', 'g-eme', 'gold', 'm-sap', 'g-sap', 'm-ame', 'g-rub', 'g-amb', 'pearl', 'm-clr', 'g-eme', 'f-ivo', 'g-clr', 'm-sap', 'gold', 'g-sap'];
  for (const id of pick) {
    const it = SHELF.find((s) => s.id === id)!;
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * 0.8;
    const b = makeBody(it, Math.cos(a) * d, Math.sin(a) * d, r());
    c.add(b);
  }
  for (let i = 0; i < 90; i++) c.add(dust(r() < 0.6 ? 'gold' : 'rainbow', r));
  c.liquid = LIQUIDS[1];
  c.level = c.levelTarget = 1;
  for (let i = 0; i < 240; i++) c.step(1 / 60, 0);
  return c;
}

// ---------- 棚 ----------
const DRAWER_MORTAR = `<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1"><path d="M6 18h28c0 8-6 14-14 14S6 26 6 18Z"/><path d="M12 32.5h16"/><path d="m24 18 9-12" stroke-linecap="round"/><circle cx="33.6" cy="5.2" r="1.6"/></svg>`;
const DRAWER_PHOTO = `<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1"><rect x="7" y="9" width="26" height="22"/><path d="m7 27 8-8 6 6 4-4 8 8"/><circle cx="25" cy="15.5" r="2"/></svg>`;

async function buildTray() {
  await R.ready;
  const tray = $('#tray');
  const html: string[] = [];
  for (const it of SHELF) {
    let bodies: Body[];
    let frame = 1;
    if (it.pinch) {
      const r = mulberry(it.id.length * 97);
      bodies = [];
      for (let i = 0; i < 26; i++) {
        const a = r() * Math.PI * 2;
        const d = Math.sqrt(r()) * 0.07;
        const b = makeBody(it, Math.cos(a) * d, Math.sin(a) * d * 0.8, r());
        b.r *= 1.3;
        b.a = r() * 6;
        bodies.push(b);
      }
      frame = 0.1;
    } else {
      const b = makeBody(it, 0, 0, it.kind === Kind.Glass ? 0.7 : 0.31);
      b.r = it.size[1];
      b.a = it.kind === Kind.Charm ? 0 : 0.5;
      bodies = [b];
      frame = b.r * 1.25;
    }
    const src = R.tile(bodies, frame);
    html.push(`<button class="slot" type="button" data-id="${it.id}" aria-label="${it.label}"><img src="${src}" alt=""/><span>${shortLabel(it.label)}</span></button>`);
  }
  html.push(`<button class="slot drawer" type="button" data-drawer="mortar" aria-label="乳鉢で砕く"><i class="knob"></i>${DRAWER_MORTAR}<span>乳鉢</span></button>`);
  html.push(`<button class="slot drawer" type="button" data-drawer="photo" aria-label="写真を破片にする"><i class="knob"></i>${DRAWER_PHOTO}<span>写真</span></button>`);
  tray.innerHTML = html.join('');
  tray.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest('.slot') as HTMLElement | null;
    if (!el) return;
    sound.unlock();
    if (el.dataset.drawer === 'mortar') return openMortar();
    if (el.dataset.drawer === 'photo') {
      sound.slide();
      return $<HTMLInputElement>('#photo').click();
    }
    const it = SHELF.find((s) => s.id === el.dataset.id);
    if (it) addItem(it);
  });
}
function shortLabel(s: string) {
  return s.replace('のガラス玉', '').replace('のかけら', '').replace('のラメ', 'ラメ').replace('こすくまくん', 'ちゃーむ');
}

// ---------- 写真の破片（端末の中だけで処理） ----------
$<HTMLInputElement>('#photo').addEventListener('change', async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!f) return;
  try {
    const bmp = await createImageBitmap(f);
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const x = c.getContext('2d')!;
    const s = Math.min(bmp.width, bmp.height);
    x.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 512, 512);
    const rects: [number, number, number, number][] = [];
    for (let i = 0; i < 5; i++) {
      const w = 0.32 + rnd() * 0.2;
      rects.push([rnd() * (1 - w), rnd() * (1 - w), w, w]);
    }
    R.setPhoto(c, rects);
    cell.bodies = cell.bodies.filter((b) => b.kind !== Kind.Photo);
    for (let i = 0; i < 5; i++) {
      if (bigCount() >= MAX_BIG) break;
      const [px, py] = cell.dropPoint(rnd);
      const b = makeBody({ id: 'photo', label: '写真', kind: Kind.Photo, color: 'clear', size: [0.08, 0.11], density: 1.2 }, px + (rnd() - 0.5) * 0.3, py);
      b.photo = i;
      cell.add(b);
    }
    sound.crack(null, 0, 0.5);
    updateCount();
  } catch {
    say('その写真は、読めなかった。');
  }
});

// ---------- 乳鉢 ----------
const mortar = new Mortar($<HTMLCanvasElement>('#mortar-cv'));
let stone: GemName = 'sapphire';
function buildStones() {
  $('#stones').innerHTML = MORTAR_STONES.map(
    (s) => `<button class="stone" type="button" role="radio" data-c="${s.color}" aria-checked="${s.color === stone}" style="--c:${cssGem(s.color)}"><i></i>${s.label}</button>`,
  ).join('');
}
function cssGem(c: GemName) {
  const g = GEM[c];
  return `rgb(${g.map((x) => Math.round(Math.pow(x, 1 / 2.2) * 255)).join(',')})`;
}
$('#stones').addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest('.stone') as HTMLElement | null;
  if (!el) return;
  stone = el.dataset.c as GemName;
  document.querySelectorAll('.stone').forEach((s) => s.setAttribute('aria-checked', String(s === el)));
  sound.tick();
  mortar.reset(stone);
});
const GRIND_WORDS: [number, string][] = [
  [0, '原石'],
  [0.14, 'かけら'],
  [0.45, '粗い粉'],
  [0.8, 'きらきらの粉'],
];
mortar.onProgress = (p) => {
  $('#grind-bar').style.width = `${p * 100}%`;
  $('#grind-word').textContent = GRIND_WORDS.filter(([t]) => p >= t).pop()![1];
  $<HTMLButtonElement>('#mortar-add').disabled = p < 0.14;
};
function openMortar() {
  sound.slide();
  buildStones();
  $('#mortar').hidden = false;
  requestAnimationFrame(() => mortar.open(stone));
}
function closeMortar() {
  mortar.close();
  $('#mortar').hidden = true;
}
$('#mortar-close').addEventListener('click', () => {
  sound.tick();
  closeMortar();
});
$('#mortar-add').addEventListener('click', () => {
  const res = mortar.result();
  closeMortar();
  const [x, y] = cell.dropPoint(rnd);
  for (let i = 0; i < res.shards && bigCount() < MAX_BIG; i++) {
    const b = makeBody({ id: 'shard', label: '', kind: Kind.Mineral, color: res.color, size: [0.03, 0.05], density: 2.6 }, x + (rnd() - 0.5) * 0.3, y);
    cell.add(b);
  }
  for (let i = 0; i < res.dust && smallCount() < MAX_SMALL; i++) {
    const d = dust(res.color, rnd, x + (rnd() - 0.5) * 0.35, y + (rnd() - 0.5) * 0.15);
    d.r = 0.007 + rnd() * 0.008;
    cell.add(d);
  }
  sound.sprinkle((sound.ctx?.currentTime ?? 0) + 0.02, 1);
  updateCount();
});

// ---------- 溶液 ----------
const VIAL: Record<string, string> = {
  water: 'linear-gradient(180deg, rgba(190,215,240,.35), rgba(150,190,230,.55))',
  oil: 'linear-gradient(180deg, rgba(240,220,150,.45), rgba(210,170,80,.7))',
  honey: 'linear-gradient(180deg, rgba(240,170,50,.85), rgba(170,90,10,.95))',
};
function buildLiquids() {
  $('#liquids').innerHTML = LIQUIDS.map(
    (l, i) => `<button class="liquid" type="button" role="radio" data-i="${i}" aria-checked="false"><i class="vial" style="--fill:${VIAL[l.id]}"></i><b>${l.label}</b></button>`,
  ).join('');
  $('#tints').innerHTML = TINTS.map(
    (t, i) =>
      `<button class="tint" type="button" role="radio" data-i="${i}" aria-checked="${i === tintIdx}" aria-label="${t.label}" style="--c:${
        i === 0 ? 'linear-gradient(135deg,#fff 0 45%,#999 55%)' : `rgb(${t.rgb.map((x) => Math.round(Math.pow(x, 1 / 2.2) * 255)).join(',')})`
      }"><i></i></button>`,
  ).join('');
}
$('#liquids').addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest('.liquid') as HTMLElement | null;
  if (!el) return;
  sound.unlock();
  const i = Number(el.dataset.i);
  document.querySelectorAll('.liquid').forEach((s) => s.setAttribute('aria-checked', String(s === el)));
  const was = liquidIdx;
  liquidIdx = i;
  const L = LIQUIDS[i];
  cell.liquid = L;
  if (was < 0) {
    cell.level = 0;
    cell.levelTarget = 1;
  }
  sound.pour(L.id, was < 0 ? (L.id === 'honey' ? 4 : 2.6) : 1.2);
  say(({ water: 'さらさら。', oil: 'とろっと。', honey: '……ゆっくりだね。' } as const)[L.id]);
  setNext();
});
$('#tints').addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest('.tint') as HTMLElement | null;
  if (!el) return;
  tintIdx = Number(el.dataset.i);
  document.querySelectorAll('.tint').forEach((s) => s.setAttribute('aria-checked', String(s === el)));
  sound.tick();
});

// ---------- 鏡の数 ----------
document.querySelectorAll<HTMLButtonElement>('[data-mirrors]').forEach((b) =>
  b.addEventListener('click', () => {
    mirrors = Number(b.dataset.mirrors);
    document.querySelectorAll('[data-mirrors]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    sound.tick();
  }),
);
$('#undo').addEventListener('click', () => {
  for (let i = cell.bodies.length - 1; i >= 0; i--) {
    if (!cell.bodies[i].small) {
      cell.bodies.splice(i, 1);
      break;
    }
  }
  sound.tick();
  updateCount();
});

// ---------- こすくまくんのひとこと ----------
let sayTimer = 0;
function say(text: string, ms = 2600) {
  const el = $('#say');
  el.querySelector('p')!.textContent = text;
  el.classList.add('show');
  clearTimeout(sayTimer);
  sayTimer = window.setTimeout(() => el.classList.remove('show'), ms);
}

// ---------- 段の切り替え ----------
const ORDER: Stage[] = ['fill1', 'fill2', 'look', 'name'];
const NEXT: Record<string, [string, string]> = {
  fill1: ['ii', '満たす'],
  fill2: ['iii', 'のぞく'],
  look: ['iv', '名付ける'],
  name: ['', '鑑定してもらう'],
};
function setNext() {
  const [n, l] = shared && stage === 'look' ? ['i', '自分もつくる'] : NEXT[stage] ?? ['', ''];
  $('#next-num').textContent = n;
  $('#next-label').textContent = l;
  $<HTMLButtonElement>('#next').disabled = stage === 'fill2' && liquidIdx < 0;
}
function setStage(s: Stage) {
  stage = s;
  body.dataset.stage = s;
  const k = ORDER.indexOf(s);
  document.querySelectorAll<HTMLElement>('.steps li').forEach((li, i) => {
    li.classList.toggle('on', i === k);
    li.classList.toggle('done', k > i && !shared);
  });
  setNext();
  requestAnimationFrame(layout);
}

function layout() {
  const w = innerWidth;
  const h = innerHeight;
  const top = 60 + (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sat')) || 0);
  if (body.classList.contains('og')) {
    goal.R = h * 0.47;
    goal.cx = w * 0.28;
    goal.cy = h / 2;
    return;
  }
  if (stage === 'intro') {
    goal.R = Math.min((w / 2) * 1.16, h * 0.34, 460);
    goal.cx = w / 2;
    goal.cy = Math.max(top + goal.R * 0.82, h * 0.34);
    return;
  }
  const panel = document.querySelector<HTMLElement>(`#p-${stage === 'appraise' ? 'name' : stage}`);
  const bottom = panel ? panel.getBoundingClientRect().top : h - 120;
  if (stage === 'fill1' || stage === 'fill2') {
    const avail = bottom - top - 44;
    goal.R = Math.max(80, Math.min(w / 2 - 34, avail / 2 - 22, 300));
    goal.cx = w / 2;
    goal.cy = top + 40 + avail / 2;
  } else {
    const avail = bottom - top - 10;
    goal.R = Math.max(120, Math.min((w / 2) * 1.16, avail / 2, 420));
    goal.cx = w / 2;
    goal.cy = top + avail / 2;
  }
}

function placeEngrave() {
  const el = $('#engrave') as unknown as SVGSVGElement;
  const size = (2 * v.R * 1.0375 * 50) / 46;
  el.style.width = el.style.height = size + 'px';
  el.style.left = v.cx - size / 2 + 'px';
  el.style.top = v.cy - size / 2 + 'px';
  el.style.transform = `rotate(${(-cell.angle * 180) / Math.PI}deg)`;
}

// ---------- 演出 ----------
function tween(ms: number, f: (t: number) => void, ease = (t: number) => t) {
  return new Promise<void>((res) => {
    const t0 = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / ms);
      f(ease(t));
      if (t < 1) requestAnimationFrame(step);
      else res();
    };
    step();
  });
}
const easeIO = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeO = (t: number) => 1 - Math.pow(1 - t, 3);

let auto = 0; // 自動で回る残り時間
async function toWindow() {
  body.classList.add('busy');
  await tween(450, (t) => (v.fade = 1 - t));
  cell = new Cell();
  liquidIdx = -1;
  tintIdx = 0;
  buildLiquids();
  v.mode = 0;
  v.ring = 1;
  v.edge = 0;
  v.trail = 0;
  v.back = 0.028;
  v.bloom = 0.7;
  setStage('fill1');
  layout();
  Object.assign(v, { R: goal.R, cx: goal.cx, cy: goal.cy });
  updateCount();
  await tween(600, (t) => (v.fade = t), easeO);
  body.classList.remove('busy');
  say('好きなの、落として。');
}

async function toLook() {
  body.classList.add('busy');
  sound.close();
  if (cell.liquid) cell.levelTarget = 1;
  const R0 = v.R;
  await tween(800, (t) => {
    v.fade = 1 - t;
    goal.R = v.R = R0 * (1 + t * 0.7);
  }, easeIO);
  cell.level = cell.levelTarget = cell.liquid ? 1 : 0;
  v.mode = 1;
  v.ring = 0;
  v.mirrors = mirrors;
  v.back = 0.02;
  v.bloom = 0.75;
  v.edge = 1;
  v.trail = 0.5;
  v.iris = 0;
  v.fade = 1;
  setStage('look');
  layout();
  Object.assign(v, { R: goal.R, cx: goal.cx, cy: goal.cy });
  sound.setMuffle(0.72);
  sound.open();
  auto = 5.5;
  cell.lift(rnd);
  await tween(2800, (t) => (v.iris = t * 1.08), easeIO);
  body.classList.remove('busy');
}

// ---------- 回す ----------
const drag = { on: false, id: -1, last: 0, t: 0, vel: 0 };
let angVel = 0;
function ang(e: PointerEvent) {
  return Math.atan2(-(e.clientY - v.cy), e.clientX - v.cx);
}
canvas.addEventListener('pointerdown', (e) => {
  sound.unlock();
  if (body.classList.contains('busy')) return;
  drag.on = true;
  drag.id = e.pointerId;
  drag.last = ang(e);
  drag.t = performance.now();
  drag.vel = 0;
  canvas.setPointerCapture(e.pointerId);
  auto = 0;
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag.on || e.pointerId !== drag.id) return;
  const a = ang(e);
  let d = a - drag.last;
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  const r = Math.hypot(e.clientX - v.cx, e.clientY - v.cy) / v.R;
  const wgt = Math.min(1, Math.max(0, (r - 0.12) / 0.45));
  d *= wgt * 0.85;
  const now = performance.now();
  const dt = Math.max(8, now - drag.t) / 1000;
  drag.vel = drag.vel * 0.6 + (d / dt) * 0.4;
  cell.angle += d;
  drag.last = a;
  drag.t = now;
});
const release = (e: PointerEvent) => {
  if (e.pointerId !== drag.id) return;
  drag.on = false;
  angVel = Math.max(-2.5, Math.min(2.5, drag.vel));
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

// 傾けて回す
let tiltOn = false;
let tiltSign = 0;
let tiltG = -Math.PI / 2;
function onMotion(e: DeviceMotionEvent) {
  const g = e.accelerationIncludingGravity;
  if (!g || g.x == null || g.y == null) return;
  if (Math.hypot(g.x, g.y) < 2.5) return;
  if (!tiltSign) tiltSign = g.y > 0 ? -1 : 1;
  tiltG = Math.atan2(g.y * tiltSign, g.x * tiltSign);
}
$('#tilt').addEventListener('click', async () => {
  const btn = $('#tilt');
  if (tiltOn) {
    tiltOn = false;
    btn.setAttribute('aria-pressed', 'false');
    removeEventListener('devicemotion', onMotion);
    return;
  }
  const DM = window.DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> };
  try {
    if (DM?.requestPermission && (await DM.requestPermission()) !== 'granted') return;
  } catch {
    return;
  }
  tiltOn = true;
  tiltSign = 0;
  btn.setAttribute('aria-pressed', 'true');
  addEventListener('devicemotion', onMotion);
});

// ---------- 名付ける・鑑定 ----------
let kuma: Kuma3D | null = null;
let lastCard: HTMLCanvasElement | null = null;
let lastName = '';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function doAppraise() {
  const input = $<HTMLInputElement>('#name');
  input.blur();
  const name = (input.value.trim() || input.placeholder.replace('たとえば、', '')).slice(0, 24);
  lastName = name;
  const code = encode(cell, { mirrors, liquid: Math.max(0, liquidIdx), tint: tintIdx, name });
  history.replaceState(null, '', `#k=${code}`);
  stage = 'appraise';
  body.dataset.stage = 'appraise';
  const ap = $('#appraisal');
  const say2 = $('#kuma-say');
  const cert = $('#cert');
  const acts = $('#actions');
  cert.classList.remove('show');
  acts.classList.remove('show');
  say2.classList.remove('show');
  ap.hidden = false;
  ap.scrollTop = 0;
  if (!kuma) kuma = new Kuma3D($<HTMLCanvasElement>('#kuma'));
  const st = $('#kuma').getBoundingClientRect();
  kuma.resize(st.width, st.height);
  kuma.lean = 0;
  kuma.start();
  const verdict = appraise(cell, mirrors, TINTS[tintIdx].id, name);
  const scope = R.snapshot(cell, v, 1024);
  const cardP = drawCard(scope, name, verdict, DOMAIN);
  await wait(500);
  say2.textContent = 'ちょっと貸して。';
  say2.classList.add('show');
  await tween(900, (t) => kuma && (kuma.lean = t), easeIO);
  await wait(700);
  say2.classList.remove('show');
  await wait(350);
  say2.textContent = '……';
  say2.classList.add('show');
  await wait(1300);
  const card = await cardP;
  lastCard = card;
  $<HTMLImageElement>('#cert-img').src = card.toDataURL('image/jpeg', 0.92);
  await tween(600, (t) => kuma && (kuma.lean = 1 - t), easeIO);
  say2.classList.remove('show');
  cert.classList.add('show');
  sound.stamp();
  await wait(400);
  say2.textContent = verdict.line;
  say2.classList.add('show');
  acts.classList.add('show');
}

function closeAppraisal() {
  $('#appraisal').hidden = true;
  kuma?.stop();
}

$('#post').addEventListener('click', () => {
  const url = location.href.split('#')[0] + location.hash;
  const text = `「${lastName}」をのぞきました。\n#万華鏡メーカー`;
  window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank', 'noopener');
});
$('#save').addEventListener('click', async () => {
  if (!lastCard) return;
  const blob: Blob | null = await new Promise((r) => lastCard!.toBlob(r, 'image/png'));
  if (!blob) return;
  const file = new File([blob], `kaleidoscope-${Date.now()}.png`, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file] });
      return;
    } catch {
      /* 閉じられた */
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
});
$('#again').addEventListener('click', () => {
  closeAppraisal();
  setStage('look');
});
$('#restart').addEventListener('click', () => {
  closeAppraisal();
  shared = null;
  history.replaceState(null, '', location.pathname);
  $<HTMLInputElement>('#name').value = '';
  toWindow();
});

// ---------- ボタン ----------
$('#start').addEventListener('click', () => {
  sound.unlock();
  sound.tick();
  if (shared) {
    shared = null;
    history.replaceState(null, '', location.pathname);
  }
  toWindow();
});
$('#peek').addEventListener('click', async () => {
  sound.unlock();
  body.classList.add('busy');
  await tween(500, (t) => (v.iris = 1.3 - t * 1.3), easeIO);
  setStage('look');
  layout();
  Object.assign(v, { R: goal.R, cx: goal.cx, cy: goal.cy });
  sound.setMuffle(0.72);
  sound.open();
  auto = 5.5;
  await tween(2800, (t) => (v.iris = t * 1.08), easeIO);
  body.classList.remove('busy');
});
$('#next').addEventListener('click', () => {
  sound.unlock();
  sound.tick();
  if (shared && stage === 'look') {
    shared = null;
    history.replaceState(null, '', location.pathname);
    sound.setMuffle(0);
    return toWindow();
  }
  if (stage === 'fill1') {
    setStage('fill2');
    say(cell.bodies.length ? 'なにで満たす？' : '……からっぽだけど、いいの？');
  } else if (stage === 'fill2') toLook();
  else if (stage === 'look') {
    setStage('name');
    setTimeout(() => $<HTMLInputElement>('#name').focus({ preventScroll: true }), 380);
  } else if (stage === 'name') doAppraise();
});
$<HTMLInputElement>('#name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) {
    e.preventDefault();
    doAppraise();
  }
});
document.querySelectorAll<HTMLElement>('.steps li').forEach((li, i) =>
  li.addEventListener('click', () => {
    if (!li.classList.contains('done')) return;
    const to = ORDER[i];
    sound.tick();
    if (to === 'fill1' || to === 'fill2') {
      sound.setMuffle(0);
      v.mode = 0;
      v.ring = 1;
      v.edge = 0;
      v.trail = 0;
      v.back = 0.028;
      v.bloom = 0.7;
      cell.angle = 0;
      setStage(to);
    } else setStage(to);
  }),
);
$('#snd').addEventListener('click', () => {
  sound.unlock();
  const on = !sound.enabled;
  sound.setEnabled(on);
  $('#snd').setAttribute('aria-pressed', String(on));
});

// ---------- ループ ----------
function resize() {
  R.resize(innerWidth, innerHeight, Math.min(2, window.devicePixelRatio || 1));
  layout();
  Object.assign(v, { R: goal.R, cx: goal.cx, cy: goal.cy });
}
addEventListener('resize', () => requestAnimationFrame(resize));

let last = performance.now();
let acc = 0;
function frame(now: number) {
  if (import.meta.env.DEV) (window as unknown as { __k: unknown }).__k = { cell, v };
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  R.time += dt;
  // 回転
  if (!drag.on) {
    if (auto > 0) {
      auto -= dt;
      const target = 0.26 * Math.min(1, auto / 1.5);
      angVel += (target - angVel) * Math.min(1, dt * 2);
    } else if (stage === 'intro') {
      angVel += (0.12 - angVel) * Math.min(1, dt * 0.8);
    } else {
      angVel *= Math.exp(-dt * 1.6);
    }
    cell.angle += angVel * dt;
  }
  const g = tiltOn ? tiltG : -Math.PI / 2;
  let dg = g - cell.gdir;
  dg = Math.atan2(Math.sin(dg), Math.cos(dg));
  cell.gdir += dg * Math.min(1, dt * 5);
  // 物理（120Hz）
  acc += dt;
  const av = drag.on ? drag.vel : angVel;
  let n = 0;
  while (acc >= 1 / 120 && n < 5) {
    cell.step(1 / 120, av);
    acc -= 1 / 120;
    n++;
  }
  if (acc > 0.05) acc = 0;
  // 音
  if (cell.hits.length) {
    const hs = cell.hits.sort((a, b) => b.speed - a.speed).slice(0, 2);
    for (const h of hs) sound.hit(h.kind, h.other, h.speed, h.x, h.wet, h.r, cell.liquid?.id ?? null);
    cell.hits.length = 0;
  }
  if (stage !== 'intro') {
    let sm = 0;
    let cnt = 0;
    for (const b of cell.bodies)
      if (b.small) {
        sm += Math.hypot(b.vx, b.vy);
        cnt++;
      }
    sound.flow(cnt ? Math.min(1, (sm / cnt) * 6) * Math.min(1, cnt / 80) : 0);
  }
  // 鏡は、ビーズが集まっているほうへゆっくり向く
  {
    let sx = 0;
    let sy = 0;
    const ca = Math.cos(cell.angle);
    const sa = Math.sin(cell.angle);
    for (const b of cell.bodies) {
      const m = b.small ? b.r * b.r * 0.3 : b.r * b.r;
      sx += (b.x * ca - b.y * sa) * m;
      sy += (b.x * sa + b.y * ca) * m;
    }
    const target = Math.hypot(sx, sy) > 1e-4 ? Math.atan2(sy, sx) : cell.gdir;
    let dw = target - v.wedge;
    dw = Math.atan2(Math.sin(dw), Math.cos(dw));
    v.wedge += dw * Math.min(1, dt * 0.8);
  }
  // 位置
  const k = 1 - Math.exp(-dt * 7);
  v.R += (goal.R - v.R) * k;
  v.cx += (goal.cx - v.cx) * k;
  v.cy += (goal.cy - v.cy) * k;
  v.tint = TINTS[tintIdx].rgb;
  v.mirrors = stage === 'intro' ? 8 : mirrors;
  const L = cell.liquid;
  R.drawChamber(cell, v, L ? { film: L.film, wobble: L.wobble } : null);
  R.present(cell, v);
  if (v.mode === 0) placeEngrave();
  requestAnimationFrame(frame);
}

// ---------- はじめ ----------
function boot() {
  buildLiquids();
  buildTray();
  preloadKuma();
  const m = location.hash.match(/k=([\w-]+)/);
  if (m) {
    const c = new Cell();
    const rec = decode(m[1], c, rnd);
    if (rec) {
      cell = c;
      mirrors = rec.mirrors;
      tintIdx = rec.tint;
      liquidIdx = rec.liquid;
      shared = { name: rec.name };
      document.querySelectorAll('[data-mirrors]').forEach((x) => x.setAttribute('aria-checked', String(Number((x as HTMLElement).dataset.mirrors) === mirrors)));
      $('.lede').innerHTML = `「${escapeHtml(rec.name)}」が届きました。<br />筒をのぞいて、回してみてください。`;
      $('#peek').hidden = false;
      $('#start .cta-label').textContent = '自分もつくる';
      // のぞくを主役に
      $('#intro').insertBefore($('#peek'), $('#start'));
      $('#peek').classList.remove('ghost');
      $('#start').classList.add('ghost');
    }
  }
  if (!shared) cell = sample(20261029);
  const dev = import.meta.env.DEV ? new URLSearchParams(location.search).get('dev') : null;
  if (dev) {
    v.fade = 1;
    v.mode = dev === 'fill1' || dev === 'fill2' ? 0 : 1;
    if (dev === 'og') v.mirrors = 8;
    v.ring = v.mode ? 0 : 1;
    v.edge = v.mode;
    v.trail = v.mode * 0.5;
    if (dev === 'og') body.classList.add('og');
    v.back = v.mode ? 0.02 : 0.028;
    if (v.mode) cell.lift(rnd);
    v.iris = 1.08;
    if (dev === 'fill1') cell.liquid = null;
    if (dev !== 'fill1') liquidIdx = 1;
    cell.level = cell.levelTarget = cell.liquid ? 1 : 0;
    resize();
    setStage(dev === 'og' ? 'intro' : (dev as Stage));
    resize();
    requestAnimationFrame((t) => {
      last = t;
      requestAnimationFrame(frame);
    });
    return;
  }
  v.mirrors = mirrors;
  resize();
  setStage('intro');
  requestAnimationFrame((t) => {
    last = t;
    requestAnimationFrame(frame);
  });
  tween(1600, (t) => (v.fade = t), easeO);
}
function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
boot();
