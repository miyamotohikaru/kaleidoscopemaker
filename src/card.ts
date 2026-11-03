// 鑑定書（静止画）：名前・ランク・日付・こすくまくん・ドメイン。保存と共有に使う。

import { RANKS, type Verdict } from './appraise';

const W = 1080;
const H = 1350;
const PAPER = '#efe8da';
const INK = '#1d1915';
const BRASS = '#9a7637';
const MIN = "'Noto Serif JP', 'Hiragino Mincho ProN', serif";
const LAT = "'Cormorant Garamond', 'Noto Serif JP', serif";

export interface Spec {
  liquid: string; // 水・オイル・はちみつ
  count: number; // 入れた粒
  items?: string[]; // 中身の内訳（「青のガラス玉 3」のように、多い順）
}

function img(src: string) {
  return new Promise<HTMLImageElement>((res) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => res(i);
    i.src = src;
  });
}

function spaced(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, sp: number) {
  const chars = [...s];
  const w = chars.reduce((a, c) => a + ctx.measureText(c).width, 0) + sp * (chars.length - 1);
  let cx = x - w / 2;
  for (const c of chars) {
    ctx.fillText(c, cx + ctx.measureText(c).width / 2, y);
    cx += ctx.measureText(c).width + sp;
  }
}

// 字間をあけて、左寄せ・右寄せで置く
function spacedAt(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, sp: number, align: CanvasTextAlign) {
  const chars = [...s];
  const w = chars.reduce((a, c) => a + ctx.measureText(c).width, 0) + sp * (chars.length - 1);
  let cx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  ctx.save();
  ctx.textAlign = 'left';
  for (const c of chars) {
    ctx.fillText(c, cx, y);
    cx += ctx.measureText(c).width + sp;
  }
  ctx.restore();
}

// ランクで紙を変える：失敗は古びた紙と灰色の判子、上手は金箔、神は黒漆に金
interface Theme {
  paper: string;
  ink: string;
  sub: string;
  frame: string;
  seal: string;
  sealChar: string;
  sealTilt: number;
  aged: boolean;
  foil: boolean;
}
function themeOf(rank: number): Theme {
  if (rank >= 6) return { paper: DARK_PAPER, ink: '#ecd29a', sub: 'rgba(236,210,154,.62)', frame: '#c9a35a', seal: 'rgba(214,176,96,.95)', sealChar: '極', sealTilt: -0.05, aged: false, foil: true };
  if (rank === 5) return { paper: PAPER, ink: INK, sub: 'rgba(29,25,21,.6)', frame: '#b08a42', seal: 'rgba(178,140,64,.95)', sealChar: '鑑', sealTilt: -0.08, aged: false, foil: true };
  if (rank <= 1) return { paper: '#ddd2bc', ink: '#2d2620', sub: 'rgba(45,38,32,.55)', frame: '#8a7a62', seal: 'rgba(110,98,86,.7)', sealChar: '鑑', sealTilt: 0.42, aged: true, foil: false };
  return { paper: PAPER, ink: INK, sub: 'rgba(29,25,21,.6)', frame: BRASS, seal: 'rgba(176,30,36,.85)', sealChar: '鑑', sealTilt: -0.12, aged: false, foil: false };
}

// 評価の記号：ランク 0〜6 に E〜SS
export const GRADES = ['E', 'D', 'C', 'B', 'A', 'S', 'SS'];
const STAMP = "'Cormorant Garamond', 'Noto Serif JP', serif";
const DARK_PAPER = '#13100d';

