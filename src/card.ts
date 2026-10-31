// 鑑定書（静止画）：名前・ランク・日付・こすくまくん・ドメイン。保存と共有に使う。

import { RANKS, type Verdict } from './appraise';

const W = 1080;
const H = 1350;
const PAPER = '#efe8da';
const INK = '#1d1915';
const BRASS = '#9a7637';
const MIN = "'Noto Serif JP', 'Hiragino Mincho ProN', serif";
const LAT = "'Cormorant Garamond', 'Noto Serif JP', serif";

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
  if (rank >= 6) return { paper: '#13100d', ink: '#ecd29a', sub: 'rgba(236,210,154,.62)', frame: '#c9a35a', seal: 'rgba(214,176,96,.95)', sealChar: '極', sealTilt: -0.05, aged: false, foil: true };
  if (rank === 5) return { paper: PAPER, ink: INK, sub: 'rgba(29,25,21,.6)', frame: '#b08a42', seal: 'rgba(178,140,64,.95)', sealChar: '鑑', sealTilt: -0.08, aged: false, foil: true };
  if (rank <= 1) return { paper: '#ddd2bc', ink: '#2d2620', sub: 'rgba(45,38,32,.55)', frame: '#8a7a62', seal: 'rgba(110,98,86,.7)', sealChar: '鑑', sealTilt: 0.42, aged: true, foil: false };
  return { paper: PAPER, ink: INK, sub: 'rgba(29,25,21,.6)', frame: BRASS, seal: 'rgba(176,30,36,.85)', sealChar: '鑑', sealTilt: -0.12, aged: false, foil: false };
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

export async function drawCard(scope: HTMLCanvasElement, name: string, v: Verdict, domain: string): Promise<HTMLCanvasElement> {
  const T = themeOf(v.rank);
  await Promise.all([
    document.fonts.load(`300 40px 'Noto Serif JP'`, name + '鑑定書'),
    document.fonts.load(`500 40px 'Noto Serif JP'`, v.rankName),
    document.fonts.load(`400 24px 'Cormorant Garamond'`),
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
  const cy = 480;
  const r = 268;
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

  // 判子
  x.save();
  x.translate(W - 170, 1185);
  x.rotate(T.sealTilt);
  x.strokeStyle = T.seal;
  x.fillStyle = T.seal;
  x.lineWidth = 4;
  x.beginPath();
  x.arc(0, 0, 50, 0, Math.PI * 2);
  x.stroke();
  x.lineWidth = 1.5;
  x.beginPath();
  x.arc(0, 0, 43, 0, Math.PI * 2);
  x.stroke();
  x.font = `500 34px ${MIN}`;
  x.textAlign = 'center';
  x.fillText(T.sealChar, 0, -2);
  x.font = `500 15px ${MIN}`;
  x.fillText('こすくま', 0, 26);
  x.restore();

  // 日付・ドメイン
  const d = new Date();
  x.fillStyle = T.sub;
  x.font = `400 21px ${LAT}`;
  x.textAlign = 'left';
  x.fillText(`${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`, 92, H - 82);
  x.textAlign = 'right';
  x.fillText(domain, W - 92, H - 82);
  return c;
}
