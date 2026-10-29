// 筒（オブジェクトセル）の中の動き。半径1の円の中で、ビーズが沈み・浮き・ぶつかる。
// 座標は「筒の座標」。筒を回すと重力の向きが筒に対して回る。

import { Kind, type Liquid } from './catalog';

export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  a: number; // 向き
  w: number; // 回転速度
  kind: Kind;
  rgb: [number, number, number];
  color: string;
  seed: number;
  density: number;
  small: boolean; // ラメ・粉。ほかの粒とは当たらない
  photo: number; // 写真の破片の番号（-1 = なし）
  born: number; // 入った時刻（落ちてくる演出用）
}

export interface Hit {
  x: number;
  y: number;
  speed: number;
  kind: Kind;
  other: Kind | -1; // -1 = 筒の壁
  wet: boolean;
  r: number;
}

const AIR_G = 7.0;
const LIQ_G = 2.4;

export class Cell {
  bodies: Body[] = [];
  liquid: Liquid | null = null;
  level = 0; // 溶液の高さ 0..1
  levelTarget = 0;
  angle = 0; // 筒の回転
  gdir = Math.PI * 1.5; // 画面上の重力の向き（下）
  time = 0;
  hits: Hit[] = [];
  stir = 0; // 回したときの流れ

  get bigCount() {
    return this.bodies.filter((b) => !b.small).length;
  }

  add(b: Body) {
    this.bodies.push(b);
  }

  // 筒の座標での重力ベクトル
  private gravity(): [number, number] {
    const g = this.gdir - this.angle;
    return [Math.cos(g), Math.sin(g)];
  }

  private wetAt(x: number, y: number, gx: number, gy: number) {
    if (!this.liquid) return false;
    if (this.level >= 0.999) return true;
    const up = -(x * gx + y * gy); // 上向きの高さ -1..1
    return up < -1 + 2 * this.level;
  }

