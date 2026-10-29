// 棚に並ぶもの・溶液・筒の定義。見た目（シェーダー）と動き（sim）と音（audio）が同じ表を見る。

export const enum Kind {
  Glass = 0,
  Pearl = 1,
  Gold = 2,
  Mineral = 3,
  Flower = 4,
  Glitter = 5,
  Photo = 6,
  Charm = 7,
}

// 宝石の4色＋透明。すべてリニア空間の「光の色」。
export const GEM = {
  sapphire: [0.06, 0.16, 0.95],
  emerald: [0.04, 0.72, 0.32],
  ruby: [0.92, 0.04, 0.12],
  gold: [1.0, 0.62, 0.16],
  clear: [0.82, 0.88, 0.95],
  amethyst: [0.5, 0.12, 0.9],
  pearl: [0.95, 0.9, 0.84],
  rose: [0.95, 0.28, 0.42],
  indigo: [0.14, 0.2, 0.75],
  ivory: [0.96, 0.92, 0.8],
  rainbow: [1, 1, 1],
} as const;
export type GemName = keyof typeof GEM;

export interface Item {
  id: string;
  label: string;
  kind: Kind;
  color: GemName;
  size: [number, number]; // 半径（筒の半径を1とする）
  density: number;
  pinch?: number; // ラメのようにひとつまみで何粒か入るもの
}

export const SHELF: Item[] = [
  { id: 'g-sap', label: '青のガラス玉', kind: Kind.Glass, color: 'sapphire', size: [0.075, 0.1], density: 2.5 },
  { id: 'g-eme', label: '緑のガラス玉', kind: Kind.Glass, color: 'emerald', size: [0.06, 0.09], density: 2.5 },
  { id: 'g-rub', label: '紅のガラス玉', kind: Kind.Glass, color: 'ruby', size: [0.065, 0.095], density: 2.5 },
  { id: 'g-amb', label: '琥珀のガラス玉', kind: Kind.Glass, color: 'gold', size: [0.05, 0.08], density: 2.5 },
  { id: 'g-clr', label: '透明のガラス玉', kind: Kind.Glass, color: 'clear', size: [0.045, 0.07], density: 2.5 },
  { id: 'pearl', label: '真珠', kind: Kind.Pearl, color: 'pearl', size: [0.045, 0.065], density: 2.7 },
  { id: 'gold', label: '金箔', kind: Kind.Gold, color: 'gold', size: [0.08, 0.12], density: 1.08 },
  { id: 'm-ame', label: '紫水晶のかけら', kind: Kind.Mineral, color: 'amethyst', size: [0.08, 0.115], density: 2.6 },
  { id: 'm-sap', label: '青玉のかけら', kind: Kind.Mineral, color: 'sapphire', size: [0.07, 0.1], density: 2.6 },
  { id: 'm-eme', label: '翠玉のかけら', kind: Kind.Mineral, color: 'emerald', size: [0.07, 0.1], density: 2.6 },
  { id: 'm-clr', label: '水晶のかけら', kind: Kind.Mineral, color: 'clear', size: [0.075, 0.11], density: 2.6 },
  { id: 'f-rose', label: '紅の花', kind: Kind.Flower, color: 'rose', size: [0.1, 0.13], density: 0.7 },
  { id: 'f-ind', label: '藍の花', kind: Kind.Flower, color: 'indigo', size: [0.09, 0.12], density: 0.7 },
  { id: 'f-ivo', label: '白い花', kind: Kind.Flower, color: 'ivory', size: [0.08, 0.11], density: 0.7 },
  { id: 'l-gold', label: '金のラメ', kind: Kind.Glitter, color: 'gold', size: [0.012, 0.018], density: 1.3, pinch: 36 },
  { id: 'l-rain', label: '虹のラメ', kind: Kind.Glitter, color: 'rainbow', size: [0.011, 0.016], density: 1.3, pinch: 36 },
  { id: 'charm', label: 'こすくまくん', kind: Kind.Charm, color: 'ivory', size: [0.11, 0.11], density: 1.15 },
];

export const MORTAR_STONES: { color: GemName; label: string }[] = [
  { color: 'sapphire', label: '青玉' },
  { color: 'emerald', label: '翠玉' },
  { color: 'ruby', label: '紅玉' },
  { color: 'gold', label: '黄玉' },
];

export interface Liquid {
  id: 'water' | 'oil' | 'honey';
  label: string;
  density: number;
  drag: number; // 速度の減衰（1秒あたり）
  film: number; // 油膜の干渉色の強さ
  wobble: number; // 光のゆらぎ
  base: [number, number, number]; // 液そのものの色（光にかける）
}
export const LIQUIDS: Liquid[] = [
  { id: 'water', label: '水', density: 1.0, drag: 2.2, film: 0.25, wobble: 1.0, base: [0.92, 0.97, 1.0] },
  { id: 'oil', label: 'オイル', density: 0.92, drag: 6.5, film: 1.0, wobble: 0.6, base: [1.0, 0.9, 0.66] },
  { id: 'honey', label: 'はちみつ', density: 1.42, drag: 22, film: 0.45, wobble: 0.25, base: [1.0, 0.7, 0.32] },
];

export const TINTS: { id: string; label: string; rgb: [number, number, number] }[] = [
  { id: 'none', label: '無色', rgb: [1, 1, 1] },
  { id: 'blue', label: '青', rgb: [0.55, 0.72, 1.0] },
  { id: 'green', label: '緑', rgb: [0.62, 1.0, 0.78] },
  { id: 'red', label: '紅', rgb: [1.0, 0.6, 0.66] },
  { id: 'amber', label: '琥珀', rgb: [1.0, 0.8, 0.5] },
];

export const MIRRORS = [6, 8, 12] as const;
export type Mirrors = (typeof MIRRORS)[number];

export function gemRGB(name: GemName): [number, number, number] {
  const c = GEM[name];
  return [c[0], c[1], c[2]];
}
