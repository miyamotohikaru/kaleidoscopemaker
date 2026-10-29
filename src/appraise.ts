// こすくまくんの鑑定。中身から点をつけ、名前で少しだけ揺らす（自由入力で全員違う結果）。
// ランクの中間の名前と台詞は仮。企画書で「未決定・武知さん確認待ち」になっている。

import { Kind } from './catalog';
import type { Cell } from './sim';

export const RANKS = ['うんち', 'ビー玉どまり', '縁日の景品', '骨董屋の片隅', '職人の一本', '美術館行き', '万華鏡の神'];
const EDGES = [0, 24, 40, 54, 67, 80, 92];

const LINES: string[][] = [
  ['……うん。\n筒は、いい筒だと思う。', '回しても、回しても、\nだね。', '……もう一回、\n入れるところからやる？'],
  ['ビー玉って、\nそれだけできれいだからね。', '悪くないよ。\nたぶん。', 'ふーん。\n……まあ、光ってる。'],
  ['お祭りの帰りみたい。\nちょっと好き。', 'これ、袋に入れて\n持って帰るやつ。', '夜店の明かりの色。'],
  ['誰かが大事にしてたっぽい色。', '埃をはらったら、\nまだ光ってた。みたいな。', '……値札、\nついてないの？'],
  ['……ずっと見てられる。', 'ふーん。\n……もう一回、回していい？', '目を離すと、\n損した気分になる。'],
  ['……戻ってこれないかも。', 'ガラスの向こうに、\n別の部屋がある。', 'これ、ぼくが\n先に見つけたことにしていい？'],
  ['これは、ぼくがもらうね。', '……返さないよ。', 'ちょっと、\n息するの忘れてた。'],
];
const CHARM_LINE = '……ぼく、映ってる。';
const EMPTY_LINE = '……なにも、\n入ってないよ。';
const BROWN_LINE = '……これ、茶色いね。';
const WHITE_LINE = 'まぶしい。\n……目、閉じていい？';

// 映った万華鏡の画像から測る
export interface Look {
  coverage: number; // 光っている面積
  brown: number; // 茶色く濁った割合
  white: number; // 白く飛んだ割合
  hues: number; // はっきり出ている色の数
}
export function measure(c: HTMLCanvasElement): Look {
  const N = 128;
  const t = document.createElement('canvas');
  t.width = t.height = N;
  const x = t.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(c, 0, 0, N, N);
  const d = x.getImageData(0, 0, N, N).data;
  let inside = 0, lit = 0, brown = 0, white = 0;
  const bins = new Array(12).fill(0);
  let sat = 0;
  for (let y = 0; y < N; y++)
    for (let i = 0; i < N; i++) {
      const dx = (i + 0.5) / N - 0.5, dy = (y + 0.5) / N - 0.5;
      if (dx * dx + dy * dy > 0.2) continue; // 円の中だけ
      inside++;
      const k = (y * N + i) * 4;
      const r = d[k] / 255, g = d[k + 1] / 255, b = d[k + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const l = 0.3 * r + 0.59 * g + 0.11 * b;
      if (l < 0.09) continue;
      lit++;
      if (mn > 0.9) white++;
      const s = mx > 0 ? (mx - mn) / mx : 0;
      let h = 0;
      if (mx !== mn) {
        if (mx === r) h = ((g - b) / (mx - mn) + 6) % 6;
        else if (mx === g) h = (b - r) / (mx - mn) + 2;
        else h = (r - g) / (mx - mn) + 4;
        h *= 60;
      }
      if (h >= 12 && h <= 50 && s > 0.3 && mx < 0.75) brown++;
      if (s > 0.35) {
        bins[Math.floor(h / 30) % 12]++;
        sat++;
      }
    }
  const hues = sat ? bins.filter((n) => n / sat > 0.05).length : 0;
  return { coverage: inside ? lit / inside : 0, brown: lit ? brown / lit : 0, white: lit ? white / lit : 0, hues };
}

export interface Verdict {
  score: number;
  rank: number;
  rankName: string;
  line: string;
  pos: number; // 0..1 ランクの棒の上の位置
}

function hash(s: string) {
  let h = 2166136261;
  for (const ch of s) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function appraise(cell: Cell, mirrors: number, tint: string, name: string, look: Look): Verdict {
  const big = cell.bodies.filter((b) => !b.small);
  const small = cell.bodies.filter((b) => b.small).length;
  const kinds = new Set(big.map((b) => b.kind));
  if (small) kinds.add(Kind.Glitter);
  const colors = new Set(cell.bodies.map((b) => b.color));
  const bell = (x: number, mu: number, sd: number) => Math.exp(-Math.pow((x - mu) / sd, 2));
  const n = big.length;
  const hasCharm = big.some((b) => b.kind === Kind.Charm);
  // 中身（どう作ったか）
  let s = 0;
  s += 14 * bell(kinds.size, 4.5, 2.2);
  s += 10 * bell(colors.size, 4, 2.4);
  s += cell.liquid ? { water: 3, oil: 6, honey: 5 }[cell.liquid.id] : 0;
  s += mirrors === 12 ? 4 : mirrors === 8 ? 3 : 2;
  s += tint === 'none' ? 1 : 3;
  if (hasCharm) s += 2;
  // 見え方（実際に映ったもの）
  s += 32 * bell(look.coverage, 0.62, 0.3);
  s += 22 * bell(look.hues, 5, 2.6);
  s -= 90 * Math.max(0, look.brown - 0.22);
  s -= 70 * Math.max(0, look.white - 0.18);
  const h = hash(name.trim() || '無題');
  s += ((h % 1000) / 1000 - 0.5) * 16;
  const empty = (n === 0 && small === 0) || look.coverage < 0.08;
  if (empty) s = Math.min(s, 8);
  s = Math.max(0, Math.min(100, s));
  let rank = 0;
  for (let i = 0; i < EDGES.length; i++) if (s >= EDGES[i]) rank = i;
  const pool = LINES[rank];
  let line = pool[(h >>> 10) % pool.length];
  if (hasCharm && rank >= 3 && (h >>> 4) % 3 === 0) line = CHARM_LINE;
  // 低いときは、理由がわかる一言
  if (rank <= 1) {
    if (empty) line = EMPTY_LINE;
    else if (look.brown > 0.3) line = BROWN_LINE;
    else if (look.white > 0.3) line = WHITE_LINE;
  }
  return { score: s, rank, rankName: RANKS[rank], line, pos: s / 100 };
}
