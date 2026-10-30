// こすくまくんの声を選ぶページ。声の種類とつまみを動かして試し、設定をコピーしてもらう。
// 本体（audio.ts）とは切り離した、試し聞き専用の小さな合成器。
import { vowelOf } from './audio';

type Kind = 'murmur' | 'hum' | 'whisper' | 'tone' | 'blip';
interface P {
  kind: Kind;
  pitch: number; // 声の高さ（Hz）
  speed: number; // 1文字の長さ（ms）
  bright: number; // こもり具合（ローパスの Hz。小さいほどこもる）
  mouth: number; // 口の開き（フォルマントの倍率）
  breath: number; // 息の量 0..1
  wobble: number; // 声のゆれ 0..1
  melody: number; // 抑揚 0..1
  drop: number; // 語尾の下がり 0..1
  every: 1 | 2; // 1文字ずつの声で、何文字に1回鳴らすか
  wave: OscillatorType;
  volume: number;
}

const PRESETS: { id: string; label: string; note: string; p: P }[] = [
  {
    id: 'mogo',
    label: 'もごもご',
    note: 'いまのサイトの声。ひと息ごとに、こもった低い声でつぶやく。',
    p: { kind: 'murmur', pitch: 132, speed: 120, bright: 1500, mouth: 1, breath: 0.3, wobble: 0.3, melody: 0, drop: 0.5, every: 1, wave: 'sawtooth', volume: 0.8 },
  },
  {
    id: 'nui',
    label: 'ぬいぐるみ',
    note: '少し高く、もっとこもらせた声。綿の中でしゃべっている感じ。',
    p: { kind: 'murmur', pitch: 205, speed: 110, bright: 850, mouth: 1.15, breath: 0.2, wobble: 0.15, melody: 0.3, drop: 0.35, every: 1, wave: 'sawtooth', volume: 0.85 },
  },
  {
    id: 'hum',
    label: 'ハミング',
    note: '口を閉じた「んー」で、言葉の抑揚だけ伝える。',
    p: { kind: 'hum', pitch: 150, speed: 130, bright: 700, mouth: 1, breath: 0.1, wobble: 0.2, melody: 0.55, drop: 0.6, every: 1, wave: 'triangle', volume: 0.85 },
  },
  {
    id: 'whisper',
    label: 'ささやき',
    note: '声帯を使わない、息だけの声。ひそひそ話す。',
    p: { kind: 'whisper', pitch: 150, speed: 110, bright: 2600, mouth: 1, breath: 1, wobble: 0, melody: 0, drop: 0, every: 1, wave: 'sawtooth', volume: 0.9 },
  },
  {
    id: 'potsu',
    label: 'ぽつぽつ',
    note: 'ひとつ前の版。毛糸を巻いたピアノのような丸い音を、2文字に1回。',
    p: { kind: 'tone', pitch: 196, speed: 125, bright: 1100, mouth: 1, breath: 0.2, wobble: 0, melody: 0.15, drop: 0.5, every: 2, wave: 'sine', volume: 0.8 },
  },
  {
    id: 'koro',
    label: 'ころころ',
    note: '木の玉を転がしたような、短くて軽い音。1文字ずつ。',
    p: { kind: 'blip', pitch: 330, speed: 90, bright: 2400, mouth: 1, breath: 0, wobble: 0, melody: 0.4, drop: 0.3, every: 1, wave: 'triangle', volume: 0.7 },
  },
  {
    id: 'neru',
    label: '寝言',
    note: 'とても低くて遅い。半分寝ているような、だるい声。',
    p: { kind: 'murmur', pitch: 92, speed: 155, bright: 1100, mouth: 0.85, breath: 0.5, wobble: 0.45, melody: 0.2, drop: 0.8, every: 1, wave: 'sawtooth', volume: 0.9 },
  },
];

const KINDS: [Kind, string][] = [
  ['murmur', 'もごもご'],
  ['hum', 'ハミング'],
  ['whisper', 'ささやき'],
  ['tone', 'ぽつぽつ'],
  ['blip', 'ころころ'],
];
const WAVES: [OscillatorType, string][] = [
  ['sawtooth', 'ざらっと'],
  ['triangle', 'まるい'],
  ['square', 'こもった箱'],
  ['sine', 'すんだ'],
];

