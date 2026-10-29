// 乳鉢：黒い石の鉢で宝石を指でごりごり砕く。
// 鉢とすりこぎは Blender で描いた絵（真上から）。宝石とかけらは筒の中と同じシェーダーで描いた絵を使う。
// 砕いた粉は鉢の底に擦りつけたように溜まっていき、光がちらちら瞬く。

import { GEM, type GemName } from './catalog';
import { sound } from './audio';

export interface Sprites {
  crystal: HTMLImageElement;
  shards: HTMLImageElement[];
}

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  a: number;
  va: number;
  img: number;
}
interface Spark {
  x: number;
  y: number;
  ph: number;
  sp: number;
}

export interface MortarResult {
  color: GemName;
  shards: number;
  dust: number;
}

// 絵の寸法（mortar.py の出力から）
const MORTAR_WORLD = 2.12; // 鉢の絵の横幅（Blender の単位）
const PESTLE_WORLD = 2.6;
const TIP = [0.2115, 0.769]; // すりこぎの先（絵の中の位置）
const FLOOR = 0.6; // 粉が溜まる底の半径（鉢の絵の半径に対する比）

function load(src: string) {
  const i = new Image();
  i.src = src;
  return i;
}

const lin = (c: number) => Math.round(Math.min(1, Math.pow(c, 1 / 2.2)) * 255);