  step(dt: number, angVel: number) {
    this.time += dt;
    this.level += (this.levelTarget - this.level) * Math.min(1, dt * (this.liquid?.id === 'honey' ? 0.55 : 1.1));
    const [gx, gy] = this.gravity();
    const L = this.liquid;
    const bs = this.bodies;
    this.stir = this.stir * Math.exp(-dt * 1.5) + Math.abs(angVel) * dt;
    for (const b of bs) {
      const wet = this.wetAt(b.x, b.y, gx, gy);
      let g: number;
      let drag: number;
      if (wet && L) {
        g = LIQ_G * (1 - L.density / b.density);
        drag = L.drag * (b.small ? 2.2 : 1) * (b.kind === Kind.Gold ? 2.4 : 1) * (b.kind === Kind.Flower ? 1.6 : 1);
        // ゆっくりした流れ。回すと筒の壁に引きずられて液が回る
        const t = this.time * 0.13;
        const fx = Math.sin(b.y * 2.3 + t * 3 + b.seed) * 0.06 + Math.sin(b.y * 5.1 - t * 2) * 0.02;
        const fy = Math.cos(b.x * 2.1 - t * 2.4 + b.seed) * 0.06 + Math.cos(b.x * 4.7 + t * 1.7) * 0.02;
        const swirl = -angVel * 0.55 * Math.min(1, Math.hypot(b.x, b.y));
        b.vx += (fx - b.y * swirl) * dt * (b.small ? 3 : 1);
        b.vy += (fy + b.x * swirl) * dt * (b.small ? 3 : 1);
      } else {
        g = AIR_G * (b.small ? 0.35 : 1);
        drag = b.small ? 3.5 : 0.25;
      }
      b.vx += gx * g * dt;
      b.vy += gy * g * dt;
      const k = Math.exp(-drag * dt);
      b.vx *= k;
      b.vy *= k;
      b.w *= Math.exp(-(wet ? 3 : 1.2) * dt);
      if (b.small) {
        // ラメは向きが勝手に変わってきらめく
        b.w += (Math.sin(this.time * 1.7 + b.seed * 13) * 2.5 + (Math.hypot(b.vx, b.vy) * 40)) * dt;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.a += b.w * dt;
    }
    // 粒どうし
    for (let it = 0; it < 3; it++) {
      for (let i = 0; i < bs.length; i++) {
        const a = bs[i];
        if (a.small) continue;
        for (let j = i + 1; j < bs.length; j++) {
          const b = bs[j];
          if (b.small) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const rr = (a.r + b.r) * 0.92;
          const d2 = dx * dx + dy * dy;
          if (d2 >= rr * rr || d2 < 1e-12) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d;
          const ny = dy / d;
          const ma = a.r * a.r * a.density;
          const mb = b.r * b.r * b.density;
          const pen = rr - d;
          const sa = mb / (ma + mb);
          const sb = ma / (ma + mb);
          a.x -= nx * pen * sa;
          a.y -= ny * pen * sa;
          b.x += nx * pen * sb;
          b.y += ny * pen * sb;
          const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rv < 0) {
            const wet = this.wetAt(a.x, a.y, gx, gy);
            const e = wet ? 0.05 : 0.32;
            const jimp = (-(1 + e) * rv) / (1 / ma + 1 / mb);
            a.vx -= (jimp / ma) * nx;
            a.vy -= (jimp / ma) * ny;
            b.vx += (jimp / mb) * nx;
            b.vy += (jimp / mb) * ny;
            // 転がり
            const tv = (b.vx - a.vx) * -ny + (b.vy - a.vy) * nx;
            a.w += tv * 2.5;
            b.w -= tv * 2.5;
            if (it === 0 && -rv > 0.12) {
              this.hits.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, speed: -rv, kind: a.kind, other: b.kind, wet, r: Math.min(a.r, b.r) });
            }
          }
        }
      }
    }
    // 壁
    for (const b of bs) {
      const R = 0.985 - b.r * (b.small ? 1 : 0.9);
      const d = Math.hypot(b.x, b.y);
      if (d > R) {
        const nx = b.x / d;
        const ny = b.y / d;
        b.x = nx * R;
        b.y = ny * R;
        const vn = b.vx * nx + b.vy * ny;
        if (vn > 0) {
          const wet = this.wetAt(b.x, b.y, gx, gy);
          const e = b.small ? 0 : wet ? 0.04 : 0.3;
          b.vx -= (1 + e) * vn * nx;
          b.vy -= (1 + e) * vn * ny;
          // 壁に沿って転がる。回した分だけ壁に引きずられる
          const tx = -ny;
          const ty = nx;
          const wall = angVel * R;
          const vt = b.vx * tx + b.vy * ty;
          const f = Math.min(1, (wet ? 0.6 : 0.25) * 0.016 * 60);
          b.vx += (wall - vt) * tx * f * 0.15;
          b.vy += (wall - vt) * ty * f * 0.15;
          b.w = vt / Math.max(b.r, 0.02);
          if (!b.small && vn > 0.12) this.hits.push({ x: b.x, y: b.y, speed: vn, kind: b.kind, other: -1, wet, r: b.r });
        }
      }
    }
  }

  // 筒を目に当てる：中身がふわっと舞う
  lift(rnd: () => number) {
    const g = this.gdir - this.angle;
    const ux = -Math.cos(g);
    const uy = -Math.sin(g);
    for (const b of this.bodies) {
      const k = (0.1 + rnd() * 0.35) * (b.small ? 0.5 : 1);
      b.vx += ux * k + (rnd() - 0.5) * 0.3;
      b.vy += uy * k + (rnd() - 0.5) * 0.3;
      b.w += (rnd() - 0.5) * 6;
    }
  }

  // 落ちてきたばかりの粒を筒の上の方に置く
  dropPoint(rnd: () => number): [number, number] {
    const g = this.gdir - this.angle;
    const ux = -Math.cos(g);
    const uy = -Math.sin(g);
    const side = (rnd() - 0.5) * 0.9;
    return [ux * 0.62 + -uy * side, uy * 0.62 + ux * side];
  }
}

export function mulberry(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
