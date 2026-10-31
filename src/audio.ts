// 音はすべてその場で合成する（録音素材なし）。
// 目標は ASMR の近さ：乾いた小さな粒の音、ガラスの硬い高音、粘る液体の低い泡。
// 鳴らし方の基準は参考動画 7 本（ガラスを切る・乳鉢で砕く・ビー玉が木を転がる・殻が割れる・
// ラメ入りスライムを混ぜる・ガラスの果物をすくう）の帯域と粒の密度に合わせた。

import { Kind } from './catalog';

type Ctx = AudioContext;

export class Sound {
  ctx: Ctx | null = null;
  master!: GainNode;
  muffle!: BiquadFilterNode;
  dry!: GainNode;
  wet!: GainNode;
  white!: AudioBuffer;
  enabled = true;
  private grind = { gain: null as GainNode | null, rumble: null as GainNode | null, src: null as AudioBufferSourceNode | null, rsrc: null as AudioBufferSourceNode | null, last: 0, acc: 0 };
  private pourNodes: { stop: () => void; set: (x: number) => void } | null = null;
  private hiss: { g: GainNode; f: BiquadFilterNode } | null = null;
  private lastHit = 0;
  private lastSound = 0;

  // 何も鳴っていないあいだは音の出口を止める。
  // 出口が開いたままだと、無音でもスマホのスピーカーやイヤホンが小さく「サー」と鳴るため。
  // 鳴らすときに wake() で開け直す
  private wake() {
    this.lastSound = performance.now();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }
  private sleepIfIdle() {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    if (this.grind.src || this.pourNodes) return;
    if (performance.now() - this.lastSound > 3500) c.suspend().catch(() => {});
  }

  unlock() {
    if (this.ctx) {
      this.wake();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.lastSound = performance.now();
    setInterval(() => this.sleepIfIdle(), 1000);
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.9 : 0;
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 18000;
    this.muffle.Q.value = 0.5;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.16;
    const verb = ctx.createConvolver();
    verb.buffer = this.impulse(1.6);
    this.dry.connect(this.muffle);
    this.wet.connect(verb).connect(this.muffle);
    this.muffle.connect(comp).connect(this.master).connect(ctx.destination);
    const n = ctx.sampleRate * 2;
    this.white = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = this.white.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    // iOS の消音スイッチ対策に無音を1回鳴らす
    const s = ctx.createBufferSource();
    s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    s.connect(ctx.destination);
    s.start();
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (this.ctx) this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.05);
  }

