// 万華鏡の中身を URL の # に詰める。受け取った人が同じ万華鏡をのぞける。
// 写真の破片は端末の外に出さない約束なので入れない。

import { GEM, Kind, LIQUIDS, MIRRORS, SHELF, TINTS, type GemName } from './catalog';
import { Cell, type Body } from './sim';

const GEMS = Object.keys(GEM) as GemName[];
const DENSITY: Record<number, number> = { 0: 2.5, 1: 2.7, 2: 1.08, 3: 2.6, 4: 0.7, 5: 1.3, 7: 1.15 };

export interface Recipe {
  mirrors: number;
  liquid: number;
  tint: number;
  name: string;
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const q = (v: number, lo: number, hi: number) => Math.max(0, Math.min(255, Math.round(((v - lo) / (hi - lo)) * 255)));
const dq = (b: number, lo: number, hi: number) => lo + (b / 255) * (hi - lo);

export function encode(cell: Cell, r: Recipe): string {
  const out: number[] = [1];
  out.push(MIRRORS.indexOf(r.mirrors as 6) | (r.liquid << 2) | (r.tint << 4));
  out.push(q(((cell.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2), 0, Math.PI * 2));
  const big = cell.bodies.filter((b) => !b.small && b.kind !== Kind.Photo).slice(0, 60);
  out.push(big.length);
  for (const b of big) {
    out.push((b.kind << 4) | Math.max(0, GEMS.indexOf(b.color as GemName)));
    out.push(q(b.x, -1, 1), q(b.y, -1, 1), q(((b.a % 6.2832) + 6.2832) % 6.2832, 0, 6.2832), q(b.r, 0, 0.16), Math.floor(b.seed * 255));
  }
  const groups = new Map<string, number>();
  for (const b of cell.bodies) if (b.small) groups.set(b.color, (groups.get(b.color) ?? 0) + 1);
  out.push(groups.size);
  for (const [c, n] of groups) out.push(GEMS.indexOf(c as GemName), Math.min(255, Math.round(n / 2)));
  const nm = new TextEncoder().encode(r.name.slice(0, 40));
  out.push(nm.length, ...nm);
  return b64(new Uint8Array(out));
}

export function decode(s: string, cell: Cell, rnd: () => number): Recipe | null {
  try {
    const u = unb64(s);
    let i = 0;
    if (u[i++] !== 1) return null;
    const m = u[i++];
    const rec: Recipe = { mirrors: MIRRORS[m & 3] ?? 8, liquid: Math.min(2, (m >> 2) & 3), tint: Math.min(TINTS.length - 1, (m >> 4) & 7), name: '' };
    cell.angle = dq(u[i++], 0, Math.PI * 2);
    const n = u[i++];
    cell.bodies = [];
    for (let k = 0; k < n; k++) {
      const kc = u[i++];
      const kind = (kc >> 4) as Kind;
      const color = GEMS[kc & 15] ?? 'clear';
      const b: Body = {
        x: dq(u[i++], -1, 1),
        y: dq(u[i++], -1, 1),
        a: dq(u[i++], 0, 6.2832),
        r: dq(u[i++], 0, 0.16),
        seed: u[i++] / 255,
        vx: 0,
        vy: 0,
        w: 0,
        kind,
        color,
        rgb: [...GEM[color]] as [number, number, number],
        density: DENSITY[kind] ?? 2,
        small: false,
        photo: -1,
        born: 0,
      };
      cell.bodies.push(b);
    }
    const g = u[i++];
    for (let k = 0; k < g; k++) {
      const color = GEMS[u[i++]] ?? 'gold';
      const cnt = u[i++] * 2;
      for (let j = 0; j < cnt; j++) cell.bodies.push(dust(color, rnd));
    }
    const len = u[i++];
    rec.name = new TextDecoder().decode(u.subarray(i, i + len));
    cell.liquid = LIQUIDS[rec.liquid];
    cell.level = cell.levelTarget = 1;
    return rec;
  } catch {
    return null;
  }
}

export function dust(color: GemName, rnd: () => number, x?: number, y?: number): Body {
  const a = rnd() * Math.PI * 2;
  const rr = Math.sqrt(rnd()) * 0.9;
  const item = SHELF.find((s) => s.kind === Kind.Glitter && s.color === color);
  const sz = item ? item.size : ([0.009, 0.014] as [number, number]);
  return {
    x: x ?? Math.cos(a) * rr,
    y: y ?? Math.sin(a) * rr,
    vx: 0,
    vy: 0,
    r: sz[0] + rnd() * (sz[1] - sz[0]),
    a: rnd() * 6.28,
    w: 0,
    kind: Kind.Glitter,
    color,
    rgb: [...GEM[color]] as [number, number, number],
    seed: rnd(),
    density: 1.3,
    small: true,
    photo: -1,
    born: 0,
  };
}
