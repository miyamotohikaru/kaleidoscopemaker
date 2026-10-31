// 描画の流れ：
//   ビーズ → beadRT（筒の座標）→ 溶液 → chamberRT → チャーム（色をいじらない）
//   → 窓 or 万華鏡（画面）→ 縁の色ずれ・残像 → にじみ光 → 画面
import * as THREE from 'three';
import { Kind } from './catalog';
import type { Body, Cell } from './sim';
import * as S from './shaders';

const MAX = 900;
const CH = 1536;

export interface ViewState {
  mode: number; // 0 窓 / 1 万華鏡
  iris: number;
  fade: number;
  ring: number;
  mirrors: number;
  R: number; // 円の半径（CSS px）
  cx: number;
  cy: number;
  edge: number;
  trail: number;
  bloom: number;
  back: number;
  tint: [number, number, number];
  span: number;
  wedge: number; // 鏡が向く方向（画面）
  guide: number;
}

function rt(w: number, h: number, type: THREE.TextureDataType, depth = false) {
  return new THREE.WebGLRenderTarget(w, h, {
    type,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: depth,
    generateMipmaps: false,
  });
}

class Post {
  scene: THREE.WebGLRenderTarget;
  hist: THREE.WebGLRenderTarget[];
  b1: THREE.WebGLRenderTarget;
  b2: THREE.WebGLRenderTarget;
  c1: THREE.WebGLRenderTarget;
  c2: THREE.WebGLRenderTarget;
  flip = 0;
  constructor(public w: number, public h: number, type: THREE.TextureDataType) {
    this.scene = rt(w, h, type, true);
    this.hist = [rt(w, h, type), rt(w, h, type)];
    const w4 = Math.max(1, w >> 2), h4 = Math.max(1, h >> 2);
    const w8 = Math.max(1, w >> 3), h8 = Math.max(1, h >> 3);
    this.b1 = rt(w4, h4, type);
    this.b2 = rt(w4, h4, type);
    this.c1 = rt(w8, h8, type);
    this.c2 = rt(w8, h8, type);
  }
  dispose() {
    [this.scene, ...this.hist, this.b1, this.b2, this.c1, this.c2].forEach((r) => r.dispose());
  }
}

export class Renderer {
  gl: THREE.WebGLRenderer;
  type: THREE.TextureDataType;
  beadRT: THREE.WebGLRenderTarget;
  chamberRT: THREE.WebGLRenderTarget;
  post!: Post;
  dpr = 1;
  cam = new THREE.Camera();
  quad: THREE.Mesh;
  quadScene = new THREE.Scene();
  beadScene = new THREE.Scene();
  charmScene = new THREE.Scene();
  beadGeo: THREE.InstancedBufferGeometry;
  charmGeo: THREE.InstancedBufferGeometry;
  iPos: THREE.InstancedBufferAttribute;
  iCol: THREE.InstancedBufferAttribute;
  iMisc: THREE.InstancedBufferAttribute;
  cPos: THREE.InstancedBufferAttribute;
  beadMat: THREE.ShaderMaterial;
  charmMat: THREE.ShaderMaterial;
  mats: Record<string, THREE.ShaderMaterial> = {};
  photoTex: THREE.Texture;
  photoRects: THREE.Vector4[] = Array.from({ length: 24 }, () => new THREE.Vector4(0, 0, 1, 1));
  time = 0;
  ready: Promise<void>;