  // のぞいている間は音をこもらせる
  setMuffle(amount: number) {
    if (!this.ctx) return;
    const f = 18000 * Math.pow(1 - amount, 2) + 1400 * amount;
    this.muffle.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.4);
    this.wet.gain.setTargetAtTime(0.16 + amount * 0.18, this.ctx.currentTime, 0.4);
  }

  private impulse(sec: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2) * (i < 40 ? i / 40 : 1);
      }
    }
    return b;
  }

  private out(pan: number, wet = 1) {
    this.wake();
    const ctx = this.ctx!;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const g = ctx.createGain();
    if (p) {
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p);
      p.connect(this.dry);
      if (wet > 0) {
        const w = ctx.createGain();
        w.gain.value = wet;
        p.connect(w).connect(this.wet);
      }
    } else {
      g.connect(this.dry);
    }
    return g;
  }

  private noise(t: number, dur: number, f: number, q: number, amp: number, dest: AudioNode, type: BiquadFilterType = 'bandpass', attack = 0.0015) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.white;
    const bp = ctx.createBiquadFilter();
    bp.type = type;
    bp.frequency.value = f;
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(bp).connect(g).connect(dest);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.02);
  }

  private tone(t: number, f: number, dur: number, amp: number, dest: AudioNode, f2?: number, type: OscillatorType = 'sine') {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // ガラスの「チン」：非整数倍の部分音がすぐ消える
  private glass(t: number, f: number, amp: number, dest: AudioNode, ring = 1) {
    const parts: [number, number, number][] = [
      [1, 1, 0.5],
      [2.32, 0.55, 0.28],
      [4.25, 0.35, 0.14],
      [6.63, 0.22, 0.07],
    ];
    for (const [m, a, d] of parts) this.tone(t, f * m * (1 + (Math.random() - 0.5) * 0.01), d * ring, amp * a, dest);
    this.noise(t, 0.012, f * 3, 1.2, amp * 0.6, dest, 'highpass', 0.0005);
  }

  // 棚から筒へ落ちたときの音
  drop(kind: Kind, size: number, x: number, liquid: string | null) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime + 0.01;
    const o = this.out(x * 0.7);
    const small = 1 - Math.min(1, size / 0.12);
    if (liquid) {
      this.bubble(t, liquid, 0.4, o);
      return;
    }
    switch (kind) {
      case Kind.Glass:
      case Kind.Mineral:
        this.glass(t, 2400 + small * 2600, 0.11, o, 0.6);
        this.noise(t, 0.03, 900, 1.5, 0.08, o);
        break;
      case Kind.Pearl:
        this.glass(t, 3200 + small * 1500, 0.06, o, 0.35);
        this.tone(t, 380, 0.05, 0.05, o);
        break;
      case Kind.Gold:
        // 薄い金属箔：かさっ
        for (let i = 0; i < 7; i++) this.noise(t + i * 0.009 * Math.random() * 2, 0.02, 5000 + Math.random() * 4000, 2, 0.05, o);
        break;
      case Kind.Flower:
        for (let i = 0; i < 5; i++) this.noise(t + i * 0.012, 0.025, 2500 + Math.random() * 2500, 1.4, 0.04, o);
        break;
      case Kind.Glitter:
        this.sprinkle(t, 0.5, o);
        break;
      default:
        this.noise(t, 0.04, 1200, 1.2, 0.08, o);
        this.tone(t, 260, 0.06, 0.05, o);
    }
  }

  // ラメが降る：さらさら
  sprinkle(t: number, amt: number, dest?: AudioNode) {
    if (!this.ctx) return;
    const o = dest ?? this.out(0);
    const n = Math.floor(18 * amt + 6);
    for (let i = 0; i < n; i++) {
      const tt = t + Math.pow(Math.random(), 1.6) * 0.45;
      this.noise(tt, 0.006 + Math.random() * 0.01, 6000 + Math.random() * 6000, 3, 0.025 + Math.random() * 0.03, o);
    }
  }

  // ミンナート共鳴：泡は音程が少し上がりながら消える
  private bubble(t: number, liquid: string, amp: number, dest: AudioNode) {
    const thick = liquid === 'honey' ? 1 : liquid === 'oil' ? 0.5 : 0;
    const f0 = (380 + Math.random() * 500) * (1 - thick * 0.55);
    const dur = 0.05 + thick * 0.16;
    this.tone(t, f0, dur, amp * 0.22, dest, f0 * (1.6 - thick * 0.35));
    this.noise(t, 0.02 + thick * 0.05, 600 - thick * 300, 1, amp * 0.05, dest, 'lowpass');
  }

  // 粒どうし・壁とのあたり
  hit(kind: Kind, other: Kind | -1, speed: number, x: number, wet: boolean, r: number, liquid: string | null) {
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime;
    if (now - this.lastHit < 0.018) return;
    this.lastHit = now;
    const t = now + Math.random() * 0.01;
    const v = Math.min(1, speed / 1.6);
    const o = this.out(x * 0.8, 0.8);
    const soft = kind === Kind.Gold || kind === Kind.Flower || kind === Kind.Charm || kind === Kind.Photo;
    const thick = liquid === 'honey' ? 0.45 : liquid === 'oil' ? 0.7 : 1;
    const amp = v * v * (wet ? 0.07 * thick : 0.12);
    if (soft) {
      this.noise(t, 0.03, wet ? 700 : 1600, 1, amp * 0.6, o);
      return;
    }
    const f = (other === -1 ? 2100 : 2900) + (1 - Math.min(1, r / 0.1)) * 2400;
    if (wet) {
      // 液の中：こもった「こつ」
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2400 * thick;
      lp.connect(o);
      this.glass(t, f * 0.8, amp, lp, 0.35);
      this.tone(t, 300 + Math.random() * 120, 0.05, amp * 0.6, lp);
    } else {
      this.glass(t, f, amp, o, 0.8);
      // ビー玉が木の上で鳴る胴の音
      this.tone(t, 190 + Math.random() * 60, 0.045, amp * 0.7, o);
    }
  }

  // 回しているあいだの粒の流れ（ラメ・粉のさらさら）
  flow(amount: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (!this.hiss) {
      const s = ctx.createBufferSource();
      s.buffer = this.white;
      s.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 5200;
      f.Q.value = 0.7;
      const g = ctx.createGain();
      g.gain.value = 0;
      s.connect(f).connect(g).connect(this.out(0, 0.4));
      s.start();
      this.hiss = { g, f };
    }
    // 液の中でラメはいつも少し漂っている。その分（約0.06）は鳴らさず、回したときだけ「さらさら」
    const k = Math.max(0, amount - 0.09) / 0.12;
    const a = this.enabled ? Math.min(0.012, k * 0.012) : 0;
    if (a > 0.0005) this.wake();
    this.hiss.g.gain.setTargetAtTime(a, ctx.currentTime, 0.12);
  }

  // 乳鉢：指の速さで粒の細かさと密度が変わる。progress 0 → 1 で ガリ → ザリ → サラ
  grindStart() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (this.grind.src) return;
    const s = ctx.createBufferSource();
    s.buffer = this.white;
    s.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    const g = ctx.createGain();
    g.gain.value = 0;
    s.connect(lp).connect(g).connect(this.out(0, 0.3));
    s.start();
    this.grind.rsrc = s;
    this.grind.rumble = g;
    this.grind.src = s;
    this.grind.last = ctx.currentTime;
  }

  grindMove(speed: number, progress: number, x: number) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    this.wake();
    const now = ctx.currentTime;
    const dt = Math.min(0.1, now - this.grind.last);
    this.grind.last = now;
    const sp = Math.min(1, speed);
    this.grind.rumble?.gain.setTargetAtTime(sp * 0.09 * (1 - progress * 0.5), now, 0.03);
    // 粒の数：速いほど多い
    this.grind.acc += dt * (40 + 380 * sp) * (0.6 + progress * 0.8);
    const o = this.out(x * 0.5, 0.35);
    let n = 0;
    while (this.grind.acc >= 1 && n < 30) {
      this.grind.acc -= 1;
      n++;
      const t = now + Math.random() * 0.03;
      const fine = progress;
      const f = 1800 + fine * 5200 + Math.random() * (2500 + fine * 3000);
      const dur = 0.004 + (1 - fine) * 0.012 * Math.random();
      const amp = (0.03 + Math.random() * 0.06) * (1 - fine * 0.55) * (0.4 + sp * 0.8);
      this.noise(t, dur, f, 1.6 + fine * 2, amp, o);
      // まだ粗いうちは、ときどき「ガリッ」と割れる
      if (fine < 0.5 && Math.random() < 0.02 * (1 - fine * 2) * (0.5 + sp)) this.crack(t, x, 0.6);
    }
  }

  grindStop() {
    if (!this.ctx) return;
    this.grind.rumble?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    const s = this.grind.src;
    if (s) setTimeout(() => s.stop(), 300);
    this.grind.src = null;
  }

  // 石が割れる：鋭い立ち上がり＋破片のチン
  crack(t: number | null, x: number, amp = 1) {
    if (!this.ctx || !this.enabled) return;
    const tt = t ?? this.ctx.currentTime + 0.005;
    const o = this.out(x * 0.5);
    this.noise(tt, 0.05, 3200, 0.8, 0.22 * amp, o, 'bandpass', 0.0004);
    this.noise(tt, 0.11, 700, 0.9, 0.12 * amp, o);
    this.tone(tt, 140, 0.08, 0.12 * amp, o);
    for (let i = 0; i < 4; i++) this.glass(tt + 0.02 + Math.random() * 0.12, 3200 + Math.random() * 3500, 0.03 * amp, o, 0.4);
  }

  // 注ぐ：とくとく（水）→ とろー（はちみつ）
  pour(liquid: string, dur: number) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    this.pourNodes?.stop();
    const thick = liquid === 'honey' ? 1 : liquid === 'oil' ? 0.5 : 0;
    const o = this.out(0, 0.5);
    const s = ctx.createBufferSource();
    s.buffer = this.white;
    s.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900 - thick * 550;
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    const t0 = ctx.currentTime;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.07 - thick * 0.03, t0 + 0.25);
    s.connect(bp).connect(g).connect(o);
    s.start();
    let alive = true;
    const rate = 14 - thick * 10;
    const tick = () => {
      if (!alive || !this.ctx) return;
      this.bubble(this.ctx.currentTime + Math.random() * 0.02, liquid, 0.6 + Math.random() * 0.5, o);
      setTimeout(tick, (1000 / rate) * (0.5 + Math.random()));
    };
    tick();
    const stop = () => {
      if (!alive) return;
      alive = false;
      g.gain.setTargetAtTime(0, ctx.currentTime, 0.12);
      setTimeout(() => s.stop(), 600);
    };
    this.pourNodes = { stop, set: (x) => bp.frequency.setTargetAtTime((900 - thick * 550) * (0.7 + x * 0.5), ctx.currentTime, 0.2) };
    setTimeout(stop, dur * 1000);
  }

  // あふれた液が、筒の縁から床へ落ちる音
  spill(liquid: string) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime + 0.01;
    const thick = liquid === 'honey' ? 1 : liquid === 'oil' ? 0.5 : 0;
    const o = this.out((Math.random() - 0.5) * 0.6, 0.4);
    const f = 900 + Math.random() * 700 - thick * 450;
    this.tone(t, f, 0.06 + thick * 0.08, 0.05, o, f * (1.6 - thick * 0.4));
    this.noise(t, 0.05 + thick * 0.06, 1400 - thick * 600, 1.2, 0.05, o, 'bandpass', 0.002);
  }

  pourStop() {
    this.pourNodes?.stop();
    this.pourNodes = null;
  }

  // 絞りが開く：息のような風の音と、ガラスをこする柔らかい音
  open() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.05;
    const o = this.out(0, 1.4);
    const s = ctx.createBufferSource();
    s.buffer = this.white;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(3200, t + 2.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 1.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    s.connect(f).connect(g).connect(o);
    s.start(t);
    s.stop(t + 3.3);
    for (const [fr, d] of [
      [1318.5, 0],
      [1975.5, 0.35],
      [2637, 0.7],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.frequency.value = fr;
      const og = ctx.createGain();
      og.gain.setValueAtTime(0, t + d);
      og.gain.linearRampToValueAtTime(0.012, t + d + 0.8);
      og.gain.exponentialRampToValueAtTime(0.0001, t + d + 3.4);
      osc.connect(og).connect(o);
      osc.start(t + d);
      osc.stop(t + d + 3.5);
    }
  }

  // 暗転：筒が目に近づく
  close() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.out(0, 0.6);
    this.noise(t, 0.7, 220, 0.8, 0.07, o, 'lowpass', 0.25);
    this.tone(t + 0.45, 110, 0.18, 0.08, o);
    this.noise(t + 0.45, 0.06, 1800, 1, 0.04, o);
  }

  // 木の引き出し・ボタン
  tick(x = 0) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.out(x * 0.4, 0.3);
    this.noise(t, 0.025, 1500, 2.5, 0.06, o);
    this.tone(t, 820, 0.03, 0.025, o);
  }

  slide() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.out(0, 0.4);
    this.noise(t, 0.28, 2200, 0.7, 0.03, o, 'bandpass', 0.08);
  }

  // こすくまくんの文字が出るときの、キーボードを打つ音（ASMR）。声は出さない。
  // 押し始めの明るい「カ」、キーキャップの短い「コト」、底に当たる低い「とん」、指を離したときの小さな「こっ」。
  // 1打ごとに高さと強さを少し揺らす。スペース・句読点は少し低く、改行はいちばん深い
  key(kind: 'char' | 'space' | 'enter' = 'char') {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime + 0.005;
    const r = Math.random;
    const lv = (0.8 + r() * 0.4) * (kind === 'enter' ? 1.25 : kind === 'space' ? 1.1 : 1);
    const o = this.out((r() - 0.5) * 0.3, 0.22);
    const tock = kind === 'enter' ? 430 : kind === 'space' ? 560 : 860 + r() * 280;
    this.noise(t, 0.008, 1900 + r() * 500, 1.1, 0.12 * lv, o, 'bandpass', 0.0006);
    this.tone(t + 0.001, tock, 0.026, 0.11 * lv, o, tock * 0.96);
    const bt = t + 0.004 + r() * 0.006;
    this.noise(bt, 0.018, 1400, 0.9, 0.15 * lv, o, 'bandpass', 0.001);
    this.noise(bt, 0.018, 500, 0.8, 0.15 * lv, o, 'bandpass', 0.001);
    this.tone(bt, kind === 'char' ? 150 : 118, 0.04, 0.07 * lv, o, 110);
    // 大きいキーは、棒が小さくカタつく
    if (kind !== 'char') this.noise(bt + 0.012, 0.04, 1800, 2, 0.025 * lv, o, 'bandpass', 0.002);
    const ut = t + 0.045 + r() * 0.03;
    this.noise(ut, 0.008, 2400, 1.2, 0.035 * lv, o, 'bandpass', 0.0005);
    this.tone(ut, tock * 1.25, 0.02, 0.018 * lv, o);
  }

  // 片眼鏡を目に当てる：細いガラスの「ちん」
  monocle() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime + 0.01;
    const o = this.out(0.3, 1.2);
    this.glass(t, 4186, 0.035, o, 1.6);
    this.glass(t + 0.09, 5274, 0.02, o, 1.4);
  }

  // 結果の音：上手ならガラスの和音、失敗なら鈍い「ぽす」
  verdict(rank: number) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime + 0.25;
    const o = this.out(0, 1.4);
    if (rank >= 5) {
      const notes = rank >= 6 ? [1046.5, 1318.5, 1568, 2093, 2637, 3136] : [1046.5, 1318.5, 1568, 2093];
      notes.forEach((f, i) => this.glass(t + i * 0.11, f, 0.05, o, 2.4));
      if (rank >= 6) this.tone(t, 261.6, 2.2, 0.05, o);
    } else if (rank <= 1) {
      this.noise(t, 0.18, 260, 0.7, 0.16, o, 'lowpass', 0.004);
      this.tone(t, 110, 0.3, 0.12, o, 70);
      this.tone(t + 0.22, 196, 0.35, 0.05, o, 185);
      this.tone(t + 0.5, 164.8, 0.5, 0.05, o, 150);
    }
  }

  // 判子：ぽん
  stamp() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.out(0, 0.6);
    this.tone(t, 160, 0.16, 0.22, o, 90);
    this.noise(t, 0.06, 500, 0.7, 0.14, o, 'lowpass', 0.001);
    this.noise(t + 0.004, 0.03, 3000, 1, 0.03, o);
  }
}

