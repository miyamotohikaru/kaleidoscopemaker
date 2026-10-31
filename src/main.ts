import './style.css';
import { GEM, Kind, LIQUIDS, MORTAR_STONES, SHELF, TINTS, type GemName, type Item } from './catalog';
import { Cell, mulberry, type Body } from './sim';
import { Renderer, type ViewState } from './render';
import { sound, vowelOf } from './audio';
import { Mortar, type PhotoPiece } from './mortar';
import { appraise, measure, RANKS } from './appraise';
import { drawCard } from './card';
import { decode, dust, encode } from './share';
import { Kuma3D, preloadKuma } from './kuma3d';
import { Pour3D } from './pour3d';
import { deleteCert, fmtDate, listCerts, putCert, thumbOf, toBlob, type Cert } from './archive';

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
  bloom: 0.6,
  back: 0.02,
  tint: [1, 1, 1],
  span: 0.95,
  wedge: -Math.PI / 2,
  guide: 0,
};
// 位置と大きさは目標へなめらかに寄せる
const goal = { R: 300, cx: 200, cy: 400 };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

function addItem(it: Item, at?: [number, number]) {
  const [x, y] = at ?? cell.dropPoint(rnd);
  if (it.pinch) {
    if (smallCount() >= MAX_SMALL) return say('もう、入らないかも。');
    for (let i = 0; i < it.pinch; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * 0.09;
      const b = makeBody(it, x + Math.cos(a) * r, y + Math.sin(a) * r);
      b.vx = Math.cos(a) * 0.25 * rnd();
      b.vy = Math.sin(a) * 0.25 * rnd();
      cell.add(b);
    }
  } else {
    if (bigCount() >= MAX_BIG) return say('もう、いっぱい。');
    const b = makeBody(it, x, y);
    b.vx = b.vy = 0;
    cell.add(b);
    if (it.kind === Kind.Charm && cell.bodies.filter((o) => o.kind === Kind.Charm).length === 1) say('それ、ぼく。');
  }
  sound.drop(it.kind, (it.size[0] + it.size[1]) / 2, x * 0.6, cell.liquid && cell.level > 0.3 ? cell.liquid.id : null);
  updateCount();
}

function updateCount() {
  $('#count').textContent = String(bigCount());
}