// こすくまくんが実際に言うセリフ
const LINES = [
  'ちょっと貸して。',
  'これ、袋に入れて\n持って帰るやつ。',
  '……ずっと見てられる。',
  'これは、ぼくがもらうね。',
  '指のあと、ついてる。\n……ぼくのじゃないよ。',
  '……もう一回、\n入れるところからやる？',
  '棚から、上にすべらせて入れて。',
];

// 母音ごとの口の形（第1・第2フォルマント, Hz）
const FORMANT: Record<string, [number, number]> = {
  a: [720, 1150],
  i: [300, 1900],
  u: [340, 1150],
  e: [480, 1700],
  o: [480, 820],
  n: [260, 900],
};

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
let p: P = { ...PRESETS[0].p };
let presetId = 'mogo';

// ---------- 音 ----------
let ctx: AudioContext | null = null;
let master: GainNode;
let wet: GainNode;
let white: AudioBuffer;
let take: GainNode | null = null; // いまの1回ぶん（次を鳴らすときに消す）

function audio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  ctx = new AC();
  master = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp).connect(ctx.destination);
  // 小さな部屋の響き
  const verb = ctx.createConvolver();
  const len = Math.floor(ctx.sampleRate * 1.2);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  verb.buffer = ir;
  wet = ctx.createGain();
  wet.gain.value = 0.18;
  wet.connect(verb).connect(master);
  white = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const w = white.getChannelData(0);
  for (let i = 0; i < w.length; i++) w[i] = Math.random() * 2 - 1;
  // iOS：無音を1回鳴らして起こす
  const s = ctx.createBufferSource();
  s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  s.connect(ctx.destination);
  s.start();
  return ctx;
}

function newTake() {
  const c = audio();
  if (take) {
    const old = take;
    old.gain.setTargetAtTime(0, c.currentTime, 0.03);
    setTimeout(() => old.disconnect(), 400);
  }
  take = c.createGain();
  take.gain.value = 1;
  take.connect(master);
  take.connect(wet);
  master.gain.value = p.volume;
  return take;
}

// 文字ごとの高さの揺れ（同じ字は同じ高さ）
function pitchOf(ch: string, i: number) {
  const k = ((ch.charCodeAt(0) * 7 + i * 3) % 7) - 3;
  return p.pitch * Math.pow(2, (k * p.melody) / 12);
}

function noise(c: AudioContext, t: number, dur: number) {
  const s = c.createBufferSource();
  s.buffer = white;
  s.loop = true;
  s.start(t, Math.random() * 1.5);
  s.stop(t + dur + 0.4);
  return s;
}

