// 鑑定士のこすくまくん（3D）。普段はゆっくり、ほぼ無表情。反応は姿勢と間で出す。
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

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
    load().then((g) => {
      const m = g.clone(true);
      // Blender は Z が上。glTF 書き出しで Y 上になっている
      this.root.add(m);
    });
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
    this.root.rotation.y = Math.sin(t * 0.35) * 0.12 + l * 0.0;
    this.root.rotation.x = l * 0.22 + Math.sin(t * 0.5) * 0.015;
    this.root.position.z = l * 0.7;
    this.root.position.y = Math.sin(t * 0.9) * 0.012 - l * 0.12;
    this.r.render(this.scene, this.cam);
  }

  dispose() {
    this.stop();
    this.r.dispose();
  }
}