// 入口の見本：宝石のかけらと金だけで、すき間なく詰めた結晶のような万華鏡。
// 丸いガラス玉は入れない（鏡で伸びて飴玉のように見えるため）。真ん中は透明なかけらと金で光の芯をつくる
const SAMPLE_CENTER = ['gold', 'm-clr', 'gold', 'm-clr', 'm-ame'];
const SAMPLE_FIELD = ['m-sap', 'm-eme', 'm-clr', 'gold', 'm-sap', 'm-ame', 'm-clr', 'm-eme', 'gold', 'm-clr', 'm-sap'];
function sample(seed: number) {
  const r = mulberry(seed);
  const c = new Cell();
  const add = (id: string, x: number, y: number) => c.add(makeBody(SHELF.find((s) => s.id === id)!, x, y, r()));
  for (const [k, id] of SAMPLE_CENTER.entries()) {
    const a = (k / SAMPLE_CENTER.length) * Math.PI * 2 + r() * 0.5;
    const d = 0.03 + r() * 0.12;
    add(id, Math.cos(a) * d, Math.sin(a) * d);
  }
  for (let k = 0; k < 48; k++) {
    const a = r() * Math.PI * 2;
    const d = 0.2 + Math.sqrt(r()) * 0.68;
    add(SAMPLE_FIELD[k % SAMPLE_FIELD.length], Math.cos(a) * d, Math.sin(a) * d);
  }
  for (let i = 0; i < 160; i++) c.add(dust(i % 3 === 2 ? 'rainbow' : 'gold', r));
  c.liquid = LIQUIDS[1];
  c.level = c.levelTarget = 1;
  c.vol = 1;
  c.flat = false;
  c.gs = 0.05;
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
  if (html.length % 2) html.push('<div class="slot filler" aria-hidden="true"></div>');
  tray.innerHTML = html.join('');
  // つまんで上へすべらせ、筒の好きな場所で離す（指で隠れないよう、少し上に浮かせて運ぶ）
  const LIFT = 40;
  // 横スクロールもこちらで受け持つ（ブラウザに任せると、斜めに引いたときに「スクロール」と判定されて運べなくなる）
  const pick = { id: -1, el: null as HTMLElement | null, sx: 0, sy: 0, ghost: null as HTMLImageElement | null, it: null as Item | null, scroll: false, left: 0, lx: 0, lt: 0, vel: 0 };
  let noClick = 0;
  let glide = 0;
  tray.addEventListener('pointerdown', (e) => {
    const el = (e.target as HTMLElement).closest('.slot') as HTMLElement | null;
    cancelAnimationFrame(glide);
    tray.classList.remove('free');
    Object.assign(pick, {
      id: e.pointerId, el, sx: e.clientX, sy: e.clientY, ghost: null, scroll: false,
      it: el?.dataset.id ? SHELF.find((s) => s.id === el.dataset.id) ?? null : null,
      left: tray.scrollLeft, lx: e.clientX, lt: performance.now(), vel: 0,
    });
  });
  tray.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pick.id) return;
    const dx = e.clientX - pick.sx;
    const dy = e.clientY - pick.sy;
    if (pick.scroll) {
      tray.scrollLeft = pick.left - dx;
      const now = performance.now();
      pick.vel = pick.vel * 0.6 + ((pick.lx - e.clientX) / Math.max(8, now - pick.lt)) * 0.4;
      pick.lx = e.clientX;
      pick.lt = now;
      return;
    }
    if (!pick.ghost) {
      // 上へ動いたら持ち上げる。横へ動いたら棚を送る
      if (pick.it && -dy >= 8 && -dy >= Math.abs(dx) * 0.5) {
        sound.unlock();
        sound.slide();
        const g = document.createElement('img');
        g.className = 'drag-ghost';
        g.src = pick.el!.querySelector('img')!.src;
        document.body.appendChild(g);
        pick.ghost = g;
        pick.el!.classList.add('holding');
        tray.setPointerCapture(e.pointerId);
      } else if (Math.abs(dx) >= 8) {
        pick.scroll = true;
        pick.sx = e.clientX;
        tray.classList.add('free');
        pick.lx = e.clientX;
        tray.setPointerCapture(e.pointerId);
        return;
      } else return;
    }
    const it = pick.it!;
    const gy = e.clientY - LIFT;
    const over = Math.hypot(e.clientX - v.cx, gy - v.cy) < v.R * 0.98;
    // 筒の上では、実際に入る大きさまで縮む
    const sz = over ? ghostSize(it) : 64;
    pick.ghost!.style.width = pick.ghost!.style.height = sz + 'px';
    pick.ghost!.style.transform = `translate(${e.clientX - sz / 2}px, ${gy - sz / 2}px)`;
    pick.ghost!.classList.toggle('over', over);
  });
  const drop = (e: PointerEvent) => {
    if (e.pointerId !== pick.id) return;
    const g = pick.ghost;
    pick.id = -1;
    if (pick.scroll) {
      // 離したあとも少し滑る
      noClick = performance.now();
      let vel = pick.vel * 16;
      const step = () => {
        vel *= 0.94;
        tray.scrollLeft += vel;
        if (Math.abs(vel) > 0.3) glide = requestAnimationFrame(step);
        else tray.classList.remove('free'); // 止まったら升目にそろえる
      };
      glide = requestAnimationFrame(step);
      return;
    }
    pick.el?.classList.remove('holding');
    if (!g || !pick.it) return;
    noClick = performance.now();
    const gy = e.clientY - LIFT;
    const over = Math.hypot(e.clientX - v.cx, gy - v.cy) < v.R * 0.95;
    if (over && e.type === 'pointerup') {
      addItem(pick.it, clampIn(...toCell(e.clientX, gy), pick.it.size[1]));
      g.remove();
    } else {
      g.classList.add('back');
      setTimeout(() => g.remove(), 300);
    }
  };
  tray.addEventListener('pointerup', drop);
  tray.addEventListener('pointercancel', drop);
  tray.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest('.slot') as HTMLElement | null;
    if (!el || performance.now() - noClick < 400) return;
    sound.unlock();
    if (el.dataset.drawer === 'mortar') return openMortar();
    if (el.dataset.drawer === 'photo') {
      sound.slide();
      return $<HTMLInputElement>('#photo').click();
    }
    // 押しただけでは入らない。上にすべらせて運ぶことを、粒が跳ねて教える
    el.classList.remove('nudge');
    void el.offsetWidth;
    el.classList.add('nudge');
    sound.tick();
    say('上にすべらせて、筒まで運んで。');
  });
}

function ghostSize(it: Item) {
  return Math.max(14, ((it.size[0] + it.size[1]) / 2) * v.R * 2 * (it.pinch ? 6 : 1.3));
}
function clampIn(x: number, y: number, r: number): [number, number] {
  const d = Math.hypot(x, y);
  const lim = 0.92 - r;
  return d > lim ? [(x * lim) / d, (y * lim) / d] : [x, y];
}
function shortLabel(s: string) {
  return s.replace('のガラス玉', '').replace('のかけら', '').replace('のラメ', 'ラメ').replace('こすくまくん', 'ちゃーむ');
}

// ---------- 写真の破片（端末の中だけで処理） ----------
// 写真は乳鉢に入れて、自分で好きな細かさまですりつぶす
let photoCanvas: HTMLCanvasElement | null = null;
$<HTMLInputElement>('#photo').addEventListener('change', async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!f) return;
  try {
    const bmp = await createImageBitmap(f);
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const x = c.getContext('2d', { willReadFrequently: true })!;
    const s = Math.min(bmp.width, bmp.height);
    x.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 512, 512);
    photoCanvas = c;
    openMortar(c);
  } catch {
    say('その写真は、読めなかった。');
  }
});

