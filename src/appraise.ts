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
const DARK_LINE = '……暗くて、\nよく見えない。';
const BROWN_LINE = '……茶色っぽいね。\nちがう色も、入れてみたら？';
const WHITE_LINE = 'まぶしい。\n……目、閉じていい？';
// 失敗の一言（作るときに起きること）
const FAIL_LINES: Record<string, string> = {
  cloud: '……水と油、\n混ざらないんだよ。',
  murk: '色、混ぜすぎたかも。\n……泥水みたい。',
  smudge: '指のあと、ついてる。\n……ぼくのじゃないよ。',
  air: '泡、入ってる。\n……まあ、それも景色か。',
  packed: 'ぎゅうぎゅう。\n……動けないって。',
  spill: 'あふれてる。\n……筒の外、べたべた。',
};

// 映った万華鏡の画像から測る
export interface Look {
  lit: number; // はっきり見えている面積（暗いガラスの筋や、ぼんやりした光は数えない）
  coverage: number; // 少しでも光っている面積
  brown: number; // 茶色っぽい割合（はっきり見えている所のうち）
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
  let shown = 0;
  let sat = 0;
  let vis = 0;
  for (let y = 0; y < N; y++)
    for (let i = 0; i < N; i++) {
      const dx = (i + 0.5) / N - 0.5, dy = (y + 0.5) / N - 0.5;
      if (dx * dx + dy * dy > 0.2) continue; // 円の中だけ
      inside++;
      const k = (y * N + i) * 4;
      const r = d[k] / 255, g = d[k + 1] / 255, b = d[k + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const l = 0.3 * r + 0.59 * g + 0.11 * b;
      if (l >= 0.22) shown++;
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
      // 茶色：はっきり見えている所のうち、暗めの黄〜橙。
      // オイルのうっすらした金色や、金の粒のまわりのぼんやりした光は数えない
      if (l >= 0.15) {
        vis++;
        if (h >= 12 && h <= 50 && s > 0.3 && mx < 0.55) brown++;
      }
      if (s > 0.35) {
        bins[Math.floor(h / 30) % 12]++;
        sat++;
      }
    }
  const hues = sat ? bins.filter((n) => n / sat > 0.05).length : 0;
  return { lit: inside ? shown / inside : 0, coverage: inside ? lit / inside : 0, brown: vis ? brown / vis : 0, white: lit ? white / lit : 0, hues };
}

export interface Verdict {
  score: number;
  rank: number;
  rankName: string;
  line: string;
  pos: number; // 0..1 ランクの棒の上の位置
  fail: string | null; // いちばん大きい失敗
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
  s += 32 * Math.min(1, look.lit / 0.35);
  s += 22 * bell(look.hues, 5, 2.6);
  s -= Math.min(25, 60 * Math.max(0, look.brown - 0.3));
  s -= 70 * Math.max(0, look.white - 0.18);
  const h = hash(name.trim() || '無題');
  s += ((h % 1000) / 1000 - 0.5) * 16;
  // 作るときの失敗
  const air = cell.liquid ? 1 - cell.levelTarget : 0;
  const fails: [string, number][] = [
    ['cloud', cell.cloud],
    ['murk', cell.murk],
    ['smudge', cell.smudge],
    ['air', air > 0.3 ? air : 0],
    ['packed', n >= 40 ? (n - 36) / 12 : 0],
    ['spill', Math.min(1, cell.spill * 2.5)],
  ];
  for (const [, v] of fails) s -= 38 * v;
  const worst = fails.sort((a, b) => b[1] - a[1])[0];
  const fail = worst[1] > 0.25 ? worst[0] : null;
  const empty = (n === 0 && small === 0) || look.lit < 0.02;
  if (empty) s = Math.min(s, 8);
  // のぞいても、ほとんど何も見えないなら、中身がよくても上がらない
  s = Math.min(s, 4 + look.lit * 170);
  const dark = look.lit < 0.15;
  s = Math.max(0, Math.min(100, s));
  let rank = 0;
  for (let i = 0; i < EDGES.length; i++) if (s >= EDGES[i]) rank = i;
  const pool = LINES[rank];
  let line = pool[(h >>> 10) % pool.length];
  if (hasCharm && rank >= 3 && (h >>> 4) % 3 === 0) line = CHARM_LINE;
  // 低いときは、理由がわかる一言
  if (rank <= 2 && fail) line = FAIL_LINES[fail];
  // 茶色っぽさで点が伸びなかったときは、直し方がわかる一言
  else if (rank <= 3 && look.brown > 0.3) line = BROWN_LINE;
  if (rank <= 1) {
    if (empty) line = EMPTY_LINE;
    else if (fail) line = FAIL_LINES[fail];
    else if (dark) line = DARK_LINE;
    else if (look.brown > 0.3) line = BROWN_LINE;
    else if (look.white > 0.3) line = WHITE_LINE;
  }
  return { score: s, rank, rankName: RANKS[rank], line, pos: s / 100, fail };
}
