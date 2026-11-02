// 満たす：筒（オブジェクトセル）を立体で見せ、瓶から液を注ぐ。
// 真上から見ると「入れる」の窓と同じ見え方になるようにカメラを合わせ、そこから斜めに倒す。
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const H = 0.34; // 筒の深さ
const LIQ: Record<string, { col: [number, number, number]; a: number; r: number }> = {
  water: { col: [0.55, 0.78, 1.0], a: 0.3, r: 0.016 },
  oil: { col: [1.0, 0.82, 0.42], a: 0.3, r: 0.024 },
  honey: { col: [1.0, 0.55, 0.12], a: 0.62, r: 0.045 },
};

const glassVert = /* glsl */ `
varying vec3 vN; varying vec3 vV; varying vec3 vP; varying vec2 vUv;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.);
  vP = wp.xyz; vUv = uv;
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

export interface PourState {
  tilt: number; // 0 = 真上, 1 = 斜め
  level: number;
  liquid: string | null;
  cellCol: [number, number, number]; // 筒の中で混ざった色
  bottleCol: [number, number, number]; // 瓶の中の色
  pouring: boolean;
  spill: number; // あふれた量 0..2
  pourX: number;
  time: number;
  W: number;
  Hh: number;
  R: number;
  cx: number;
  cy: number;
}

export class Pour3D {
  scene = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(30, 1, 0.05, 60);
  disc: THREE.Mesh;
  liqSide: THREE.Mesh;
  liqTop: THREE.Mesh;
  bottle = new THREE.Group();
  bottleLiq: THREE.Mesh;
  stream: THREE.Mesh;
  waterline: THREE.Mesh;
  wall: THREE.Mesh;
  puddle: THREE.Mesh;
  spillVis = 0;
  pourAmt = 0;
  bottleIn = 0;
  bx = 0;
  mats: Record<string, THREE.ShaderMaterial> = {};

  constructor(gl: THREE.WebGLRenderer, chamber: THREE.Texture) {
    const pm = new THREE.PMREMGenerator(gl);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();

    // 床：ベルベット
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.ShaderMaterial({
        vertexShader: glassVert,
        fragmentShader: /* glsl */ `
        varying vec3 vP;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        void main(){
          float r = length(vP.xz);
          float fib = h(floor(vP.xz*220.)) * .5 + .5;
          vec3 c = vec3(.016,.012,.016) * (.7 + .5*fib);
          c *= .45 + .55*smoothstep(1.02, 1.9, r);
          gl_FragColor = vec4(c, 1.);
        }`,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.002;
    this.scene.add(floor);

    // 底のガラス（中身は 2D で描いた筒の絵）
    this.mats.disc = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: chamber } },
      vertexShader: glassVert,
      fragmentShader: /* glsl */ `
      uniform sampler2D uTex; varying vec2 vUv;
      void main(){ gl_FragColor = vec4(texture2D(uTex, vUv).rgb, 1.); }`,
    });
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(1, 128), this.mats.disc);
    this.disc.rotation.x = -Math.PI / 2;
    this.scene.add(this.disc);

    // 真鍮の筒
    const brass = new THREE.MeshStandardMaterial({ color: 0xa8803f, metalness: 1, roughness: 0.2, side: THREE.DoubleSide });
    const outer = new THREE.Mesh(new THREE.CylinderGeometry(1.075, 1.075, H, 160, 1, true), brass);
    outer.position.y = H / 2;
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, H, 160, 1, true), brass);
    inner.position.y = H / 2;
    const top = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.075, 160), brass);
    top.rotation.x = -Math.PI / 2;
    top.position.y = H;
    const lip = new THREE.Mesh(new THREE.TorusGeometry(1.0375, 0.012, 12, 160), brass);
    lip.rotation.x = Math.PI / 2;
    lip.position.y = H + 0.004;
    this.scene.add(outer, inner, top, lip);

    // 液
    this.mats.liqSide = new THREE.ShaderMaterial({
      uniforms: { uCol: { value: new THREE.Vector3() }, uA: { value: 0.2 } },
      vertexShader: glassVert,
      fragmentShader: /* glsl */ `
      uniform vec3 uCol; uniform float uA; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(1.-abs(dot(vN,vV)), 2.); gl_FragColor = vec4(uCol*(.25+f), uA*(.4+f)); }`,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
    });
    this.liqSide = new THREE.Mesh(new THREE.CylinderGeometry(0.998, 0.998, 1, 128, 1, true), this.mats.liqSide);
    this.mats.liqTop = new THREE.ShaderMaterial({
      uniforms: {
        uCol: { value: new THREE.Vector3() },
        uA: { value: 0.2 },
        uTime: { value: 0 },
        uHit: { value: new THREE.Vector2() },
        uPour: { value: 0 },
      },
      vertexShader: glassVert,
      fragmentShader: /* glsl */ `
      uniform vec3 uCol; uniform float uA; uniform float uTime; uniform vec2 uHit; uniform float uPour;
      varying vec3 vP; varying vec3 vV;
      void main(){
        vec2 p = vP.xz;
        float d = length(p - uHit);
        float rip = sin(d*70. - uTime*14.) * exp(-d*5.) * uPour;
        vec3 n = normalize(vec3(rip*.25*(p.x-uHit.x)/(d+.01), 1., rip*.25*(p.y-uHit.y)/(d+.01)));
        float f = pow(1.-max(dot(n, vV), 0.), 4.);
        // 天井の明かりの映り込み（細長い窓）
        vec3 R = reflect(-vV, n);
        float win = smoothstep(.96, .995, R.y) * smoothstep(.5, .2, abs(R.x));
        float th = sin(p.x*3.1 + uTime*.2) * .5 + sin(p.y*2.3 - uTime*.17) * .5;
        vec3 irid = .5 + .5*cos(6.2831*(th*.8 + vec3(0.,.33,.67)));
        // 液の色がはっきり分かるように、面そのものを少し色づける
        vec3 c = uCol*.3 + irid*.05 + vec3(1.,.95,.88)*(win*.9 + f*.35) + vec3(1.)*max(rip,0.)*.25;
        float edge = smoothstep(.93, .998, length(p));
        gl_FragColor = vec4(c + uCol*edge*.6, uA*.8 + win*.4 + f*.3 + edge*.45);
      }`,
      transparent: true,
      depthWrite: false,
    });
    this.liqTop = new THREE.Mesh(new THREE.CircleGeometry(0.998, 128), this.mats.liqTop);
    this.liqTop.rotation.x = -Math.PI / 2;
    // 水面の線：筒の内側の壁に、液の高さを細い光る線で見せる（どこまで入ったか分かるように）
    this.waterline = new THREE.Mesh(
      new THREE.TorusGeometry(0.996, 0.007, 8, 180),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false }),
    );
    this.waterline.rotation.x = Math.PI / 2;
    this.waterline.renderOrder = 4;
    this.scene.add(this.liqSide, this.liqTop, this.waterline);

    // 瓶：首の口を原点にして傾ける
    const prof = [
      [0.0, -0.78],
      [0.2, -0.78],
      [0.235, -0.74],
      [0.24, -0.5],
      [0.2, -0.36],
      [0.09, -0.22],
      [0.07, -0.12],
      [0.07, -0.03],
      [0.085, -0.01],
      [0.08, 0.0],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    this.mats.glass = new THREE.ShaderMaterial({
      vertexShader: glassVert,
      fragmentShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV;
      void main(){
        float f = pow(1.-abs(dot(vN,vV)), 2.5);
        float streak = smoothstep(.92, 1., abs(dot(vN, normalize(vec3(-.6,.2,.8)))));
        gl_FragColor = vec4(vec3(.85,.92,1.)*(f*.9 + streak*.8), .06 + f*.5 + streak*.4);
      }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const glass = new THREE.Mesh(new THREE.LatheGeometry(prof, 64), this.mats.glass);
    this.mats.bottleLiq = new THREE.ShaderMaterial({
      uniforms: { uCol: { value: new THREE.Vector3() }, uA: { value: 0.5 } },
      vertexShader: glassVert,
      fragmentShader: /* glsl */ `
      uniform vec3 uCol; uniform float uA; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(1.-abs(dot(vN,vV)), 1.5); gl_FragColor = vec4(uCol*(.9 + f*1.2), uA*.7 + .12); }`,
      transparent: true,
      depthWrite: false,
    });
    const lprof = prof.slice(0, 5).map((v) => new THREE.Vector2(Math.max(0, v.x - 0.015), v.y + 0.01));
    this.bottleLiq = new THREE.Mesh(new THREE.LatheGeometry(lprof, 48), this.mats.bottleLiq);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.088, 0.05, 48), brass);
    collar.position.y = -0.06;
    this.bottle.add(this.bottleLiq, glass, collar);
    this.bottle.renderOrder = 3;
    this.scene.add(this.bottle);

    // 流れ
    this.mats.stream = new THREE.ShaderMaterial({
      uniforms: { uCol: { value: new THREE.Vector3() }, uTime: { value: 0 }, uA: { value: 0.5 } },
      vertexShader: /* glsl */ `
      uniform float uTime; varying vec3 vN; varying vec3 vV; varying float vY;
      void main(){
        vec3 p = position;
        vY = uv.y;
        p.x += sin(uv.y*18. - uTime*20.) * .012 * (1.-uv.y);
        vec4 wp = modelMatrix * vec4(p, 1.);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
      fragmentShader: /* glsl */ `
      uniform vec3 uCol; uniform float uA; varying vec3 vN; varying vec3 vV; varying float vY;
      void main(){
        float f = pow(1.-abs(dot(vN,vV)), 2.);
        float hl = smoothstep(.75, .95, dot(vN, normalize(vec3(-.7,0.,.7))));
        gl_FragColor = vec4(uCol*(.5+f) + vec3(1.)*hl*.9, min(1., uA + .35 + f*.4 + hl));
      }`,
      transparent: true,
      depthWrite: false,
    });
    this.stream = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 16, 24, true), this.mats.stream);
    this.stream.renderOrder = 2;
    this.scene.add(this.stream);

    // あふれ：外の壁を伝う膜（縦の筋）と、床に広がる水たまり
    this.mats.wall = new THREE.ShaderMaterial({
      uniforms: { uCol: { value: new THREE.Vector3() }, uA: { value: 0 }, uAmt: { value: 0 }, uTime: { value: 0 } },
      vertexShader: glassVert,
      fragmentShader: /* glsl */ `
      uniform vec3 uCol; uniform float uA; uniform float uAmt; uniform float uTime;
      varying vec3 vN; varying vec3 vV; varying vec2 vUv;
      float h(float x){ return fract(sin(x*127.1)*43758.5453); }
      void main(){
        float k = floor(vUv.x*90.);
        float len = h(k) * uAmt * 1.4;
        float run = step(1. - vUv.y, len) * smoothstep(.3, .7, h(k + 7.));
        float sheet = smoothstep(.0, .25, uAmt) * smoothstep(.75, 1., vUv.y);
        float m = max(run, sheet);
        float f = pow(1.-abs(dot(vN,vV)), 2.);
        float hl = smoothstep(.85, .98, abs(dot(vN, normalize(vec3(-.6,.3,.75)))));
        gl_FragColor = vec4(uCol*(.35+f) + vec3(1.)*hl*.7, m * (uA*.8 + .25 + hl*.5));
      }`,
      transparent: true,
      depthWrite: false,
    });
    this.wall = new THREE.Mesh(new THREE.CylinderGeometry(1.082, 1.082, H, 160, 1, true), this.mats.wall);
    this.wall.position.y = H / 2;
    this.mats.puddle = new THREE.ShaderMaterial({
      uniforms: { uCol: { value: new THREE.Vector3() }, uA: { value: 0 }, uR: { value: 1 }, uTime: { value: 0 } },
      vertexShader: glassVert,
      fragmentShader: /* glsl */ `
      uniform vec3 uCol; uniform float uA; uniform float uR; uniform float uTime;
      varying vec3 vP; varying vec3 vV;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      void main(){
        vec2 p = vP.xz;
        if(length(p) < 1.07) discard; // 筒の下（底のガラス）には描かない
        float a = atan(p.y, p.x);
        float edge = uR * (1. + .07*n(vec2(a*3., 1.)) + .04*n(vec2(a*9., 4.)));
        float in1 = smoothstep(edge, edge - .02, length(p));
        vec3 R = reflect(-vV, vec3(0.,1.,0.));
        float win = smoothstep(.96, .995, R.y) * smoothstep(.5, .2, abs(R.x));
        float rim = smoothstep(edge - .06, edge - .01, length(p)) * in1;
        gl_FragColor = vec4(uCol*.1 + vec3(1.,.95,.88)*(win*.8 + rim*.45), in1 * (uA*.35 + .07 + win*.4 + rim*.35));
      }`,
      transparent: true,
      depthWrite: false,
    });
    this.puddle = new THREE.Mesh(new THREE.CircleGeometry(2.4, 96), this.mats.puddle);
    this.puddle.rotation.x = -Math.PI / 2;
    this.puddle.position.y = 0.001;
    this.puddle.renderOrder = -1;
    this.scene.add(this.wall, this.puddle);
  }

  update(dt: number, s: PourState) {
    const cam = this.cam;
    // 真上から見たとき、半径1が s.R ピクセルになる距離
    const fov = (cam.fov * Math.PI) / 180;
    const D = s.Hh / (2 * s.R * Math.tan(fov / 2));
    const phi = 0.0005 + s.tilt * 0.82;
    const dist = D * (1 + s.tilt * 0.22);
    const ty = s.tilt * 0.25;
    cam.position.set(0, ty + dist * Math.cos(phi), dist * Math.sin(phi));
    cam.up.set(0, 1, 0);
    cam.lookAt(0, ty, 0);
    cam.aspect = s.W / s.Hh;
    cam.setViewOffset(s.W, s.Hh, s.W / 2 - s.cx, s.Hh / 2 - s.cy - s.tilt * s.R * 0.25, s.W, s.Hh);
    cam.updateProjectionMatrix();

    const L = s.liquid ? LIQ[s.liquid] : null;
    // あふれている間は、液面が縁まで盛り上がる
    this.spillVis += (Math.min(1, s.spill * 2.5) - this.spillVis) * Math.min(1, dt * 3);
    const h = Math.max(0.001, s.level * H * 0.94 + (s.spill > 0 ? H * 0.07 : 0));
    const col = new THREE.Vector3(...s.cellCol);
    const bcol = new THREE.Vector3(...s.bottleCol);
    const show = L && s.level > 0.005;
    this.liqSide.visible = this.liqTop.visible = !!show;
    this.liqSide.scale.set(1, h, 1);
    this.liqSide.position.y = h / 2;
    this.liqTop.position.y = h;
    this.waterline.visible = !!show;
    this.waterline.position.y = h + 0.002;
    (this.waterline.material as THREE.MeshBasicMaterial).color.setRGB(0.75 + col.x * 0.25, 0.85 + col.y * 0.15, 1);
    for (const k of ['liqSide', 'liqTop', 'stream', 'bottleLiq']) {
      (this.mats[k].uniforms.uCol.value as THREE.Vector3).copy(k === 'stream' || k === 'bottleLiq' ? bcol : col);
      this.mats[k].uniforms.uA.value = L?.a ?? 0;
    }
    this.mats.liqTop.uniforms.uTime.value = s.time;
    const sv = this.spillVis;
    this.wall.visible = this.puddle.visible = !!L && sv > 0.005;
    for (const k of ['wall', 'puddle']) {
      (this.mats[k].uniforms.uCol.value as THREE.Vector3).copy(col);
      this.mats[k].uniforms.uA.value = L?.a ?? 0;
    }
    this.mats.wall.uniforms.uAmt.value = sv;
    this.mats.puddle.uniforms.uR.value = 1.08 + sv * 0.45;
    this.mats.stream.uniforms.uTime.value = s.time;

    // 瓶
    this.bottleIn += ((L && s.tilt > 0.5 ? 1 : 0) - this.bottleIn) * Math.min(1, dt * 4);
    this.pourAmt += ((s.pouring ? 1 : 0) - this.pourAmt) * Math.min(1, dt * (s.pouring ? 5 : 8));
    this.bx += (s.pourX - this.bx) * Math.min(1, dt * 10);
    const b = this.bottle;
    b.visible = this.bottleIn > 0.01;
    const lift = (1 - this.bottleIn) * 1.5;
    b.position.set(this.bx + 0.62 * (1 - this.pourAmt), 1.05 + lift + (1 - this.pourAmt) * 0.75, 0.05 - (1 - this.pourAmt) * 0.35);
    b.rotation.set(0, 0, -0.35 - this.pourAmt * 1.85);
    b.scale.setScalar(0.9);
    const remain = 1 - s.level * 0.85;
    this.bottleLiq.scale.set(1, remain, 1);
    this.bottleLiq.position.y = -0.78 * (1 - remain);
    (this.mats.liqTop.uniforms.uHit.value as THREE.Vector2).set(this.bx, 0.05);
    this.mats.liqTop.uniforms.uPour.value = this.pourAmt;

    // 流れ：瓶の口から液面まで
    const k = Math.max(0, (this.pourAmt - 0.55) / 0.45);
    this.stream.visible = !!L && k > 0.01;
    if (L && this.stream.visible) {
      b.updateMatrixWorld(true);
      const lipW = new THREE.Vector3(0, 0, 0).applyMatrix4(b.matrixWorld);
      const bottom = new THREE.Vector3(this.bx, h, 0.05);
      const len = Math.max(0.01, lipW.y - bottom.y);
      const r = L.r * (0.4 + 0.6 * k);
      this.stream.scale.set(r, len, r);
      this.stream.position.set((lipW.x + bottom.x) / 2, (lipW.y + bottom.y) / 2, 0.05);
      this.stream.rotation.z = Math.atan2(bottom.x - lipW.x, lipW.y - bottom.y) * 0.5;
    }
  }
}