function hash(s: string) {
  let h = 2166136261;
  for (const ch of s) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// 評価のスタンプ：ゴム印のように、枠と大きな文字。インクのかすれを少し残す
function gradeStamp(x: CanvasRenderingContext2D, grade: string, cx: number, cy: number, scale: number, tilt: number, seed: number, ink: string, dark: boolean) {
  const S = 300;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.strokeStyle = ink;
  g.fillStyle = ink;
  g.translate(S / 2, S / 2);
  // 二重の丸枠
  g.lineWidth = 9;
  g.beginPath();
  g.arc(0, 0, 128, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 3;
  g.beginPath();
  g.arc(0, 0, 112, 0, Math.PI * 2);
  g.stroke();
  // 文字
  const size = grade.length > 1 ? 128 : 168;
  // 太字の書体は読み込んでいないので、文字の縁もなぞって太くする
  g.font = `400 ${size}px ${STAMP}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(grade, 0, 4);
  g.lineWidth = 7;
  g.lineJoin = 'round';
  g.strokeText(grade, 0, 4);
  g.font = `400 22px ${STAMP}`;
  g.lineWidth = 1.2;
  g.fillText('GRADE', 0, -82);
  g.strokeText('GRADE', 0, -82);
  g.fillText('KOSUKUMA', 0, 88);
  g.strokeText('KOSUKUMA', 0, 88);
  // かすれ：ところどころインクが乗らない
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'destination-out';
  let r = seed;
  const rnd = () => ((r = (Math.imul(r, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 900; i++) {
    g.globalAlpha = 0.25 + rnd() * 0.6;
    g.beginPath();
    g.arc(rnd() * S, rnd() * S, 0.6 + rnd() * 2.2, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 6; i++) {
    g.globalAlpha = 0.18;
    g.beginPath();
    g.ellipse(rnd() * S, rnd() * S, 20 + rnd() * 40, 4 + rnd() * 6, rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
  x.save();
  x.translate(cx, cy);
  x.rotate(tilt);
  x.scale(scale, scale);
  x.globalAlpha = 0.9;
  // 紙の上ではインクが紙に染みるように重ねる。黒漆の紙では重ねると消えるので、そのまま押す
  if (!dark) x.globalCompositeOperation = 'multiply';
  x.drawImage(c, -S / 2, -S / 2);
  x.restore();
}

function foilCorner(x: CanvasRenderingContext2D, cx: number, cy: number, sx: number, sy: number) {
  const g = x.createLinearGradient(cx, cy, cx + sx * 120, cy + sy * 120);
  g.addColorStop(0, '#f3dc9c');
  g.addColorStop(0.45, '#a67a2c');
  g.addColorStop(0.7, '#ecd08a');
  g.addColorStop(1, '#8a6322');
  x.save();
  x.fillStyle = g;
  x.beginPath();
  x.moveTo(cx, cy);
  x.lineTo(cx + sx * 130, cy);
  x.lineTo(cx + sx * 130, cy + sy * 6);
  x.lineTo(cx + sx * 6, cy + sy * 6);
  x.lineTo(cx + sx * 6, cy + sy * 130);
  x.lineTo(cx, cy + sy * 130);
  x.closePath();
  x.fill();
  // 小さな菱形
  x.translate(cx + sx * 26, cy + sy * 26);
  x.rotate(Math.PI / 4);
  x.fillRect(-7, -7, 14, 14);
  x.restore();
}

export async function drawCard(scope: HTMLCanvasElement, name: string, v: Verdict, domain: string, spec?: Spec): Promise<HTMLCanvasElement> {
  const T = themeOf(v.rank);
  await Promise.all([
    document.fonts.load(`300 40px 'Noto Serif JP'`, name + '鑑定書'),
    document.fonts.load(`500 40px 'Noto Serif JP'`, v.rankName),
    document.fonts.load(`400 24px 'Cormorant Garamond'`),
    document.fonts.load(`400 40px 'Noto Serif JP'`, '溶液入れた粒中身種個ほか' + (spec?.liquid ?? '') + (spec?.items ?? []).join('')),
  ]).catch(() => {});
  const kuma = await img('/appraiser.png');
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d')!;
  x.textAlign = 'center';
  x.textBaseline = 'alphabetic';

  // 紙
  x.fillStyle = T.paper;
  x.fillRect(0, 0, W, H);
  const id = x.getImageData(0, 0, W, H);
  for (let i = 0; i < id.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 7;
    id.data[i] += n;
    id.data[i + 1] += n;
    id.data[i + 2] += n;
  }
  x.putImageData(id, 0, 0);
  if (T.aged) {
    // 古びた紙：縁の焼け、水じみ、コーヒーの輪
    const vg = x.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
    vg.addColorStop(0, 'rgba(120,90,50,0)');
    vg.addColorStop(1, 'rgba(120,85,40,.32)');
    x.fillStyle = vg;
    x.fillRect(0, 0, W, H);
    x.strokeStyle = 'rgba(110,70,30,.28)';
    x.lineWidth = 9;
    x.beginPath();
    x.ellipse(W - 230, 300, 96, 90, 0.3, 0.2, Math.PI * 1.85);
    x.stroke();
    x.lineWidth = 3;
    x.beginPath();
    x.ellipse(W - 226, 304, 82, 77, 0.3, 0, Math.PI * 2);
    x.stroke();
    x.fillStyle = 'rgba(120,80,35,.07)';
    x.beginPath();
    x.ellipse(W - 230, 300, 90, 84, 0.3, 0, Math.PI * 2);
    x.fill();
  }

  // 罫
  x.strokeStyle = T.frame;
  x.lineWidth = 3;
  x.strokeRect(36, 36, W - 72, H - 72);
  x.lineWidth = 1;
  x.strokeRect(50, 50, W - 100, H - 100);
  if (T.foil) {
    foilCorner(x, 36, 36, 1, 1);
    foilCorner(x, W - 36, 36, -1, 1);
    foilCorner(x, 36, H - 36, 1, -1);
    foilCorner(x, W - 36, H - 36, -1, -1);
  }

  x.fillStyle = T.ink;
  x.font = `300 46px ${MIN}`;
  spaced(x, '鑑定書', W / 2, 148, 34);
  x.fillStyle = T.frame;
  x.font = `400 21px ${LAT}`;
  spaced(x, 'KALEIDOSCOPE  APPRAISAL', W / 2, 188, 7);

  // 万華鏡
  const cy = 476;
  const r = 236;
  x.save();
  x.shadowColor = 'rgba(40,25,10,.35)';
  x.shadowBlur = 30;
  x.shadowOffsetY = 10;
  x.beginPath();
  x.arc(W / 2, cy, r + 14, 0, Math.PI * 2);
  x.fillStyle = '#16120e';
  x.fill();
  x.restore();
  const ring = x.createLinearGradient(W / 2 - r, cy - r, W / 2 + r, cy + r);
  ring.addColorStop(0, '#e2c486');
  ring.addColorStop(0.45, '#8a6528');
  ring.addColorStop(0.7, '#d9b56f');
  ring.addColorStop(1, '#6e4f1d');
  x.beginPath();
  x.arc(W / 2, cy, r + 14, 0, Math.PI * 2);
  x.fillStyle = ring;
  x.fill();
  x.save();
  x.beginPath();
  x.arc(W / 2, cy, r, 0, Math.PI * 2);
  x.clip();
  x.drawImage(scope, W / 2 - r, cy - r, r * 2, r * 2);
  x.restore();

  // 注記：図の中の点から細い真鍮の線を引き、左に溶液と入れた粒、右に中身の内訳
  if (spec) {
    const cx = W / 2;
    const point = (ang: number, k: number): [number, number] => [cx + Math.cos((ang * Math.PI) / 180) * r * k, cy + Math.sin((ang * Math.PI) / 180) * r * k];
    // 引き出し線：図の中の点から斜めに出て、注記の手前で水平に折れる（side: 注記が左なら -1、右なら 1）
    const lead = (from: [number, number], to: [number, number], side: number) => {
      const pts: [number, number][] = [from, [to[0] - side * 30, to[1]], to];
      x.save();
      x.lineCap = 'round';
      x.lineJoin = 'round';
      // 画の上でも見えるよう、紙の色で縁取ってから真鍮の線
      for (const [w, col] of [
        [4, T.paper],
        [1.2, T.frame],
      ] as const) {
        x.strokeStyle = col;
        x.lineWidth = w;
        x.beginPath();
        pts.forEach(([qx, qy], i) => (i ? x.lineTo(qx, qy) : x.moveTo(qx, qy)));
        x.stroke();
      }
      x.fillStyle = T.paper;
      x.strokeStyle = T.frame;
      x.lineWidth = 1.6;
      x.beginPath();
      x.arc(from[0], from[1], 5, 0, Math.PI * 2);
      x.fill();
      x.stroke();
      x.restore();
    };
    const note = (label: string, px: number, py: number, align: CanvasTextAlign) => {
      x.textAlign = align;
      x.fillStyle = T.frame;
      x.font = `400 19px ${MIN}`;
      spacedAt(x, label, px, py, 4, align);
    };
    const lx = cx - r - 34; // 左の注記の右端
    const rx = cx + r + 34; // 右の注記の左端

    // 溶液
    lead(point(200, 0.72), [lx + 10, 359], -1);
    note('溶液', lx, 366, 'right');
    x.fillStyle = T.ink;
    x.font = `400 30px ${MIN}`;
    x.textAlign = 'right';
    x.fillText(spec.liquid, lx, 410);

    // 入れた粒
    lead(point(150, 0.5), [lx + 10, 539], -1);
    note('入れた粒', lx, 546, 'right');
    x.fillStyle = T.ink;
    x.font = `400 30px ${MIN}`;
    x.textAlign = 'right';
    x.fillText(`${spec.count} 個`, lx, 590);

    // 中身：名前と数を1行ずつ。入りきらない分は「ほか n 種」
    const items = spec.items?.length ? spec.items : ['なし'];
    lead(point(-25, 0.68), [rx - 10, 283], 1);
    note(spec.items?.length ? `中身　${spec.items.length} 種` : '中身', rx, 290, 'left');
    x.fillStyle = T.ink;
    x.textAlign = 'left';
    const MAX = 11;
    const rows = items.length > MAX ? [...items.slice(0, MAX - 1), `ほか ${items.length - (MAX - 1)} 種`] : items;
    const colW = W - 64 - rx;
    rows.forEach((t, i) => {
      let fs = 21;
      do {
        x.font = `300 ${fs}px ${MIN}`;
        fs -= 1;
      } while (x.measureText(t).width > colW && fs > 14);
      x.fillText(t, rx, 334 + i * 34);
    });
    x.textAlign = 'center';
  }

  // 名前
  x.fillStyle = T.ink;
  let fs = 62;
  const label = `「${name}」`;
  do {
    x.font = `400 ${fs}px ${MIN}`;
    fs -= 2;
  } while (x.measureText(label).width > W - 220 && fs > 30);
  x.fillText(label, W / 2, 858);

  // ランク
  x.fillStyle = T.frame;
  x.font = `400 22px ${MIN}`;
  spaced(x, '鑑定結果', W / 2, 918, 10);
  x.fillStyle = T.ink;
  x.font = `500 50px ${MIN}`;
  x.fillText(v.rankName, W / 2, 984);

  const bx = 170;
  const bw = W - 340;
  const by = 1030;
  const grad = x.createLinearGradient(bx, 0, bx + bw, 0);
  grad.addColorStop(0, '#6b5a3a');
  grad.addColorStop(0.3, '#8e2232');
  grad.addColorStop(0.55, '#22357a');
  grad.addColorStop(0.8, '#1e6b4a');
  grad.addColorStop(1, '#c9a35a');
  x.fillStyle = grad;
  x.fillRect(bx, by, bw, 4);
  for (let i = 0; i < RANKS.length; i++) {
    const tx = bx + (bw * i) / (RANKS.length - 1);
    x.fillRect(tx - 0.5, by - 5, 1, 14);
  }
  const mx = bx + bw * v.pos;
  x.save();
  x.translate(mx, by + 2);
  x.rotate(Math.PI / 4);
  x.fillStyle = T.ink;
  x.fillRect(-9, -9, 18, 18);
  x.restore();
  x.fillStyle = T.sub;
  x.font = `300 20px ${MIN}`;
  x.textAlign = 'left';
  x.fillText(RANKS[0], bx, by + 42);
  x.textAlign = 'right';
  x.fillText(RANKS[RANKS.length - 1], bx + bw, by + 42);

  // こすくまくんと一言
  const kw = 150;
  const kh = (kuma.naturalHeight / Math.max(1, kuma.naturalWidth)) * kw || 188;
  x.save();
  x.filter = 'brightness(1.08)';
  x.drawImage(kuma, 120, 1100, kw, kh);
  x.restore();
  x.textAlign = 'left';
  x.fillStyle = T.ink;
  x.font = `300 31px ${MIN}`;
  const lines = v.line.split('\n');
  lines.forEach((l, i) => x.fillText((i === 0 ? '「' : '　') + l + (i === lines.length - 1 ? '」' : ''), 300, 1160 + i * 46 - (lines.length - 1) * 10));
  x.fillStyle = T.frame;
  x.font = `400 20px ${MIN}`;
  x.fillText('鑑定士　こすくまくん', 306, 1160 + lines.length * 46 + 4 - (lines.length - 1) * 10);

  // 評価のスタンプ：鑑定士の一言の右に、ゴム印のように大きく押す（SS〜E）
  const hs = hash(name + v.rank);
  gradeStamp(x, GRADES[v.rank] ?? 'C', W - 220, 1172, 0.74, -0.2 + ((hs % 100) / 100) * 0.24, hs || 7, T.seal, T.paper === DARK_PAPER);

  // 日付・ドメイン
  const d = new Date();
  x.fillStyle = T.sub;
  x.font = `400 21px ${LAT}`;
  x.textAlign = 'left';
  x.fillText(`${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`, 92, H - 64);
  x.textAlign = 'right';
  x.fillText(domain, W - 92, H - 64);
  return c;
}