export const sound = new Sound();

// 声を鳴らす文字かどうか（かな・漢字・英数字）
const ROWS: [string, string][] = [
  ['a', 'あかさたなはまやらわがざだばぱぁゃゎアカサタナハマヤラワガザダバパァャヮ'],
  ['i', 'いきしちにひみりぎじぢびぴぃイキシチニヒミリギジヂビピィ'],
  ['u', 'うくすつぬふむゆるぐずづぶぷぅゅウクスツヌフムユルグズヅブプゥュ'],
  ['e', 'えけせてねへめれげぜでべぺぇエケセテネヘメレゲゼデベペェ'],
  ['o', 'おこそとのほもよろをごぞどぼぽぉょオコソトノホモヨロヲゴゾドボポォョ'],
  ['n', 'んン'],
];
const VOWEL = new Map<string, string>();
for (const [v, s] of ROWS) for (const c of s) VOWEL.set(c, v);
export function vowelOf(ch: string): string | null {
  if (VOWEL.has(ch)) return VOWEL.get(ch)!;
  // 漢字は文字から母音を決める（毎回同じ字は同じ声）
  if (/[一-鿿]/.test(ch)) return 'aiueo'[ch.charCodeAt(0) % 5];
  if (/[a-zA-Z0-9]/.test(ch)) return 'aiueo'[ch.charCodeAt(0) % 5];
  return null;
}