// ひと息（読点まで）ぶんを、ひとつながりで鳴らす声
function phrase(out: GainNode, t: number, chars: string[], end: boolean, ask: boolean) {
  const c = ctx!;
  const vs = chars.map(vowelOf).filter((x): x is string => !!x);
  if (!vs.length) return;
  const step = p.speed / 1000;
  const len = vs.length * step;
  const endF = ask ? 1.22 : 1 - 0.28 * p.drop;
  const env = c.createGain();
  env.gain.setValueAtTime(0, t);
  const post = c.createBiquadFilter();
  post.type = 'lowpass';
  post.frequency.value = p.bright;
  env.connect(post).connect(out);
  const srcF = (src: AudioParam) => {
    for (let i = 0; i < vs.length; i++) src.setTargetAtTime(pitchOf(chars[i] ?? 'a', i), t + i * step, 0.03);
    if (end) src.setTargetAtTime(p.pitch * endF, t + len - step * 0.8, 0.08);
  };
  const stops: AudioScheduledSourceNode[] = [];
  if (p.kind === 'murmur' || p.kind === 'whisper') {
    const pre = c.createBiquadFilter();
    pre.type = 'lowpass';
    pre.frequency.value = p.kind === 'whisper' ? 6000 : Math.max(500, p.bright * 0.9);
    const f1 = c.createBiquadFilter();
    const f2 = c.createBiquadFilter();
    f1.type = f2.type = 'bandpass';
    f1.Q.value = p.kind === 'whisper' ? 7 : 5;
    f2.Q.value = p.kind === 'whisper' ? 9 : 7;
    const g1 = c.createGain();
    const g2 = c.createGain();
    g1.gain.value = 1;
    g2.gain.value = p.kind === 'whisper' ? 0.7 : 0.35;
    pre.connect(f1).connect(g1).connect(env);
    pre.connect(f2).connect(g2).connect(env);
    if (p.kind === 'murmur') {
      const body = c.createGain();
      body.gain.value = 0.22;
      pre.connect(body).connect(env);
      const o = c.createOscillator();
      o.type = p.wave;
      o.frequency.setValueAtTime(p.pitch * 1.04, t);
      srcF(o.frequency);
      const vib = c.createOscillator();
      vib.frequency.value = 5.2;
      const vg = c.createGain();
      vg.gain.value = p.wobble * 5;
      vib.connect(vg).connect(o.frequency);
      o.connect(pre);
      stops.push(o, vib);
    } else {
      const n = noise(c, t, len);
      const ng = c.createGain();
      ng.gain.value = 1.6;
      n.connect(ng).connect(pre);
    }
    for (let i = 0; i < vs.length; i++) {
      const ti = t + i * step;
      const [a1, a2] = FORMANT[vs[i]] ?? FORMANT.n;
      f1.frequency.setTargetAtTime(a1 * p.mouth, ti, 0.025);
      f2.frequency.setTargetAtTime(a2 * p.mouth, ti, 0.03);
    }
  } else {
    // ハミング：口を閉じた「んー」
    const o = c.createOscillator();
    o.type = p.wave;
    o.frequency.setValueAtTime(p.pitch, t);
    srcF(o.frequency);
    const vib = c.createOscillator();
    vib.frequency.value = 4.6;
    const vg = c.createGain();
    vg.gain.value = p.wobble * 4;
    vib.connect(vg).connect(o.frequency);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.max(250, p.bright * 0.5 * p.mouth);
    lp.Q.value = 1.5;
    o.connect(lp).connect(env);
    stops.push(o, vib);
  }
  // 音節ごとに少し開いて閉じる
  const base = p.kind === 'whisper' ? 0.5 : p.kind === 'hum' ? 0.5 : 0.4;
  for (let i = 0; i < vs.length; i++) {
    const ti = t + i * step;
    const pk = (vs[i] === 'n' ? 0.7 : 1) * base;
    env.gain.setTargetAtTime(pk, ti, 0.018);
    env.gain.setTargetAtTime(pk * (p.kind === 'hum' ? 0.6 : 0.45), ti + step * 0.6, 0.03);
  }
  env.gain.setTargetAtTime(0.0001, t + len, end ? 0.07 : 0.04);
  for (const s of stops) {
    s.start(t);
    s.stop(t + len + 0.5);
  }
  if (p.breath > 0 && p.kind !== 'whisper') {
    const n = noise(c, t, len);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900 * p.mouth;
    bp.Q.value = 0.6;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(p.breath * 0.05, t + 0.05);
    g.gain.setTargetAtTime(0, t + len, 0.05);
    n.connect(bp).connect(g).connect(out);
  }
}

// 1文字ずつの声
function syllable(out: GainNode, t: number, ch: string, i: number, last: boolean, ask: boolean) {
  const c = ctx!;
  const v = vowelOf(ch);
  if (!v) return;
  let f = pitchOf(ch, i);
  if (last) f = p.pitch * (ask ? 1.19 : 1 - 0.2 * p.drop);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = p.bright;
  const env = c.createGain();
  lp.connect(env).connect(out);
  if (p.kind === 'tone') {
    const dur = last ? 0.42 : Math.max(0.16, (p.speed / 1000) * 1.8);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.32, t + 0.025);
    env.gain.setTargetAtTime(0.0001, t + 0.04, dur * 0.32);
    for (const [m, a] of [
      [1, 1],
      [2, 0.22],
      [3, 0.06],
    ] as const) {
      const o = c.createOscillator();
      o.type = m === 1 ? p.wave : 'sine';
      o.frequency.setValueAtTime(f * m, t);
      o.frequency.exponentialRampToValueAtTime(f * m * (last && ask ? 1.06 : 0.975), t + dur);
      const g = c.createGain();
      g.gain.value = a;
      o.connect(g).connect(lp);
      o.start(t);
      o.stop(t + dur + 0.3);
    }
  } else {
    // ころころ：短く跳ねる音に、母音の色を少しだけ
    const dur = last ? 0.2 : 0.1;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.4, t + 0.005);
    env.gain.setTargetAtTime(0.0001, t + 0.01, dur * 0.35);
    const o = c.createOscillator();
    o.type = p.wave;
    o.frequency.setValueAtTime(f * 1.08, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.03);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = (FORMANT[v] ?? FORMANT.n)[1] * p.mouth;
    bp.Q.value = 3;
    const dry = c.createGain();
    dry.gain.value = 0.6;
    o.connect(bp).connect(lp);
    o.connect(dry).connect(lp);
    o.start(t);
    o.stop(t + dur + 0.2);
  }
  if (p.breath > 0) {
    const n = noise(c, t, 0.08);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 800;
    bp.Q.value = 0.6;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(p.breath * 0.03, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    n.connect(bp).connect(g).connect(out);
  }
}

