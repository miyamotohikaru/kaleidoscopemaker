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

export function appraise(cell: Cell, mirrors: number, tint: string, name: string): Verdict {
  const big = cell.bodies.filter((b) => !b.small);
  const small = cell.bodies.filter((b) => b.small).length;
  const kinds = new Set(big.map((b) => b.kind));
  if (small) kinds.add(Kind.Glitter);
  const colors = new Set(cell.bodies.map((b) => b.color));
  const bell = (x: number, mu: number, sd: number) => Math.exp(-Math.pow((x - mu) / sd, 2));
  let s = 0;
  // 種類も色も「多いほど良い」ではなく、ほどよいところが一番
  s += 24 * bell(kinds.size, 4.5, 2.2);
  s += 20 * bell(colors.size, 4, 2.4);
  const n = big.length;
  s += n === 0 ? 0 : 22 * bell(n, 26, 11);
  s += small > 0 ? 8 * bell(small, 140, 140) + 2 : 0;
  s += cell.liquid ? { water: 4, oil: 8, honey: 7 }[cell.liquid.id] : 0;
  s += mirrors === 12 ? 5 : mirrors === 8 ? 4 : 3;
  s += tint === 'none' ? 2 : 4;
  const hasCharm = big.some((b) => b.kind === Kind.Charm);
  if (hasCharm) s += 3;
  const h = hash(name.trim() || '無題');
  s += ((h % 1000) / 1000 - 0.5) * 22;
  if (n === 0 && small === 0) s = 0;
  s = Math.max(0, Math.min(100, s));
  let rank = 0;
  for (let i = 0; i < EDGES.length; i++) if (s >= EDGES[i]) rank = i;
  const pool = LINES[rank];
  let line = pool[(h >>> 10) % pool.length];
  if (hasCharm && rank >= 3 && (h >>> 4) % 3 === 0) line = CHARM_LINE;
  return { score: s, rank, rankName: RANKS[rank], line, pos: s / 100 };
}
