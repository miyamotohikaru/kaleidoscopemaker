// 鑑定士のこすくまくん（3D）。普段はゆっくり、ほぼ無表情。反応は姿勢と間で出す。
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

let cached: Promise<THREE.Group> | null = null;
function load() {
  cached ??= new GLTFLoader().loadAsync('/appraiser.glb').then((g) => g.scene);
  return cached;
}
export const preloadKuma = () => load();

export class Kuma3D {
  r: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
  root = new THREE.Group();
  raf = 0;
  t0 = performance.now();
  lean = 0; // 1 = のぞきこむ
  peek = 0; // 1 = 万華鏡を目に当てている
  mood = 0; // 結果への反応：+ 小さく跳ねる / - がっかり
  moodT = 0;
  tube = new THREE.Group();
  spin = new THREE.Group();
  endMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
  endTex: THREE.Texture | null = null;

  constructor(public canvas: HTMLCanvasElement) {
    this.r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.r.toneMapping = THREE.ACESFilmicToneMapping;
    this.r.toneMappingExposure = 1.05;
    this.cam.position.set(0, 1.05, 6.2);
    this.cam.lookAt(0, 0.95, 0);
    const key = new THREE.DirectionalLight(0xfff1dc, 2.6);
    key.position.set(-2, 3, 4);
    const rim = new THREE.DirectionalLight(0xffc98a, 2.2);
    rim.position.set(3, 2, -3);
    const fill = new THREE.HemisphereLight(0xfff4e6, 0x1a1210, 1.1);
    this.scene.add(key, rim, fill, this.root);
    const pm = new THREE.PMREMGenerator(this.r);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    // 金属（筒）だけに映り込みが欲しいので、体への効きは弱く
    this.scene.environmentIntensity = 0.25;
    pm.dispose();
    // 真鍮の小さな万華鏡（筒の +Y が対物側＝光のほう）
    const brass = new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 1, roughness: 0.25, envMapIntensity: 5 }); // ステンレス
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1412, metalness: 0.3, roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.07, 0.78, 48), brass);
    body.position.y = 0.39;
    const eye = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.06, 48), dark);
    eye.position.y = 0.0;
    const cellRing = new THREE.Mesh(new THREE.CylinderGeometry(0.098, 0.098, 0.12, 48), brass);
    cellRing.position.y = 0.8;
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.076, 0.008, 8, 48), brass);
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.55;
    const end = new THREE.Mesh(new THREE.CircleGeometry(0.088, 48), this.endMat);
    end.rotation.x = -Math.PI / 2;
    end.position.y = 0.861;
    this.spin.add(cellRing, end);
    this.tube.add(body, eye, band, this.spin);
    this.tube.visible = false;
    this.scene.add(this.tube);
    load().then((g) => {
      const m = g.clone(true);
      // Blender は Z が上。glTF 書き出しで Y 上になっている
      this.root.add(m);
    });
  }

  react(m: number) {
    this.mood = m;
    this.moodT = (performance.now() - this.t0) / 1000;
  }

  // 筒の先に、その人の万華鏡を映す
  setScope(c: HTMLCanvasElement) {
    this.endTex?.dispose();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    this.endTex = t;
    this.endMat.map = t;
    this.endMat.color.set(0xffffff);
    this.endMat.needsUpdate = true;
  }

  start() {
    const loop = () => {
      this.frame();
      this.raf = requestAnimationFrame(loop);
    };
    cancelAnimationFrame(this.raf);
    loop();
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }

  resize(w: number, h: number) {
    this.r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.r.setSize(w, h, false);
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
  }

  private frame() {
    const t = (performance.now() - this.t0) / 1000;
    const l = this.lean;
    const k = this.peek;
    // のぞくときは筒の側へ首をかしげ、少しだけ前に出る
    this.root.rotation.y = Math.sin(t * 0.35) * 0.12 * (1 - k) - k * 0.28;
    this.root.rotation.x = l * 0.12 + Math.sin(t * 0.5) * 0.015;
    this.root.rotation.z = -k * 0.1;
    this.root.position.z = l * 0.45;
    this.root.position.y = Math.sin(t * 0.9) * 0.012 - l * 0.06;
    // 結果への反応（ふだんは無表情。体と間で出す）
    const rt = t - this.moodT;
    if (this.mood > 0 && rt < 1.6) {
      // 小さく2回跳ねる
      const hop = Math.abs(Math.sin(rt * Math.PI * 2.5)) * Math.max(0, 1 - rt / 1.6);
      this.root.position.y += hop * 0.16 * this.mood;
      this.root.rotation.z += Math.sin(rt * 12) * 0.04 * hop;
    } else if (this.mood < 0) {
      // がっくり：前に首を落として、少し沈む
      const k2 = Math.min(1, rt / 0.8);
      const e2 = 1 - Math.pow(1 - k2, 3);
      this.root.rotation.x += 0.22 * e2 * -this.mood;
      this.root.position.y -= 0.07 * e2 * -this.mood;
      this.root.rotation.y *= 0.4;
    }
    // 筒：右手のあたりから持ち上がって、片眼鏡の目に当たる
    this.tube.visible = k > 0.01;
    if (this.tube.visible) {
      this.root.updateMatrixWorld(true);
      const eyeW = new THREE.Vector3(0.121, 1.17, 0.66).applyMatrix4(this.root.matrixWorld);
      const handW = new THREE.Vector3(0.7, 0.62, 0.35).applyMatrix4(this.root.matrixWorld);
      const e = 1 - Math.pow(1 - k, 3);
      this.tube.position.lerpVectors(handW, eyeW, e);
      const dirPeek = new THREE.Vector3(0.62, 0.55, 0.56).normalize();
      const dirRest = new THREE.Vector3(0.2, 1, 0.2).normalize();
      const dir = dirRest.clone().lerp(dirPeek, e).normalize();
      this.tube.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      this.tube.scale.setScalar(0.6 + 0.4 * Math.min(1, k * 2));
      // のぞきながら、筒の先をゆっくりひねる
      this.spin.rotation.y = t * 0.6 * k;
    }
    this.r.render(this.scene, this.cam);
  }

  dispose() {
    this.stop();
    this.r.dispose();
  }
}