// ---------- しゃべらせる（文字を出しながら） ----------
const BREAK = /[、。！？\n…]/;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let token = 0;
async function speak(text: string) {
  const my = ++token;
  const out = newTake();
  const el = $('#out');
  const chars = [...text];
  const ask = /[？?]\s*$/.test(text);
  const phraseKind = p.kind === 'murmur' || p.kind === 'hum' || p.kind === 'whisper';
  const lastVoiced = chars.map((c, i) => (vowelOf(c) ? i : -1)).filter((i) => i >= 0).pop() ?? -1;
  let shown = '';
  for (let i = 0; i < chars.length; i++) {
    if (my !== token) return;
    const c = chars[i];
    const t = ctx!.currentTime + 0.01;
    if (phraseKind && !BREAK.test(c) && (i === 0 || BREAK.test(chars[i - 1]))) {
      let j = i;
      while (j < chars.length && !BREAK.test(chars[j])) j++;
      const end = !chars.slice(j).some((x) => !BREAK.test(x) && x !== ' ');
      phrase(out, t, chars.slice(i, j), end, ask);
    }
    if (!phraseKind && (i % p.every === 0 || i === lastVoiced)) syllable(out, t, c, i, i === lastVoiced, ask);
    shown += c;
    el.textContent = shown;
    if (c === '…') {
      await wait(150);
      continue;
    }
    if (BREAK.test(c)) {
      await wait(c === '、' || c === '\n' ? 220 : 280);
      continue;
    }
    await wait(vowelOf(c) ? p.speed : 60);
  }
}

// ---------- 画面 ----------
let current = LINES[1];
function say() {
  const typed = $<HTMLInputElement>('#text').value.trim();
  speak(typed || current);
}

function renderPresets() {
  $('#presets').innerHTML = PRESETS.map(
    (x) => `<button type="button" role="radio" data-id="${x.id}" aria-checked="${x.id === presetId}">${x.label}</button>`,
  ).join('');
  const pr = PRESETS.find((x) => x.id === presetId);
  $('#preset-note').textContent = pr ? pr.note : '自分で調整した声。';
}

interface Knob {
  key: keyof P;
  label: string;
  min: number;
  max: number;
  step: number;
  left: string;
  right: string;
  fmt: (v: number) => string;
  show?: (q: P) => boolean;
}
const KNOBS: Knob[] = [
  { key: 'pitch', label: '高さ', min: 70, max: 360, step: 1, left: '低い', right: '高い', fmt: (v) => `${Math.round(v)} Hz` },
  { key: 'speed', label: '速さ', min: 60, max: 220, step: 5, left: '速い', right: 'ゆっくり', fmt: (v) => `1文字 ${v} ms` },
  { key: 'bright', label: 'こもり', min: 400, max: 5000, step: 50, left: 'こもる', right: 'はっきり', fmt: (v) => `${v} Hz まで` },
  { key: 'mouth', label: '口の開き', min: 0.7, max: 1.4, step: 0.01, left: '小さい口', right: '大きい口', fmt: (v) => `× ${v.toFixed(2)}` },
  { key: 'melody', label: '抑揚', min: 0, max: 1, step: 0.01, left: '平ら', right: 'うたう', fmt: (v) => `${Math.round(v * 100)}` },
  { key: 'drop', label: '語尾', min: 0, max: 1, step: 0.01, left: 'そのまま', right: '下がる', fmt: (v) => `${Math.round(v * 100)}` },
  { key: 'wobble', label: 'ゆれ', min: 0, max: 1, step: 0.01, left: 'まっすぐ', right: 'ふるえる', fmt: (v) => `${Math.round(v * 100)}`, show: (q) => q.kind === 'murmur' || q.kind === 'hum' },
  { key: 'breath', label: '息', min: 0, max: 1, step: 0.01, left: 'なし', right: '多い', fmt: (v) => `${Math.round(v * 100)}`, show: (q) => q.kind !== 'whisper' },
  { key: 'volume', label: '音量', min: 0.2, max: 1.4, step: 0.01, left: '小さい', right: '大きい', fmt: (v) => `${Math.round(v * 100)}` },
];