// ---------- 乳鉢 ----------
const mortar = new Mortar($<HTMLCanvasElement>('#mortar-cv'));
const spriteCache = new Map<GemName, { crystal: HTMLImageElement; shards: HTMLImageElement[] }>();
mortar.getSprites = (color) => {
  const hit = spriteCache.get(color);
  if (hit) return hit;
  const img = (src: string) => Object.assign(new Image(), { src });
  const mk = (seed: number, r: number) => {
    const b = makeBody({ id: 'm', label: '', kind: Kind.Mineral, color, size: [r, r], density: 2.6 }, 0, 0, seed);
    b.a = 0;
    return img(R.tile([b], r * 1.15, 192));
  };
  const out = { crystal: mk(0.37, 0.3), shards: [0.11, 0.53, 0.71, 0.92].map((sd) => mk(sd, 0.2)) };
  spriteCache.set(color, out);
  return out;
};
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
function addPhotoPieces(pieces: PhotoPiece[], img: HTMLCanvasElement) {
  // 大きい順に 24 個まで。かけらの形の外枠を、写真のどこを映すかに使う
  const use = pieces.slice(0, 24);
  const rects: [number, number, number, number][] = use.map((p) => {
    const us = p.poly.map((q) => q[0]);
    const vs = p.poly.map((q) => q[1]);
    const u0 = Math.min(...us), v0 = Math.min(...vs);
    const w = Math.max(Math.max(...us) - u0, Math.max(...vs) - v0, 0.02);
    // 画像の上下（canvas は上が 0、テクスチャは下が 0）
    return [u0, 1 - v0 - w, w, w];
  });
  R.setPhoto(img, rects);
  cell.bodies = cell.bodies.filter((b) => b.kind !== Kind.Photo);
  use.forEach((p, i) => {
    if (bigCount() >= MAX_BIG) return;
    const r = Math.max(0.025, Math.min(0.22, Math.sqrt(p.area) * 0.42));
    const [x, y] = clampIn(p.x * 0.7, -p.y * 0.7, r);
    const b = makeBody({ id: 'photo', label: '写真', kind: Kind.Photo, color: 'clear', size: [r, r], density: 1.2 }, x, y);
    b.photo = i;
    b.vx = b.vy = 0;
    cell.add(b);
  });
  sound.sprinkle((sound.ctx?.currentTime ?? 0) + 0.02, 0.6);
  updateCount();
}

const GRIND_WORDS: [number, string][] = [
  [0, '原石'],
  [0.14, 'かけら'],
  [0.45, '粗い粉'],
  [0.8, 'きらきらの粉'],
];
mortar.onProgress = (p) => {
  $('#grind-bar').style.width = `${p * 100}%`;
  if (mortar.photo) {
    const n = mortar.pieces.length;
    $('#grind-word').textContent = n <= 1 ? 'まだ一枚' : n > 40 ? 'こまかい' : `${n} かけら`;
    $<HTMLButtonElement>('#mortar-add').disabled = false;
    return;
  }
  $('#grind-word').textContent = GRIND_WORDS.filter(([t]) => p >= t).pop()![1];
  $<HTMLButtonElement>('#mortar-add').disabled = p < 0.14;
};
function openMortar(photo?: HTMLCanvasElement) {
  sound.slide();
  buildStones();
  $('#stones').hidden = !!photo;
  $('#mortar .sheet-title').firstChild!.textContent = photo ? '写真を砕く' : '乳鉢';
  $('#mortar').hidden = false;
  mortar.photo = null;
  requestAnimationFrame(() => (photo ? mortar.openPhoto(photo) : mortar.open(stone)));
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
  if (res.photo && photoCanvas) return addPhotoPieces(res.photo, photoCanvas);
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
  liquidIdx = i;
  const L = LIQUIDS[i];
  cell.liquid = L;
  sound.tick();
  say(cell.levelTarget > 0.02 ? 'まぜるの？　……いいけど。' : '筒の上を、長押しして注いで。');
  setNext();
});
$('#tints').addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest('.tint') as HTMLElement | null;
  if (!el) return;
  tintIdx = Number(el.dataset.i);
  document.querySelectorAll('.tint').forEach((s) => s.setAttribute('aria-checked', String(s === el)));
  sound.tick();
});

const KANJI = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
function updateAmount() {
  const el = $('#amount');
  const l = cell.liquid ? cell.levelTarget : 0;
  // 棒のメーター：注いだ量と、筒の中で混ざった液の色
  const f = $('#m-fill');
  f.style.width = `${(l * 100).toFixed(1)}%`;
  const c = cell.tint.map((x) => Math.round(255 * Math.pow(Math.min(1, x), 1 / 2.2)));
  f.style.background = `rgb(${c.join(',')})`;
  if (l < 0.03) el.textContent = '筒の上を長押しすると、注げます';
  else if (l >= 0.995) el.textContent = 'なみなみ';
  else el.textContent = `いま ${KANJI[Math.max(1, Math.min(9, Math.round(l * 10)))]}分目`;
}

