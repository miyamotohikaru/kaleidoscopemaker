// 乳鉢：宝石を指でごりごり砕いて、きらきらの粉にする。
// 粗いうちは「かけら」、細かくなると「粉」として筒に入る。

import { GEM, type GemName } from './catalog';
import { sound } from './audio';

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  a: number;
  tw: number;
  sides: number;
  shard: boolean;
}

export interface MortarResult {
  color: GemName;
  shards: number;
  dust: number;
}

const css = (c: readonly number[], k = 1, a = 1) =>
  `rgba(${Math.round(Math.min(1, Math.pow(c[0] * k, 1 / 2.2)) * 255)},${Math.round(Math.min(1, Math.pow(c[1] * k, 1 / 2.2)) * 255)},${Math.round(Math.min(1, Math.pow(c[2] * k, 1 / 2.2)) * 255)},${a})`;

export class Mortar {
  ctx: CanvasRenderingContext2D;
  size = 360;
  progress = 0;
  color: GemName = 'sapphire';
  bits: Bit[] = [];
  pestle = { x: 0, y: 0.1, down: false, lx: 0, ly: 0, lt: 0 };
  granite: HTMLCanvasElement;
  raf = 0;
  cracks: [number, number, number, number][] = [];
  onProgress: (p: number) => void = () => {};

  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.granite = document.createElement('canvas');
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    const up = () => this.up();
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', up);
  }

  open(color: GemName) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const s = this.canvas.getBoundingClientRect().width || 340;
    this.size = s;
    this.canvas.width = this.canvas.height = Math.round(s * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.makeGranite(s, dpr);
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
    this.progress = 0;
    this.bits = [];
    this.cracks = [];
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

  private makeGranite(s: number, dpr: number) {
    const g = this.granite;
    g.width = g.height = Math.round(s * dpr);
    const x = g.getContext('2d')!;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.fillStyle = '#26262a';
    x.fillRect(0, 0, s, s);
    for (let i = 0; i < s * s * 0.06; i++) {
      const l = Math.random();
      x.fillStyle = l < 0.75 ? `rgba(0,0,0,${0.3 + Math.random() * 0.4})` : l < 0.95 ? `rgba(150,150,155,${0.25 + Math.random() * 0.3})` : `rgba(230,225,215,${0.4 + Math.random() * 0.4})`;
      const r = Math.random() * (l > 0.95 ? 1.4 : 1.1) + 0.3;
      x.fillRect(Math.random() * s, Math.random() * s, r, r);
    }
  }

  private local(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1];
  }

  private down(e: PointerEvent) {
    this.canvas.setPointerCapture(e.pointerId);
    const [x, y] = this.local(e);
    Object.assign(this.pestle, { down: true, x, y, lx: x, ly: y, lt: performance.now() });
    sound.grindStart();
  }

  private move(e: PointerEvent) {
    if (!this.pestle.down) return;
    let [x, y] = this.local(e);
    const d = Math.hypot(x, y);
    const R = 0.6;
    if (d > R) {
      x *= R / d;
      y *= R / d;
    }
    const now = performance.now();
    const dist = Math.hypot(x - this.pestle.lx, y - this.pestle.ly);
    const dt = Math.max(1, now - this.pestle.lt) / 1000;
    const speed = dist / dt;
    this.pestle.x = x;
    this.pestle.y = y;
    this.pestle.lx = x;
    this.pestle.ly = y;
    this.pestle.lt = now;
    if (dist > 0.002) this.grind(dist, speed, x);
  }

  private up() {
    if (!this.pestle.down) return;
    this.pestle.down = false;
    sound.grindStop();
  }

  private grind(dist: number, speed: number, x: number) {
    const before = this.progress;
    this.progress = Math.min(1, this.progress + dist / 26);
    const p = this.progress;
    sound.grindMove(speed / 3, p, x);
    // ひびが入る → 割れる
    if (p < 0.14 && Math.random() < dist * 4) {
      const a = Math.random() * Math.PI * 2;
      this.cracks.push([0, 0, Math.cos(a) * 0.2, Math.sin(a) * 0.2]);
    }
    if (before < 0.14 && p >= 0.14) {
      sound.crack(null, 0, 1);
      for (let i = 0; i < 8; i++) this.addBit(true, 0.05 + Math.random() * 0.045);
    }
    // かけらが小さくなり、粉が増える
    if (p >= 0.14) {
      for (const b of this.bits) {
        if (!b.shard) continue;
        const near = Math.hypot(b.x - this.pestle.x, b.y - this.pestle.y) < 0.2;
        if (near) b.r *= 1 - dist * 1.6;
      }
      const target = Math.floor(Math.max(0, p - 0.18) * 520);
      const dustNow = this.bits.filter((b) => !b.shard).length;
      for (let i = dustNow; i < target; i++) this.addBit(false, 0.006 + Math.random() * 0.009, this.pestle.x, this.pestle.y);
      const shards = this.bits.filter((b) => b.shard && b.r > 0.014);
      if (shards.length < 3 && p < 0.7 && Math.random() < dist * 6) this.addBit(true, 0.02 + Math.random() * 0.02, this.pestle.x, this.pestle.y);
      this.bits = this.bits.filter((b) => !b.shard || b.r > 0.012);
    }
    // すりこぎに押される
    for (const b of this.bits) {
      const dx = b.x - this.pestle.x;
      const dy = b.y - this.pestle.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.17 && d > 1e-4) {
        b.vx += (dx / d) * 0.012 + (Math.random() - 0.5) * 0.01;
        b.vy += (dy / d) * 0.012 + (Math.random() - 0.5) * 0.01;
        b.a += (Math.random() - 0.5) * 0.8;
      }
    }
    if (Math.floor(before * 20) !== Math.floor(p * 20)) this.onProgress(p);
  }

  private addBit(shard: boolean, r: number, x = 0, y = 0) {
    const a = Math.random() * Math.PI * 2;
    const s = shard ? 0.012 : 0.02;
    this.bits.push({ x: x + Math.cos(a) * 0.04, y: y + Math.sin(a) * 0.04, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r, a: Math.random() * 6, tw: Math.random() * 6, sides: shard ? 4 + Math.floor(Math.random() * 3) : 6, shard });
  }

  private frame() {
    const s = this.size;
    const x = this.ctx;
    const c = s / 2;
    const S = s / 2;
    x.clearRect(0, 0, s, s);
    // 鉢
    x.save();
    x.beginPath();
    x.arc(c, c, S * 0.96, 0, Math.PI * 2);
    x.clip();
    x.drawImage(this.granite, 0, 0, s, s);
    const rim = x.createRadialGradient(c - S * 0.3, c - S * 0.35, S * 0.1, c, c, S * 0.96);
    rim.addColorStop(0, 'rgba(255,255,255,.08)');
    rim.addColorStop(1, 'rgba(0,0,0,.45)');
    x.fillStyle = rim;
    x.fillRect(0, 0, s, s);
    x.beginPath();
    x.arc(c, c, S * 0.72, 0, Math.PI * 2);
    const bowl = x.createRadialGradient(c + S * 0.12, c + S * 0.16, S * 0.05, c, c, S * 0.72);
    bowl.addColorStop(0, 'rgba(255,255,255,.07)');
    bowl.addColorStop(0.6, 'rgba(0,0,0,.25)');
    bowl.addColorStop(1, 'rgba(0,0,0,.72)');
    x.fillStyle = bowl;
    x.fill();
    x.restore();
    x.strokeStyle = 'rgba(255,255,255,.08)';
    x.lineWidth = 1;
    x.beginPath();
    x.arc(c, c, S * 0.72, Math.PI * 0.9, Math.PI * 1.6);
    x.stroke();

    const col = GEM[this.color];
    const t = performance.now() / 1000;
    // 原石
    if (this.progress < 0.14) {
      x.save();
      x.translate(c, c);
      x.rotate(0.3);
      const rr = S * 0.2;
      const n = 7;
      const pts: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const k = 0.78 + 0.22 * Math.abs(Math.sin(i * 2.3 + 1));
        pts.push([Math.cos(a) * rr * k, Math.sin(a) * rr * k]);
      }
      x.shadowColor = 'rgba(0,0,0,.6)';
      x.shadowBlur = 14;
      x.shadowOffsetY = 6;
      for (let i = 0; i < n; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[(i + 1) % n];
        x.beginPath();
        x.moveTo(rr * 0.12, -rr * 0.1);
        x.lineTo(ax, ay);
        x.lineTo(bx, by);
        x.closePath();
        const br = 0.5 + 0.9 * Math.abs(Math.sin(i * 1.7 + 0.4));
        x.fillStyle = css(col, br);
        x.fill();
        x.shadowColor = 'transparent';
        x.strokeStyle = css(col, 2.4, 0.7);
        x.lineWidth = 0.8;
        x.stroke();
      }
      x.strokeStyle = 'rgba(255,255,255,.85)';
      x.lineWidth = 1;
      for (const [x0, y0, x1, y1] of this.cracks) {
        x.beginPath();
        x.moveTo(x0 * S, y0 * S);
        x.lineTo(x1 * S, y1 * S);
        x.stroke();
      }
      x.restore();
    }
    // かけらと粉
    for (const b of this.bits) {
      b.x += b.vx;
      b.y += b.vy;
      b.vx *= 0.86;
      b.vy *= 0.86;
      // 鉢の底へ
      b.vx -= b.x * 0.0009;
      b.vy -= b.y * 0.0009;
      const d = Math.hypot(b.x, b.y);
      if (d > 0.66) {
        b.x *= 0.66 / d;
        b.y *= 0.66 / d;
      }
      const px = c + b.x * S;
      const py = c + b.y * S;
      const r = b.r * S;
      x.save();
      x.translate(px, py);
      x.rotate(b.a);
      x.beginPath();
      for (let i = 0; i < b.sides; i++) {
        const a = (i / b.sides) * Math.PI * 2;
        const k = b.shard ? 0.7 + 0.3 * Math.abs(Math.sin(i * 3.1 + b.tw)) : 1;
        if (i === 0) x.moveTo(Math.cos(a) * r * k, Math.sin(a) * r * k);
        else x.lineTo(Math.cos(a) * r * k, Math.sin(a) * r * k);
      }
      x.closePath();
      const tw = Math.pow(0.5 + 0.5 * Math.sin(t * 3 + b.tw * 9 + b.a * 4), 18);
      x.fillStyle = css(col, (b.shard ? 1.2 : 0.9) + tw * 3);
      x.fill();
      if (b.shard) {
        x.strokeStyle = css(col, 2.6, 0.8);
        x.lineWidth = 0.7;
        x.stroke();
      }
      x.restore();
      if (!b.shard && tw > 0.5) {
        x.fillStyle = `rgba(255,255,255,${tw * 0.9})`;
        x.fillRect(px - 0.6, py - r * 2, 1.2, r * 4);
        x.fillRect(px - r * 2, py - 0.6, r * 4, 1.2);
      }
    }
    // すりこぎ（上から見た先端）
    const p = this.pestle;
    const pr = S * 0.15;
    const px = c + p.x * S;
    const py = c + p.y * S;
    x.save();
    x.globalAlpha = p.down ? 1 : 0.92;
    x.shadowColor = 'rgba(0,0,0,.7)';
    x.shadowBlur = p.down ? 10 : 26;
    x.shadowOffsetX = p.down ? 3 : 10;
    x.shadowOffsetY = p.down ? 5 : 16;
    x.beginPath();
    x.arc(px, py, pr, 0, Math.PI * 2);
    x.fillStyle = '#2b2a2d';
    x.fill();
    x.restore();
    x.save();
    x.beginPath();
    x.arc(px, py, pr, 0, Math.PI * 2);
    x.clip();
    x.drawImage(this.granite, px - pr * 3, py - pr * 3, pr * 6, pr * 6);
    const sh = x.createRadialGradient(px - pr * 0.4, py - pr * 0.5, pr * 0.1, px, py, pr);
    sh.addColorStop(0, 'rgba(255,255,255,.22)');
    sh.addColorStop(1, 'rgba(0,0,0,.5)');
    x.fillStyle = sh;
    x.fillRect(px - pr, py - pr, pr * 2, pr * 2);
    x.restore();
    // 真鍮の口金
    x.beginPath();
    x.arc(px, py, pr * 0.55, 0, Math.PI * 2);
    const brass = x.createLinearGradient(px - pr, py - pr, px + pr, py + pr);
    brass.addColorStop(0, '#e9cd8e');
    brass.addColorStop(0.5, '#8b6529');
    brass.addColorStop(1, '#d6b46d');
    x.fillStyle = brass;
    x.fill();
  }
}