function renderKnobs() {
  const segs = (key: string, opts: [string, string][], val: string, show = true) =>
    show
      ? `<div class="knob"><p class="k-label">${{ kind: '声の出し方', wave: '音の芯', every: '鳴らす間隔' }[key]}</p><div class="seg" data-seg="${key}">${opts
          .map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${v === val}">${l}</button>`)
          .join('')}</div></div>`
      : '';
  const sliders = KNOBS.filter((k) => !k.show || k.show(p))
    .map(
      (k) =>
        `<label class="knob"><span class="k-label">${k.label}<em data-val="${k.key}">${k.fmt(p[k.key] as number)}</em></span><input type="range" data-key="${k.key}" min="${k.min}" max="${k.max}" step="${k.step}" value="${p[k.key]}" /><span class="k-ends"><i>${k.left}</i><i>${k.right}</i></span></label>`,
    )
    .join('');
  $('#knobs').innerHTML =
    segs('kind', KINDS, p.kind) +
    segs('wave', WAVES, p.wave, p.kind !== 'whisper') +
    segs('every', [['1', '1文字ずつ'], ['2', '2文字に1回']], String(p.every), p.kind === 'tone' || p.kind === 'blip') +
    sliders;
}

function renderCode() {
  const pr = PRESETS.find((x) => x.id === presetId);
  const round = (v: unknown) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);
  const q = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, round(v)]));
  $('#code').textContent = `こすくまくんの声：${pr ? pr.label : '調整した声'}\n${JSON.stringify(q)}`;
  history.replaceState(null, '', '#' + encodeURIComponent(JSON.stringify({ id: presetId, p: q })));
}

function changed() {
  presetId = 'custom';
  renderPresets();
  renderCode();
}

function boot() {
  try {
    const h = decodeURIComponent(location.hash.slice(1));
    if (h) {
      const d = JSON.parse(h) as { id: string; p: P };
      p = { ...PRESETS[0].p, ...d.p };
      presetId = d.id;
    }
  } catch {
    /* 壊れたURLは無視 */
  }
  $('#lines').innerHTML = LINES.map((l, i) => `<button type="button" data-i="${i}" aria-pressed="${l === current}">${l.replace('\n', '')}</button>`).join('');
  renderPresets();
  renderKnobs();
  renderCode();

  $('#play').addEventListener('click', say);
  $('#lines').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    current = LINES[+b.dataset.i!];
    $<HTMLInputElement>('#text').value = '';
    document.querySelectorAll('#lines button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    say();
  });
  $<HTMLInputElement>('#text').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
      say();
    }
  });
  $('#presets').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    const pr = PRESETS.find((x) => x.id === b.dataset.id)!;
    presetId = pr.id;
    p = { ...pr.p };
    renderPresets();
    renderKnobs();
    renderCode();
    say();
  });
  $('#knobs').addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    const key = el.dataset.key as keyof P | undefined;
    if (!key) return;
    (p as unknown as Record<string, number>)[key] = +el.value;
    const k = KNOBS.find((x) => x.key === key)!;
    $(`[data-val="${key}"]`).textContent = k.fmt(+el.value);
    changed();
  });
  // つまみを離したら、その声で一言
  $('#knobs').addEventListener('change', (e) => {
    if ((e.target as HTMLElement).dataset.key) say();
  });
  $('#knobs').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('.seg button') as HTMLElement | null;
    if (!b) return;
    const key = (b.parentElement as HTMLElement).dataset.seg!;
    const v = b.dataset.v!;
    if (key === 'kind') p.kind = v as Kind;
    if (key === 'wave') p.wave = v as OscillatorType;
    if (key === 'every') p.every = v === '2' ? 2 : 1;
    renderKnobs();
    changed();
    say();
  });
  $('#copy').addEventListener('click', async () => {
    const btn = $('#copy');
    try {
      await navigator.clipboard.writeText($('#code').textContent || '');
      btn.textContent = 'コピーしました';
    } catch {
      // コピーできない端末では、文字を選べるようにする
      const r = document.createRange();
      r.selectNodeContents($('#code'));
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(r);
      btn.textContent = '下の文字を長押しでコピー';
    }
    setTimeout(() => (btn.textContent = 'この声の設定をコピー'), 2200);
  });
}
boot();