// ---------- 鏡の数 ----------
document.querySelectorAll<HTMLButtonElement>('[data-mirrors]').forEach((b) =>
  b.addEventListener('click', () => {
    sound.unlock();
    mirrors = Number(b.dataset.mirrors);
    document.querySelectorAll('[data-mirrors]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    sound.tick();
    guide = 3.2;
    say(MIRROR_LINES[mirrors], 3400);
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

const MIRROR_LINES: Record<number, string> = {
  6: '6つに折り返す。ひとつずつが、大きく映るよ。',
  8: '8つ。いちばん、まとまりがいいと思う。',
  12: '12。細かくて、くらくらするやつ。',
};
let guide = 0; // 鏡の線を筒に重ねて見せる残り時間

// ---------- こすくまくんのひとこと ----------
let sayTimer = 0;
let sayToken = 0;
async function say(text: string, ms = 2600) {
  const el = $('#say');
  const p = el.querySelector('p')!;
  const my = ++sayToken;
  clearTimeout(sayTimer);
  p.textContent = '';
  el.classList.add('show');
  await typeOut(p, text, () => my === sayToken);
  if (my !== sayToken) return;
  sayTimer = window.setTimeout(() => el.classList.remove('show'), ms);
}

// 1文字ずつ出す。声は鳴らさず、キーボードを打つ音だけ（ASMR）。打つ間隔は人の手のように少し揺らす
const STEP = 0.12;
async function typeOut(el: HTMLElement, text: string, alive: () => boolean = () => true) {
  const chars = [...text];
  let shown = '';
  for (let i = 0; i < chars.length; i++) {
    if (!alive()) return;
    const c = chars[i];
    shown += c;
    el.textContent = shown;
    sound.key(c === '\n' ? 'enter' : /[\s、。！？…]/.test(c) ? 'space' : 'char');
    const jitter = 0.75 + Math.random() * 0.5;
    if (c === '…') {
      await wait(150 * jitter);
      continue;
    }
    if (/[、。！？\n]/.test(c)) {
      await wait((c === '、' || c === '\n' ? 220 : 280) * jitter);
      continue;
    }
    await wait((vowelOf(c) ? STEP * 1000 : 70) * jitter);
  }
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
  const [n, l] = shared && stage === 'look' ? ['i', '自分もつくる'] : returnTo && stage === 'look' ? ['', '鑑定書に戻る'] : NEXT[stage] ?? ['', ''];
  $('#next-num').textContent = n;
  $('#next-label').textContent = l;
  $<HTMLButtonElement>('#next').disabled = stage === 'fill2' && (!cell.liquid || cell.levelTarget < 0.05);
  // 名前がないうちは鑑定に進めない（押すと、こすくまくんが名前を頼む）
  $('#next').classList.toggle('wait', stage === 'name' && !named());
}
const named = () => $<HTMLInputElement>('#name').value.trim().length > 0;
function tryAppraise() {
  if (named()) return doAppraise();
  say('名前、つけてあげて。');
  $<HTMLInputElement>('#name').focus({ preventScroll: true });
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
    // できあがった万華鏡は、円の端まで全部見えるように（左右に少し余白）
    goal.R = Math.max(120, Math.min(w / 2 - 10, avail / 2, 420));
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
let touchTime = 0;
// 鑑定書から「もう一度のぞく」で来たとき、戻る先
let returnTo: null | 'appraisal' | Cert = null;
let tilt = 0;
let pour3d: Pour3D | null = null;
async function toWindow() {
  returnTo = null;
  touchTime = 0;
  session = null;
  $('#resume').hidden = true;
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
  say('棚から、上にすべらせて入れて。');
}

async function toLook() {
  body.classList.add('busy');
  sound.close();
  stopPour();
  const R0 = v.R;
  await tween(800, (t) => {
    v.fade = 1 - t;
    goal.R = v.R = R0 * (1 + t * 0.7);
  }, easeIO);
  cell.level = cell.levelTarget;
  // 筒を立てて目に当てる：ここから重力
  cell.flat = false;
  v.mode = 1;
  v.ring = 0;
  v.mirrors = mirrors;
  v.back = 0.02;
  v.bloom = 0.55;
  v.edge = 1;
  v.trail = 0.3;
  v.iris = 0;
  v.fade = 1;
  setStage('look');
  layout();
  Object.assign(v, { R: goal.R, cx: goal.cx, cy: goal.cy });
  sound.setMuffle(0.72);
  sound.open();
  auto = 5.5;
  await tween(2800, (t) => (v.iris = t * 1.08), easeIO);
  body.classList.remove('busy');
}

// ---------- 指で触る ----------
// 入れる＝筒の中をかき混ぜる／満たす＝長押しで注ぐ／のぞく＝縁をなぞって回す
const drag = { on: false, id: -1, last: 0, t: 0, vel: 0 };
let angVel = 0;
const finger = { on: false, id: -1, x: 0, y: 0, vx: 0, vy: 0, t: 0 };
const grab = { b: null as Body | null, id: -1, x: 0, y: 0, vx: 0, vy: 0, t: 0 };
const pour = { on: false, id: -1, x: 0, amt: 0 };
function ang(e: PointerEvent) {
  return Math.atan2(-(e.clientY - v.cy), e.clientX - v.cx);
}
function toCell(cx: number, cy: number): [number, number] {
  const x = (cx - v.cx) / v.R;
  const y = -(cy - v.cy) / v.R;
  const c = Math.cos(-cell.angle);
  const s = Math.sin(-cell.angle);
  return [x * c - y * s, x * s + y * c];
}
const POUR_RATE: Record<string, number> = { water: 0.2, oil: 0.15, honey: 0.08 };
// 瓶の中の液の色（液そのものの色 × 選んだ色）
function bottleColor(): [number, number, number] {
  const b = cell.liquid?.base ?? [1, 1, 1];
  const t = TINTS[tintIdx].rgb;
  return [b[0] * t[0], b[1] * t[1], b[2] * t[2]];
}
canvas.addEventListener('pointerdown', (e) => {
  sound.unlock();
  if (body.classList.contains('busy')) return;
  canvas.setPointerCapture(e.pointerId);
  if (stage === 'fill1') {
    const [x, y] = toCell(e.clientX, e.clientY);
    // 置いた粒をつまんで動かす
    let best: Body | null = null;
    let bd = 1e9;
    for (const b of cell.bodies) {
      if (b.small) continue;
      const d = Math.hypot(b.x - x, b.y - y) / (b.r * 1.25);
      if (d < 1 && d < bd) {
        bd = d;
        best = b;
      }
    }
    if (best) {
      Object.assign(grab, { b: best, id: e.pointerId, x, y, vx: 0, vy: 0, t: performance.now() });
      sound.tick(x);
      return;
    }
    Object.assign(finger, { on: true, id: e.pointerId, x, y, vx: 0, vy: 0, t: performance.now() });
    return;
  }
  if (stage === 'fill2') {
    if (!cell.liquid) {
      say('先に、瓶をえらんで。');
      return;
    }
    if (cell.level >= 0.999) {
      say('もう、いっぱい。');
      return;
    }
    Object.assign(pour, { on: true, id: e.pointerId, x: pourX(e.clientX) });
    sound.pour(cell.liquid.id, 600);
    return;
  }
  drag.on = true;
  drag.id = e.pointerId;
  drag.last = ang(e);
  drag.t = performance.now();
  drag.vel = 0;
  auto = 0;
});
function pourX(clientX: number) {
  return Math.max(-0.62, Math.min(0.62, (clientX - v.cx) / v.R));
}
canvas.addEventListener('pointermove', (e) => {
  if (grab.b && e.pointerId === grab.id) {
    const [x, y] = clampIn(...toCell(e.clientX, e.clientY), grab.b.r);
    const now = performance.now();
    const dt = Math.max(8, now - grab.t) / 1000;
    Object.assign(grab, { vx: (x - grab.x) / dt, vy: (y - grab.y) / dt, x, y, t: now });
    return;
  }
  if (finger.on && e.pointerId === finger.id) {
    const [x, y] = toCell(e.clientX, e.clientY);
    const now = performance.now();
    const dt = Math.max(8, now - finger.t) / 1000;
    finger.vx = finger.vx * 0.5 + ((x - finger.x) / dt) * 0.5;
    finger.vy = finger.vy * 0.5 + ((y - finger.y) / dt) * 0.5;
    Object.assign(finger, { x, y, t: now });
    return;
  }
  if (pour.on && e.pointerId === pour.id) {
    pour.x = pourX(e.clientX);
    return;
  }
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
function stopPour() {
  if (!pour.on) return;
  pour.on = false;
  sound.pourStop();
  setNext();
}
const release = (e: PointerEvent) => {
  if (grab.b && e.pointerId === grab.id) {
    grab.b.vx = Math.max(-1, Math.min(1, grab.vx)) * 0.3;
    grab.b.vy = Math.max(-1, Math.min(1, grab.vy)) * 0.3;
    grab.b = null;
  }
  if (e.pointerId === finger.id) finger.on = false;
  if (e.pointerId === pour.id) stopPour();
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
let tiltX = 0; // 左右の傾き -1..1
function onMotion(e: DeviceMotionEvent) {
  const g = e.accelerationIncludingGravity;
  if (!g || g.x == null || g.y == null) return;
  if (!tiltSign) tiltSign = (g.y ?? 0) > 0 ? -1 : 1;
  tiltX = Math.max(-1, Math.min(1, (g.x * tiltSign) / 9.8));
  if (Math.hypot(g.x, g.y) < 2.5) return;
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
  auto = 0;
  say('スマホを、左右に傾けてみて。');
});

// ---------- 名付ける・鑑定 ----------
let kuma: Kuma3D | null = null;
let lastCard: HTMLCanvasElement | null = null;
let lastName = '';
let lastCode = '';

async function doAppraise() {
  returnTo = null;
  const input = $<HTMLInputElement>('#name');
  input.blur();
  const name = input.value.trim().slice(0, 24);
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
  $('#kept').textContent = '';
  sound.setMuffle(0);
  say2.classList.remove('show');
  ap.hidden = false;
  ap.scrollTop = 0;
  if (!kuma) kuma = new Kuma3D($<HTMLCanvasElement>('#kuma'));
  const st = $('#kuma').getBoundingClientRect();
  kuma.resize(st.width, st.height);
  kuma.lean = 0;
  kuma.start();
  const scope = R.snapshot(cell, v, 1024);
  const tinted = Math.max(...cell.tint) - Math.min(...cell.tint) > 0.12 ? 'color' : 'none';
  const look = measure(scope);
  const verdict = appraise(cell, mirrors, tinted, name, look);
  if (import.meta.env.DEV) console.log('appraise', JSON.stringify({ look, score: Math.round(verdict.score), rank: verdict.rankName }));
  if (import.meta.env.DEV) {
    const force = new URLSearchParams(location.search).get('rank');
    if (force) Object.assign(verdict, { rank: +force, rankName: RANKS[+force], pos: (+force + 0.5) / 7 });
  }
  const cardP = drawCard(scope, name, verdict, DOMAIN);
  await wait(500);
  kuma.setScope(scope);
  kuma.peek = 0;
  kuma.react(0);
  await speak(say2, 'ちょっと貸して。');
  // 万華鏡を持ち上げて、片眼鏡の目に当てる
  await tween(1100, (t) => kuma && ((kuma.peek = t), (kuma.lean = t)), easeIO);
  sound.monocle();
  await wait(400);
  say2.classList.remove('show');
  await wait(350);
  say2.textContent = '……';
  say2.classList.add('show');
  await wait(2200);
  const card = await cardP;
  lastCard = card;
  lastCode = code;
  $<HTMLImageElement>('#cert-img').src = card.toDataURL('image/jpeg', 0.92);
  await tween(800, (t) => kuma && ((kuma.lean = 1 - t), (kuma.peek = 1 - t)), easeIO);
  say2.classList.remove('show');
  cert.classList.add('show');
  sound.stamp();
  sound.verdict(verdict.rank);
  kuma.react(verdict.rank >= 5 ? 1 : verdict.rank <= 1 ? -1 : 0);
  acts.classList.add('show');
  // 鑑定書は出た瞬間にしまう（途中で離れても残る）
  try {
    const [blob, thumb] = await Promise.all([toBlob(card), thumbOf(card)]);
    await putCert({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, rankName: verdict.rankName, rank: verdict.rank, line: verdict.line, date: Date.now(), code, card: blob, thumb });
    $('#kept').textContent = '鑑定書を、一覧にしまいました。';
    refreshArchCount();
  } catch {
    $('#kept').textContent = 'この端末には、しまえませんでした。画像を保存してください。';
  }
  await wait(500);
  await speak(say2, verdict.line);
}

async function speak(el: HTMLElement, text: string) {
  el.textContent = '';
  el.classList.add('show');
  await typeOut(el, text);
}

function closeAppraisal() {
  $('#appraisal').hidden = true;
  kuma?.stop();
}

function postX(name: string, code: string) {
  const url = `${location.origin}${location.pathname}#k=${code}`;
  const text = `「${name}」をのぞきました。\n#万華鏡メーカー`;
  window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank', 'noopener');
}
async function saveImage(blob: Blob, name: string) {
  const file = new File([blob], `${name || 'kaleidoscope'}.${blob.type === 'image/png' ? 'png' : 'jpg'}`, { type: blob.type });
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
}
$('#post').addEventListener('click', () => postX(lastName, lastCode));
$('#save').addEventListener('click', async () => {
  if (lastCard) saveImage(await toBlob(lastCard, 'image/png'), lastName);
});

// ---------- 鑑定書一覧 ----------
let certs: Cert[] = [];
let current: Cert | null = null;
const urls: string[] = [];
async function refreshArchCount() {
  certs = await listCerts();
  document.querySelectorAll('.arch-n').forEach((el) => (el.textContent = certs.length ? String(certs.length) : ''));
  $('#intro-arch').hidden = certs.length === 0;
}
async function openArchive() {
  sound.unlock();
  sound.slide();
  await refreshArchCount();
  urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
  $('#arch-count').textContent = certs.length ? `${certs.length} 枚` : '';
  $('#arch-empty').hidden = certs.length > 0;
  $('#arch-grid').innerHTML = certs
    .map((c, i) => {
      const u = URL.createObjectURL(c.thumb);
      urls.push(u);
      return `<li class="arch-item"><button type="button" data-i="${i}"><img src="${u}" alt="" loading="lazy" /><b>「${escapeHtml(c.name)}」</b><span><em>${escapeHtml(c.rankName)}</em>${fmtDate(c.date)}</span></button></li>`;
    })
    .join('');
  $('#archive').hidden = false;
  $('#archive').scrollTop = 0;
}
$('#arch-grid').addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest('button[data-i]') as HTMLElement | null;
  if (!el) return;
  current = certs[Number(el.dataset.i)];
  if (!current) return;
  sound.tick();
  const img = $<HTMLImageElement>('#detail-img');
  if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
  img.src = URL.createObjectURL(current.card);
  $('#detail-date').textContent = fmtDate(current.date);
  $('#detail-del').classList.remove('armed');
  $('#detail-del span').textContent = '手放す';
  $('#arch-detail').hidden = false;
  $('#arch-detail').scrollTop = 0;
});
$('#intro-arch').addEventListener('click', openArchive);
$('#ap-arch').addEventListener('click', openArchive);
$('#arch-close').addEventListener('click', () => {
  sound.tick();
  $('#archive').hidden = true;
});
$('#detail-back').addEventListener('click', () => {
  sound.tick();
  $('#arch-detail').hidden = true;
});
$('#detail-save').addEventListener('click', () => current && saveImage(current.card, current.name));
$('#detail-post').addEventListener('click', () => current && postX(current.name, current.code));
$('#detail-del').addEventListener('click', async () => {
  const b = $('#detail-del');
  if (!current) return;
  // 1回目は確かめるだけ（ブラウザの確認窓は使わない）
  if (!b.classList.contains('armed')) {
    b.classList.add('armed');
    b.querySelector('span')!.textContent = 'もう一度押す';
    return;
  }
  await deleteCert(current.id);
  current = null;
  $('#arch-detail').hidden = true;
  openArchive();
});
$('#detail-look').addEventListener('click', async () => {
  if (!current) return;
  const c = new Cell();
  const rec = decode(current.code, c, rnd);
  if (!rec) return;
  sound.unlock();
  $('#arch-detail').hidden = true;
  $('#archive').hidden = true;
  closeAppraisal();
  cell = c;
  mirrors = rec.mirrors;
  tintIdx = rec.tint;
  liquidIdx = rec.liquid;
  shared = null;
  lastName = rec.name;
  lastCode = current.code;
  $<HTMLInputElement>('#name').value = rec.name;
  returnTo = current;
  history.replaceState(null, '', `#k=${current.code}`);
  document.querySelectorAll('[data-mirrors]').forEach((x) => x.setAttribute('aria-checked', String(Number((x as HTMLElement).dataset.mirrors) === mirrors)));
  await openScope();
});

$('#again').addEventListener('click', () => {
  closeAppraisal();
  returnTo = 'appraisal';
  sound.setMuffle(0.72);
  setStage('look');
});

// 鑑定書に戻る
async function backToCert() {
  const to = returnTo;
  returnTo = null;
  sound.setMuffle(0);
  if (to === 'appraisal') {
    stage = 'appraise';
    body.dataset.stage = 'appraise';
    $('#appraisal').hidden = false;
    if (kuma) kuma.peek = 0;
    kuma?.start();
    return;
  }
  if (to) {
    await openArchive();
    const i = certs.findIndex((c) => c.id === to.id);
    if (i >= 0) ($('#arch-grid').querySelector(`button[data-i="${i}"]`) as HTMLElement | null)?.click();
  }
  setNext();
}

// ---------- 入口へ戻る（作りかけは消さない） ----------
let session: { cell: Cell; stage: Stage; tint: number; liquid: number; mirrors: number } | null = null;
let introCell: Cell | null = null;
function toIntro() {
  if (stage === 'intro' || body.classList.contains('busy')) return;
  sound.tick();
  sayToken++;
  $('#say').classList.remove('show');
  stopPour();
  if (!shared && stage !== 'appraise') session = { cell, stage, tint: tintIdx, liquid: liquidIdx, mirrors };
  closeAppraisal();
  returnTo = null;
  sound.setMuffle(0);
  introCell ??= sample(20261029);
  cell = introCell;
  Object.assign(v, { mode: 1, ring: 0, edge: 1, trail: 0.3, bloom: 0.55, back: 0.02, iris: 1.3 });
  const has = !!session && (session.cell.bodies.length > 0 || session.stage !== 'fill1');
  $('#resume').hidden = !has;
  $('#start').classList.toggle('ghost', has || !!shared);
  $('#start .cta-label').textContent = shared ? '自分もつくる' : has ? 'あたらしくつくる' : 'つくる';
  setStage('intro');
  refreshArchCount();
}
$('#home').addEventListener('click', toIntro);
$('#resume').addEventListener('click', async () => {
  if (!session) return;
  sound.unlock();
  sound.tick();
  const s = session;
  session = null;
  $('#resume').hidden = true;
  body.classList.add('busy');
  await tween(350, (t) => (v.fade = 1 - t));
  cell = s.cell;
  tintIdx = s.tint;
  liquidIdx = s.liquid;
  mirrors = s.mirrors;
  buildLiquids();
  if (s.stage === 'fill1' || s.stage === 'fill2') {
    Object.assign(v, { mode: 0, ring: 1, edge: 0, trail: 0, back: 0.028, bloom: 0.7 });
    cell.angle = 0;
    cell.flat = true;
    cell.gs = 0;
  } else {
    Object.assign(v, { mode: 1, ring: 0, edge: 1, trail: 0.3, back: 0.02, bloom: 0.55, iris: 1.08 });
    sound.setMuffle(0.72);
  }
  setStage(s.stage);
  layout();
  Object.assign(v, { R: goal.R, cx: goal.cx, cy: goal.cy });
  updateCount();
  updateAmount();
  await tween(450, (t) => (v.fade = t), easeO);
  body.classList.remove('busy');
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
// 万華鏡として、のぞく（共有・一覧から）
async function openScope() {
  body.classList.add('busy');
  if (v.mode === 1 && stage !== 'appraise') await tween(500, (t) => (v.iris = Math.max(0, v.iris * (1 - t))), easeIO);
  else await tween(400, (t) => (v.fade = 1 - t));
  v.mode = 1;
  v.ring = 0;
  v.back = 0.02;
  v.bloom = 0.55;
  v.edge = 1;
  v.trail = 0.3;
  v.iris = 0;
  v.fade = 1;
  setStage('look');
  layout();
  Object.assign(v, { R: goal.R, cx: goal.cx, cy: goal.cy });
  sound.setMuffle(0.72);
  sound.open();
  auto = 5.5;
  await tween(2800, (t) => (v.iris = t * 1.08), easeIO);
  body.classList.remove('busy');
}
$('#peek').addEventListener('click', () => {
  sound.unlock();
  openScope();
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
  if (returnTo && stage === 'look') return backToCert();
  if (stage === 'fill1') {
    setStage('fill2');
    updateAmount();
    say(cell.bodies.length ? 'なにで満たす？' : '……からっぽだけど、いいの？');
  } else if (stage === 'fill2') toLook();
  else if (stage === 'look') {
    setStage('name');
    setTimeout(() => $<HTMLInputElement>('#name').focus({ preventScroll: true }), 380);
  } else if (stage === 'name') tryAppraise();
});
$<HTMLInputElement>('#name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) {
    e.preventDefault();
    tryAppraise();
  }
});
$('#name').addEventListener('input', setNext);
document.querySelectorAll<HTMLElement>('.steps li').forEach((li, i) =>
  li.addEventListener('click', () => {
    if (!li.classList.contains('done')) return;
    const to = ORDER[i];
    returnTo = null;
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
      cell.flat = true;
      cell.gs = 0;
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
    } else if (tiltOn && (stage === 'look' || stage === 'name')) {
      // 傾けている向きに、傾けた深さの分だけ回る
      const dz = Math.abs(tiltX) < 0.08 ? 0 : (tiltX - Math.sign(tiltX) * 0.08) / 0.92;
      angVel += (-dz * 1.6 - angVel) * Math.min(1, dt * 3);
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
  guide = Math.max(0, guide - dt);
  v.guide = Math.min(1, guide / 0.6) * (stage === 'fill1' ? 1 : 0);
  // 重力：寝かせている間は 0、立てたらゆっくり効いてくる
  // のぞいてからの重力は弱め：置いたレイアウトを崩しすぎない（はちみつはほぼ動かず、水は少し流れる）
  const gsGoal = cell.flat ? 0 : cell.liquid ? ({ water: 0.3, oil: 0.13, honey: 0.05 } as const)[cell.liquid.id] : 0.2;
  // 傾けている間は、中身が傾けた側へとろっと流れる
  const tiltBoost = tiltOn && !cell.flat ? Math.min(1, Math.abs(tiltX) * 1.8) * 0.55 : 0;
  cell.gs += (Math.max(gsGoal, tiltBoost) - cell.gs) * Math.min(1, dt * 0.8);
  // 筒の中を触りすぎると、ガラスに指のあとがつく
  if (stage === 'fill1' && (finger.on || grab.b)) {
    touchTime += dt;
    cell.smudge = Math.max(cell.smudge, Math.min(1, (touchTime - 8) / 14));
  }
  // つまんでいる粒は指についてくる
  if (grab.b) Object.assign(grab.b, { x: grab.x, y: grab.y, vx: 0, vy: 0 });
  // 指と、注ぐ流れが粒を押す
  cell.pokes.length = 0;
  if (finger.on) cell.pokes.push({ x: finger.x, y: finger.y, vx: finger.vx, vy: finger.vy, r: 0.07, k: 14 });
  if (pour.on && cell.liquid) {
    const L = cell.liquid;
    const before = cell.levelTarget;
    cell.levelTarget = Math.min(1, cell.levelTarget + POUR_RATE[L.id] * dt);
    cell.level = cell.levelTarget;
    cell.pourIn(bottleColor(), cell.levelTarget - before, L.id);
    cell.pokes.push({ x: pour.x, y: 0.05, vx: 0, vy: 0, r: 0.12 + (L.id === 'honey' ? 0.06 : 0), k: L.id === 'honey' ? 3 : 7 });
    if (cell.levelTarget >= 1) {
      stopPour();
      say('いっぱい。');
    }
    updateAmount();
  }
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
  // 鏡の向きは重力の向き（下）に固定。置いた場所がそのまま模様の場所になる
  {
    let dw = -Math.PI / 2 - v.wedge;
    dw = Math.atan2(Math.sin(dw), Math.cos(dw));
    v.wedge += dw * Math.min(1, dt * 3);
  }
  // 位置
  const k = 1 - Math.exp(-dt * 7);
  v.R += (goal.R - v.R) * k;
  v.cx += (goal.cx - v.cx) * k;
  v.cy += (goal.cy - v.cy) * k;
  v.tint = cell.liquid && cell.vol > 0 ? cell.tint : [1, 1, 1];
  v.mirrors = stage === 'intro' ? 8 : mirrors;
  const L = cell.liquid;
  R.drawChamber(cell, v, L ? { film: L.film, wobble: L.wobble } : null);
  // 満たす段だけ、筒を立体にして斜めから見る
  tilt += ((stage === 'fill2' && v.mode === 0 ? 1 : 0) - tilt) * Math.min(1, dt * 2.2);
  if (v.mode === 0 && (stage === 'fill2' || tilt > 0.003)) {
    pour3d ??= new Pour3D(R.gl, R.chamberRT.texture);
    pour3d.update(dt, {
      tilt: easeIO(Math.min(1, tilt)),
      level: cell.liquid ? cell.level : 0,
      liquid: cell.liquid?.id ?? null,
      cellCol: cell.vol > 0 ? cell.tint : bottleColor(),
      bottleCol: bottleColor(),
      pouring: pour.on,
      pourX: pour.on ? pour.x : 0.2,
      time: R.time,
      W: innerWidth,
      Hh: innerHeight,
      R: v.R,
      cx: v.cx,
      cy: v.cy,
    });
    R.present3d(v, pour3d.scene, pour3d.cam);
  } else R.present(cell, v);
  if (v.mode === 0) placeEngrave();
  requestAnimationFrame(frame);
}

// ---------- はじめ ----------
function boot() {
  refreshArchCount();
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
    v.trail = v.mode * 0.3;
    v.bloom = v.mode ? 0.55 : 0.7;
    if (dev === 'og') body.classList.add('og');
    v.back = v.mode ? 0.02 : 0.028;
    cell.flat = !v.mode;
    cell.gs = v.mode ? 0.1 : 0;
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