  constructor(public canvas: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.gl.autoClear = false;
    const ext = this.gl.extensions;
    this.type = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float') ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.beadRT = rt(CH, CH, this.type);
    this.chamberRT = rt(CH, CH, this.type);

    const quadGeo = new THREE.PlaneGeometry(2, 2);
    this.quad = new THREE.Mesh(quadGeo);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    const mk = (frag: string, uniforms: Record<string, THREE.IUniform>, blend = false) =>
      new THREE.ShaderMaterial({
        vertexShader: S.quadVert,
        fragmentShader: frag,
        uniforms,
        depthTest: false,
        depthWrite: false,
        transparent: blend,
      });
    this.mats.back = mk(S.backFrag, { uBack: { value: 0.1 }, uTime: { value: 0 } });
    this.mats.liquid = mk(S.liquidFrag, {
      uBeads: { value: null },
      uTime: { value: 0 },
      uLevel: { value: 0 },
      uG: { value: new THREE.Vector2(0, -1) },
      uTint: { value: new THREE.Vector3(1, 1, 1) },
      uFilm: { value: 0 },
      uWobble: { value: 0 },
      uHasLiquid: { value: 0 },
      uNet: { value: 0 },
      uMurk: { value: 0 },
      uCloud: { value: 0 },
    });
    this.mats.view = mk(S.viewFrag, {
      uChamber: { value: null },
      uRes: { value: new THREE.Vector2() },
      uCenter: { value: new THREE.Vector2() },
      uR: { value: 100 },
      uMode: { value: 0 },
      uIris: { value: 1 },
      uMirrors: { value: 6 },
      uAngle: { value: 0 },
      uGAng: { value: -Math.PI / 2 },
      uTime: { value: 0 },
      uFade: { value: 1 },
      uSpan: { value: 1 },
      uRing: { value: 1 },
      uStretch: { value: 1 },
      uGuide: { value: 0 },
      uSmudge: { value: 0 },
      uSpill: { value: 0 },
    });
    this.mats.edge = mk(S.edgeFrag, {
      uScene: { value: null },
      uHist: { value: null },
      uRes: { value: new THREE.Vector2() },
      uCenter: { value: new THREE.Vector2() },
      uR: { value: 100 },
      uEdge: { value: 0 },
      uTrail: { value: 0 },
    });
    this.mats.bright = mk(S.brightFrag, { uTex: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.mats.blur = mk(S.blurFrag, { uTex: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.mats.final = mk(S.finalFrag, {
      uScene: { value: null },
      uBloomA: { value: null },
      uBloomB: { value: null },
      uBloom: { value: 1 },
      uTime: { value: 0 },
      uExposure: { value: 1 },
    });
    this.mats.tile = mk(S.tileFrag, { uTex: { value: null } });

    // ビーズ（インスタンス）
    const base = new THREE.PlaneGeometry(2, 2);
    this.beadGeo = new THREE.InstancedBufferGeometry();
    this.beadGeo.index = base.index;
    this.beadGeo.setAttribute('position', base.getAttribute('position'));
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.iCol = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.iMisc = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.beadGeo.setAttribute('iPos', this.iPos);
    this.beadGeo.setAttribute('iCol', this.iCol);
    this.beadGeo.setAttribute('iMisc', this.iMisc);
    this.photoTex = new THREE.Texture();
    this.beadMat = new THREE.ShaderMaterial({
      vertexShader: S.beadVert,
      fragmentShader: S.beadFrag,
      uniforms: {
        uTime: { value: 0 },
        uCellAngle: { value: 0 },
        uScale: { value: 1 },
        uOffset: { value: new THREE.Vector2() },
        uPhoto: { value: this.photoTex },
        uPhotoRect: { value: this.photoRects },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    const beadMesh = new THREE.Mesh(this.beadGeo, this.beadMat);
    beadMesh.frustumCulled = false;
    this.beadScene.add(beadMesh);

    this.charmGeo = new THREE.InstancedBufferGeometry();
    this.charmGeo.index = base.index;
    this.charmGeo.setAttribute('position', base.getAttribute('position'));
    this.cPos = new THREE.InstancedBufferAttribute(new Float32Array(16 * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.charmGeo.setAttribute('iPos', this.cPos);
    this.charmGeo.setAttribute('iCol', new THREE.InstancedBufferAttribute(new Float32Array(16 * 4).fill(7), 4));
    this.charmGeo.setAttribute('iMisc', new THREE.InstancedBufferAttribute(new Float32Array(16 * 4), 4));
    let done: () => void = () => {};
    this.ready = new Promise((res) => (done = res));
    const charmTex = new THREE.TextureLoader().load('/charm.png', () => done(), undefined, () => done());
    charmTex.colorSpace = THREE.SRGBColorSpace;
    this.charmMat = new THREE.ShaderMaterial({
      vertexShader: S.beadVert,
      fragmentShader: S.charmFrag,
      uniforms: { uTex: { value: charmTex }, uScale: { value: 1 }, uOffset: { value: new THREE.Vector2() } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    const charmMesh = new THREE.Mesh(this.charmGeo, this.charmMat);
    charmMesh.frustumCulled = false;
    this.charmScene.add(charmMesh);
  }

  resize(w: number, h: number, dpr: number) {
    this.dpr = dpr;
    this.gl.setPixelRatio(1);
    this.gl.setSize(Math.round(w * dpr), Math.round(h * dpr), false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.post?.dispose();
    this.post = new Post(Math.round(w * dpr), Math.round(h * dpr), this.type);
  }

  setPhoto(canvas: HTMLCanvasElement, rects: [number, number, number, number][]) {
    this.photoTex.dispose();
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    this.photoTex = t;
    this.beadMat.uniforms.uPhoto.value = t;
    rects.forEach((r, i) => this.photoRects[i]?.set(r[0], r[1], r[2], r[3]));
  }

  private pass(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) {
    this.quad.material = mat;
    this.gl.setRenderTarget(target);
    this.gl.render(this.quadScene, this.cam);
  }

  private fillBodies(bodies: Body[]) {
    let n = 0;
    let c = 0;
    const P = this.iPos.array as Float32Array;
    const C = this.iCol.array as Float32Array;
    const M = this.iMisc.array as Float32Array;
    const CP = this.cPos.array as Float32Array;
    // 大きいものを後ろに、ラメを前に
    for (const b of bodies) {
      if (b.kind === Kind.Charm) {
        if (c < 16) {
          CP.set([b.x, b.y, b.r, b.a], c * 4);
          c++;
        }
        continue;
      }
      if (n >= MAX) break;
      P.set([b.x, b.y, b.r, b.a], n * 4);
      C.set([b.rgb[0], b.rgb[1], b.rgb[2], b.kind], n * 4);
      M.set([b.seed, Math.max(0, b.photo), b.born, 0], n * 4);
      n++;
    }
    this.iPos.needsUpdate = this.iCol.needsUpdate = this.iMisc.needsUpdate = true;
    this.cPos.needsUpdate = true;
    this.beadGeo.instanceCount = n;
    this.charmGeo.instanceCount = c;
  }

  // 筒の中を chamberRT に描く
  drawChamber(cell: Cell, v: ViewState, liquid: { film: number; wobble: number } | null) {
    const gl = this.gl;
    this.fillBodies(cell.bodies);
    this.mats.back.uniforms.uBack.value = v.back;
    this.mats.back.uniforms.uTime.value = this.time;
    gl.setRenderTarget(this.beadRT);
    this.quad.material = this.mats.back;
    gl.render(this.quadScene, this.cam);
    this.beadMat.uniforms.uTime.value = this.time;
    this.beadMat.uniforms.uCellAngle.value = cell.angle;
    this.beadMat.uniforms.uScale.value = 1;
    (this.beadMat.uniforms.uOffset.value as THREE.Vector2).set(0, 0);
    gl.render(this.beadScene, this.cam);

    const L = this.mats.liquid.uniforms;
    L.uBeads.value = this.beadRT.texture;
    L.uTime.value = this.time;
    L.uLevel.value = cell.flat ? (cell.level > 0.02 ? 1 : 0) : cell.level;
    const g = cell.gdir - cell.angle;
    (L.uG.value as THREE.Vector2).set(Math.cos(g), Math.sin(g));
    (L.uTint.value as THREE.Vector3).set(...v.tint);
    L.uFilm.value = liquid?.film ?? 0;
    L.uWobble.value = liquid?.wobble ?? 0;
    L.uHasLiquid.value = cell.liquid ? 1 : 0;
    L.uNet.value = v.mode;
    L.uMurk.value = cell.murk;
    L.uCloud.value = cell.cloud;
    this.pass(this.mats.liquid, this.chamberRT);
    gl.setRenderTarget(this.chamberRT);
    gl.render(this.charmScene, this.cam);
  }

  // 画面へ
  present(cell: Cell, v: ViewState, post: Post = this.post, target: THREE.WebGLRenderTarget | null = null, scale = this.dpr) {
    const W = post.w;
    const H = post.h;
    const V = this.mats.view.uniforms;
    V.uChamber.value = this.chamberRT.texture;
    (V.uRes.value as THREE.Vector2).set(W, H);
    (V.uCenter.value as THREE.Vector2).set(v.cx * scale, H - v.cy * scale);
    V.uR.value = v.R * scale;
    V.uMode.value = v.mode;
    V.uIris.value = v.iris;
    V.uMirrors.value = v.mirrors;
    V.uAngle.value = cell.angle;
    V.uGAng.value = v.wedge;
    V.uTime.value = this.time;
    V.uFade.value = v.fade;
    V.uSpan.value = v.span;
    V.uRing.value = v.ring;
    V.uGuide.value = v.guide;
    V.uSmudge.value = cell.smudge;
    V.uSpill.value = Math.min(1, cell.spill * 2.5);
    V.uStretch.value = Math.min(1.9, 0.8 / (Math.PI / v.mirrors));
    this.pass(this.mats.view, post.scene);
    this.postChain(v, post, target, scale);
  }

  // 満たす：立体の筒を描いてから、同じ仕上げを通す
  present3d(v: ViewState, scene: THREE.Scene, cam: THREE.Camera) {
    const post = this.post;
    this.gl.setRenderTarget(post.scene);
    this.gl.clear(true, true, false);
    this.gl.render(scene, cam);
    this.postChain(v, post, null, this.dpr);
  }

  private postChain(v: ViewState, post: Post, target: THREE.WebGLRenderTarget | null, scale: number) {
    const W = post.w;
    const H = post.h;
    const E = this.mats.edge.uniforms;
    const src = post.hist[post.flip];
    const dst = post.hist[1 - post.flip];
    E.uScene.value = post.scene.texture;
    E.uHist.value = src.texture;
    (E.uRes.value as THREE.Vector2).set(W, H);
    (E.uCenter.value as THREE.Vector2).set(v.cx * scale, H - v.cy * scale);
    E.uR.value = v.R * scale;
    E.uEdge.value = v.edge;
    E.uTrail.value = v.trail;
    this.pass(this.mats.edge, dst);
    post.flip = 1 - post.flip;

    const B = this.mats.bright.uniforms;
    B.uTex.value = dst.texture;
    (B.uTexel.value as THREE.Vector2).set(1 / W, 1 / H);
    this.pass(this.mats.bright, post.b1);
    const blur = (a: THREE.WebGLRenderTarget, b: THREE.WebGLRenderTarget) => {
      const U = this.mats.blur.uniforms;
      U.uTex.value = a.texture;
      (U.uDir.value as THREE.Vector2).set(1 / a.width, 0);
      this.pass(this.mats.blur, b);
      U.uTex.value = b.texture;
      (U.uDir.value as THREE.Vector2).set(0, 1 / a.height);
      this.pass(this.mats.blur, a);
    };
    blur(post.b1, post.b2);
    // 2段目はしきい値なしで縮める
    this.mats.blur.uniforms.uTex.value = post.b1.texture;
    (this.mats.blur.uniforms.uDir.value as THREE.Vector2).set(0, 0);
    this.pass(this.mats.blur, post.c1);
    blur(post.c1, post.c2);
    blur(post.c1, post.c2);

    const F = this.mats.final.uniforms;
    F.uScene.value = dst.texture;
    F.uBloomA.value = post.b1.texture;
    F.uBloomB.value = post.c1.texture;
    F.uBloom.value = v.bloom;
    F.uTime.value = this.time;
    this.pass(this.mats.final, target);
  }

  // 万華鏡を正方形の画像にする（鑑定書・共有用）
  snapshot(cell: Cell, v: ViewState, size = 1024): HTMLCanvasElement {
    const post = new Post(size, size, this.type);
    const out = rt(size, size, THREE.UnsignedByteType);
    const vv = { ...v, cx: size / 2, cy: size / 2, R: (size / 2) * 1.0, iris: 1.2, fade: 1, edge: v.edge, trail: 0 };
    this.present(cell, vv, post, out, 1);
    const px = new Uint8Array(size * size * 4);
    this.gl.readRenderTargetPixels(out, 0, 0, size, size, px);
    post.dispose();
    out.dispose();
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      const s = (size - 1 - y) * size * 4;
      img.data.set(px.subarray(s, s + size * 4), y * size * 4);
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  // 棚の見本を描いて画像にする（frame = 写す範囲の半径）
  tile(bodies: Body[], frame: number, size = 160): string {
    const tmp = rt(size, size, this.type);
    const out = rt(size, size, THREE.UnsignedByteType);
    const gl = this.gl;
    this.fillBodies(bodies);
    gl.setRenderTarget(tmp);
    gl.setClearColor(0x000000, 0);
    gl.clear();
    for (const mat of [this.beadMat, this.charmMat]) mat.uniforms.uScale.value = 1 / frame;
    this.beadMat.uniforms.uCellAngle.value = 0;
    gl.render(this.beadScene, this.cam);
    gl.render(this.charmScene, this.cam);
    for (const mat of [this.beadMat, this.charmMat]) mat.uniforms.uScale.value = 1;
    this.mats.tile.uniforms.uTex.value = tmp.texture;
    gl.setRenderTarget(out);
    gl.clear();
    this.quad.material = this.mats.tile;
    gl.render(this.quadScene, this.cam);
    const px = new Uint8Array(size * size * 4);
    gl.readRenderTargetPixels(out, 0, 0, size, size, px);
    tmp.dispose();
    out.dispose();
    gl.setClearColor(0x000000, 1);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      const s = (size - 1 - y) * size * 4;
      img.data.set(px.subarray(s, s + size * 4), y * size * 4);
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  }

  clearScreen() {
    this.gl.setRenderTarget(null);
    this.gl.clear();
  }
}