export class Mortar {
  ctx: CanvasRenderingContext2D;
  size = 360;
  progress = 0;
  color: GemName = 'sapphire';
  bits: Bit[] = [];
  sparks: Spark[] = [];
  powder: HTMLCanvasElement;
  pctx: CanvasRenderingContext2D;
  bowl = load('/mortar.webp');
  pestleImg = load('/pestle.webp');
  pestle = { x: 0.12, y: 0.16, down: false, lx: 0, ly: 0, lt: 0, press: 0 };
  raf = 0;
  cracks: [number, number, number, number][] = [];
  wob = 0;
  sprites: Sprites | null = null;
  onProgress: (p: number) => void = () => {};
  getSprites: (c: GemName) => Sprites = () => ({ crystal: new Image(), shards: [] });

  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.powder = document.createElement('canvas');
    this.pctx = this.powder.getContext('2d')!;
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    const up = () => this.up();
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  }

  open(color: GemName) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const s = this.canvas.getBoundingClientRect().width || 340;
    this.size = s;
    this.canvas.width = this.canvas.height = Math.round(s * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.powder.width = this.powder.height = Math.round(s * dpr);
    this.pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.reset(color);
    cancelAnimationFrame(this.raf);
    const loop = () => {
      this.frame();
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  close() {
    cancelAnimationFrame(this.raf);
    sound.grindStop();
  }

  reset(color: GemName) {
    this.color = color;
    this.sprites = this.getSprites(color);
    this.progress = 0;
    this.bits = [];
    this.sparks = [];
    this.cracks = [];
    this.pctx.clearRect(0, 0, this.size, this.size);
    this.onProgress(0);
  }

  result(): MortarResult {
    const p = this.progress;
    return {
      color: this.color,
      shards: p < 0.5 ? Math.round(3 + (1 - p * 2) * 5) : Math.round(Math.max(0, (0.85 - p) * 6)),
      dust: Math.round(Math.min(1, p / 0.9) * 150),
    };
  }

  private local(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1];
  }

  private down(e: PointerEvent) {
    this.canvas.setPointerCapture(e.pointerId);
    let [x, y] = this.local(e);
    [x, y] = this.clampIn(x, y);
    Object.assign(this.pestle, { down: true, x, y, lx: x, ly: y, lt: performance.now() });
    sound.grindStart();
    sound.tick(x);
  }

  private clampIn(x: number, y: number) {
    const d = Math.hypot(x, y);
    const R = FLOOR * 0.92;
    return d > R ? [(x * R) / d, (y * R) / d] : [x, y];
  }

  private move(e: PointerEvent) {
    if (!this.pestle.down) return;
    const [x, y] = this.clampIn(...(this.local(e) as [number, number]));
    const now = performance.now();
    const dist = Math.hypot(x - this.pestle.lx, y - this.pestle.ly);
    const dt = Math.max(1, now - this.pestle.lt) / 1000;
    const speed = dist / dt;
    Object.assign(this.pestle, { x, y, lx: x, ly: y, lt: now });
    if (dist > 0.002) this.grind(dist, speed, x);
  }

  private up() {
    if (!this.pestle.down) return;
    this.pestle.down = false;
    sound.grindStop();
  }

  private grind(dist: number, speed: number, x: number) {
    const before = this.progress;
    this.progress = Math.min(1, this.progress + dist / 24);
    const p = this.progress;
    sound.grindMove(speed / 3, p, x);
    const P = this.pestle;
    // 原石の上を通るたびにひび
    if (p < 0.14) {
      if (Math.hypot(P.x, P.y) < 0.28) {
        this.wob = 1;
        if (Math.random() < dist * 5) {
          const a = Math.random() * Math.PI * 2;
          const l = 0.08 + Math.random() * 0.12;
          const ox = (Math.random() - 0.5) * 0.08;
          const oy = (Math.random() - 0.5) * 0.08;
          this.cracks.push([ox, oy, ox + Math.cos(a) * l, oy + Math.sin(a) * l]);
        }
      }
    }
    if (before < 0.14 && p >= 0.14) {
      sound.crack(null, 0, 1);
      for (let i = 0; i < 9; i++) this.addBit(0.07 + Math.random() * 0.06, 0, 0, 0.03);
    }
    if (p >= 0.14) {
      for (const b of this.bits) {
        const d = Math.hypot(b.x - P.x, b.y - P.y);
        if (d < 0.17) {
          b.r *= 1 - dist * 1.3;
          // 割れて小さいかけらが飛ぶ
          if (b.r > 0.04 && Math.random() < dist * 2.5) {
            b.r *= 0.75;
            this.addBit(b.r * 0.7, b.x, b.y, 0.02);
            sound.crack(null, x, 0.25);
          }
        }
      }
      this.bits = this.bits.filter((b) => b.r > 0.016);
      // 粉を底に擦りつける
      this.smear(P.x, P.y, dist, p);
    }
    // すりこぎに押されて転がる
    for (const b of this.bits) {
      const dx = b.x - P.x;
      const dy = b.y - P.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.15 + b.r && d > 1e-4) {
        const k = 0.02 * (1 - d / (0.15 + b.r));
        b.vx += (dx / d) * k;
        b.vy += (dy / d) * k;
        b.va += (Math.random() - 0.5) * 0.2;
      }
    }
    if (Math.floor(before * 20) !== Math.floor(p * 20)) this.onProgress(p);
  }

  private smear(x: number, y: number, dist: number, p: number) {
    const s = this.size;
    const c = s / 2;
    const S = (s / 2) * 0.96;
    const g = GEM[this.color];
    const x2 = this.pctx;
    x2.save();
    x2.beginPath();
    x2.arc(c, c, S * FLOOR, 0, Math.PI * 2);
    x2.clip();
    const n = Math.ceil(dist * 900 * (0.4 + p));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 0.13;
      const px = c + (x + Math.cos(a) * r) * S;
      const py = c + (y + Math.sin(a) * r) * S;
      const k = 0.55 + Math.random() * 0.9;
      x2.fillStyle = `rgba(${lin(g[0] * k)},${lin(g[1] * k)},${lin(g[2] * k)},${0.25 + Math.random() * 0.4})`;
      const sz = 0.5 + Math.random() * 1.3;
      x2.fillRect(px, py, sz, sz);
      if (Math.random() < 0.06 && this.sparks.length < 260) this.sparks.push({ x: (px - c) / S, y: (py - c) / S, ph: Math.random() * 6.28, sp: 1 + Math.random() * 3 });
    }
    // 擦った跡（うっすら）
    const grd = x2.createRadialGradient(c + x * S, c + y * S, 0, c + x * S, c + y * S, S * 0.16);
    grd.addColorStop(0, `rgba(${lin(g[0])},${lin(g[1])},${lin(g[2])},${0.035 + p * 0.03})`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    x2.fillStyle = grd;
    x2.fillRect(c + x * S - S * 0.16, c + y * S - S * 0.16, S * 0.32, S * 0.32);
    x2.restore();
  }

  private addBit(r: number, x: number, y: number, sp: number) {
    const a = Math.random() * Math.PI * 2;
    const n = this.sprites?.shards.length || 1;
    this.bits.push({ x: x + Math.cos(a) * 0.03, y: y + Math.sin(a) * 0.03, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r, a: Math.random() * 6.28, va: (Math.random() - 0.5) * 0.3, img: Math.floor(Math.random() * n) });
  }

  private frame() {
    const s = this.size;
    const x = this.ctx;
    const c = s / 2;
    const S = (s / 2) * 0.96;
    const t = performance.now() / 1000;
    const P = this.pestle;
    P.press += ((P.down ? 1 : 0) - P.press) * 0.25;
    x.clearRect(0, 0, s, s);

    // 鉢の影と鉢
    x.save();
    x.shadowColor = 'rgba(0,0,0,.75)';
    x.shadowBlur = s * 0.08;
    x.shadowOffsetX = s * 0.025;
    x.shadowOffsetY = s * 0.04;
    if (this.bowl.complete && this.bowl.naturalWidth) x.drawImage(this.bowl, c - S, c - S, S * 2, S * 2);
    x.restore();

    // 底に溜まった粉
    x.drawImage(this.powder, 0, 0, s, s);
    const g = GEM[this.color];
    for (const sp of this.sparks) {
      const k = Math.pow(0.5 + 0.5 * Math.sin(t * sp.sp + sp.ph), 24);
      if (k < 0.05) continue;
      const px = c + sp.x * S;
      const py = c + sp.y * S;
      x.fillStyle = `rgba(255,255,255,${k * 0.9})`;
      x.fillRect(px - 0.5, py - 2.5 * k, 1, 5 * k);
      x.fillRect(px - 2.5 * k, py - 0.5, 5 * k, 1);
      x.fillStyle = `rgba(${lin(g[0] * 2)},${lin(g[1] * 2)},${lin(g[2] * 2)},${k * 0.6})`;
      x.beginPath();
      x.arc(px, py, 1.6 * k, 0, Math.PI * 2);
      x.fill();
    }

    // 原石
    const sp = this.sprites;
    if (this.progress < 0.14 && sp?.crystal.complete) {
      this.wob *= 0.85;
      const r = S * 0.27;
      x.save();
      x.translate(c + Math.sin(t * 60) * this.wob * 1.2, c);
      x.rotate(0.3);
      x.shadowColor = 'rgba(0,0,0,.6)';
      x.shadowBlur = 12;
      x.shadowOffsetY = 6;
      x.drawImage(sp.crystal, -r, -r, r * 2, r * 2);
      x.shadowColor = 'transparent';
      x.strokeStyle = 'rgba(255,255,255,.75)';
      x.lineWidth = 0.8;
      for (const [x0, y0, x1, y1] of this.cracks) {
        x.beginPath();
        x.moveTo(x0 * S, y0 * S);
        x.lineTo((x0 + x1) * 0.5 * S + 2, (y0 + y1) * 0.5 * S - 1);
        x.lineTo(x1 * S, y1 * S);
        x.stroke();
      }
      x.restore();
    }
    // かけら
    for (const b of this.bits) {
      b.x += b.vx;
      b.y += b.vy;
      b.a += b.va;
      b.vx *= 0.88;
      b.vy *= 0.88;
      b.va *= 0.9;
      // 鉢の底へ寄る
      b.vx -= b.x * 0.0012;
      b.vy -= b.y * 0.0012;
      const d = Math.hypot(b.x, b.y);
      const lim = FLOOR * 0.95 - b.r * 0.5;
      if (d > lim) {
        b.x *= lim / d;
        b.y *= lim / d;
        b.vx *= -0.3;
        b.vy *= -0.3;
      }
      const img = sp?.shards[b.img];
      if (!img?.complete) continue;
      const r = b.r * S * 1.25;
      x.save();
      x.translate(c + b.x * S, c + b.y * S);
      x.rotate(b.a);
      x.shadowColor = 'rgba(0,0,0,.55)';
      x.shadowBlur = 6;
      x.shadowOffsetY = 3;
      x.drawImage(img, -r, -r, r * 2, r * 2);
      x.restore();
    }

    // すりこぎ：先が指の位置。押すと少し沈む
    const pi = this.pestleImg;
    if (pi.complete && pi.naturalWidth) {
      const W = S * 2 * (PESTLE_WORLD / MORTAR_WORLD);
      const tx = c + P.x * S;
      const ty = c + P.y * S;
      const lift = (1 - P.press) * S * 0.05;
      // 影
      x.save();
      x.globalAlpha = 0.55 - P.press * 0.15;
      x.filter = `blur(${8 - P.press * 4}px)`;
      x.fillStyle = '#000';
      x.beginPath();
      x.ellipse(tx + S * 0.08 + lift, ty + S * 0.1 + lift, S * 0.12, S * 0.07, 0.7, 0, Math.PI * 2);
      x.fill();
      x.restore();
      x.drawImage(pi, tx - TIP[0] * W - lift * 0.4, ty - TIP[1] * W - lift, W, W);
    }
  }
}
