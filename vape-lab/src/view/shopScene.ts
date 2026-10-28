import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { tierOf, type GameData, type ShopState, type ShopTierId } from '../sim';
import { drawLabel } from './label';

const ARCHETYPE_COLOUR: Record<string, string> = {
  fruit_fanatic: '#ff6f7d', anti_sweet: '#9aa3b5', ice_fan: '#5ad7ff',
  novelty_seeker: '#c69bff', budget_buyer: '#ffc145', brand_loyalist: '#3ddc84',
};

export interface Shopper {
  archetype: string;
  regular?: boolean;
  young?: boolean;
}

interface Layout {
  entrance: THREE.Vector3;
  outside: THREE.Vector3;
  counter: THREE.Vector3;        // where customers stand to be served
  you: THREE.Vector3;            // where the player stands
  slots: THREE.Vector3[];        // display positions (world)
  browse: THREE.Vector3[];       // floor spots in front of each display
  camera: THREE.Vector3;
  target: THREE.Vector3;
}

interface Walker {
  group: THREE.Group;
  path: THREE.Vector3[];
  waits: number[];
  leg: number;
  wait: number;
  delay: number;
  hold: boolean;                 // stop at the end of the path until released
  onArrive?: () => void;
  popAt?: number;
  popText?: { text: string; colour: string };
  done: boolean;
}

interface Floater {
  sprite: THREE.Sprite;
  life: number;
}

function textSprite(text: string, colour: string, scale = 1): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const ctx = c.getContext('2d')!;
  ctx.font = '800 52px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(10,8,16,0.85)';
  ctx.strokeText(text, 128, 50);
  ctx.fillStyle = colour;
  ctx.fillText(text, 128, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  s.scale.set(0.9 * scale, 0.34 * scale, 1);
  s.renderOrder = 10;
  return s;
}

function disposeTree(o: THREE.Object3D): void {
  o.traverse((x) => {
    if (x instanceof THREE.Mesh || x instanceof THREE.Sprite) {
      x.geometry?.dispose();
      const mats = Array.isArray(x.material) ? x.material : [x.material];
      for (const m of mats) {
        (m as THREE.MeshStandardMaterial).map?.dispose();
        m.dispose();
      }
    }
  });
}

const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });

export class ShopScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private clock = new THREE.Clock();
  private env = new THREE.Group();
  private displays = new THREE.Group();
  private people = new THREE.Group();
  private signCanvas = document.createElement('canvas');
  private signTex: THREE.CanvasTexture;
  private walkers: Walker[] = [];
  private floaters: Floater[] = [];
  private atCounter: Walker | null = null;
  private suspects: Walker[] = [];
  private active = false;
  private tierId: ShopTierId | null = null;
  private layout!: Layout;
  private you!: THREE.Group;

  constructor(private container: HTMLElement, private data: GameData) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 16;
    this.controls.maxPolarAngle = Math.PI * 0.46;

    this.signCanvas.width = 1024;
    this.signCanvas.height = 160;
    this.signTex = new THREE.CanvasTexture(this.signCanvas);
    this.signTex.colorSpace = THREE.SRGBColorSpace;

    this.scene.add(this.env, this.displays, this.people);
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    this.renderer.setAnimationLoop(on ? () => this.tick() : null);
    if (on) this.resize();
  }

  // --- Environments per tier ------------------------------------------------------------

  private buildEnv(tier: ShopTierId, slots: number): void {
    this.clearPeople();
    this.scene.remove(this.env);
    disposeTree(this.env);
    this.env = new THREE.Group();
    this.scene.add(this.env);
    const g = this.env;
    const outdoors = tier === 'car';
    const premium = tier === 'premium';

    this.scene.background = new THREE.Color(outdoors ? '#1b2033' : '#14121c');
    this.scene.fog = outdoors ? new THREE.Fog('#1b2033', 10, 24) : null;
    g.add(new THREE.HemisphereLight(outdoors ? '#bcc8ff' : premium ? '#fff1d6' : '#d9d4ff', '#2a1f2e', outdoors ? 1.1 : 0.9));
    const key = new THREE.DirectionalLight(premium ? '#fff0d8' : '#fff4e6', outdoors ? 1.4 : 2.0);
    key.position.set(3, 7, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8 });
    g.add(key);

    if (tier === 'car') this.buildCar(g);
    else if (tier === 'garage') this.buildGarage(g);
    else this.buildStore(g, tier, slots);

    // You, behind the counter.
    this.you = this.makePerson('#ff4fa3', false, true);
    this.you.position.copy(this.layout.you);
    this.you.rotation.y = Math.atan2(this.layout.counter.x - this.layout.you.x, this.layout.counter.z - this.layout.you.z);
    g.add(this.you);

    this.camera.position.copy(this.layout.camera);
    this.controls.target.copy(this.layout.target);
    this.controls.update();
  }

  private buildCar(g: THREE.Group): void {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 20), mat('#2a2c33', { roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    g.add(ground);
    for (const x of [-3.2, 3.2]) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 5), new THREE.MeshBasicMaterial({ color: '#d9d4c0' }));
      line.rotation.x = -Math.PI / 2;
      line.position.set(x, 0.01, -0.5);
      g.add(line);
    }
    const lamp = new THREE.PointLight('#ffcf8a', 20, 12);
    lamp.position.set(-3, 4, 1);
    g.add(lamp);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 4.2, 8), mat('#444'));
    pole.position.set(-3.6, 2.1, 0.2);
    g.add(pole);

    // The car, rear facing the camera with the boot open.
    const car = new THREE.Group();
    const paint = mat('#3a6df0', { roughness: 0.3, metalness: 0.6 });
    const body = new THREE.Mesh(new RoundedBoxGeometry(2.0, 0.75, 4.0, 3, 0.15), paint);
    body.position.y = 0.65;
    const cabin = new THREE.Mesh(new RoundedBoxGeometry(1.8, 0.65, 2.0, 3, 0.2), mat('#1a1d28', { roughness: 0.2, metalness: 0.5 }));
    cabin.position.set(0, 1.3, -0.4);
    const lid = new THREE.Mesh(new RoundedBoxGeometry(1.8, 0.08, 1.0, 2, 0.04), paint);
    lid.position.set(0, 1.75, 1.75);
    lid.rotation.x = -1.1;
    const bootFloor = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.06, 0.9), mat('#2b2b30'));
    bootFloor.position.set(0, 1.05, 1.45);
    for (const [x, z] of [[-0.95, 1.3], [0.95, 1.3], [-0.95, -1.3], [0.95, -1.3]]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.25, 20), mat('#111'));
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.36, z);
      car.add(wheel);
    }
    for (const x of [-0.75, 0.75]) {
      const light = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.05), new THREE.MeshStandardMaterial({ color: '#ff3344', emissive: '#ff1122', emissiveIntensity: 0.8 }));
      light.position.set(x, 0.85, 2.01);
      car.add(light);
    }
    car.add(body, cabin, lid, bootFloor);
    car.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
    g.add(car);

    this.layout = {
      outside: new THREE.Vector3(-7, 0, 4), entrance: new THREE.Vector3(-4, 0, 4),
      counter: new THREE.Vector3(0.5, 0, 2.9), you: new THREE.Vector3(-1.4, 0, 2.3),
      slots: [new THREE.Vector3(-0.4, 1.08, 1.5), new THREE.Vector3(0.4, 1.08, 1.5)],
      browse: [new THREE.Vector3(-0.4, 0, 2.6), new THREE.Vector3(0.6, 0, 2.6)],
      camera: new THREE.Vector3(2.5, 3.6, 8.5), target: new THREE.Vector3(0, 1, 1.4),
    };
  }

  private buildGarage(g: THREE.Group): void {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(9, 7), mat('#5a5a5e', { roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    g.add(floor);
    const outside = new THREE.Mesh(new THREE.PlaneGeometry(20, 8), mat('#2a2c33', { roughness: 0.95 }));
    outside.rotation.x = -Math.PI / 2;
    outside.position.set(0, -0.01, 7);
    g.add(outside);
    const wall = mat('#6b6257', { roughness: 0.95 });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(9, 3.2), wall);
    back.position.set(0, 1.6, -3);
    const left = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 3.2), wall);
    left.rotation.y = Math.PI / 2;
    left.position.set(-4.5, 1.6, 0.2);
    const right = left.clone();
    right.rotation.y = -Math.PI / 2;
    right.position.x = 4.5;
    g.add(back, left, right);
    // Workbench and pegboard.
    const bench = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.9, 0.8), mat('#7a5a3a'));
    bench.position.set(-2.2, 0.45, -2.5);
    bench.castShadow = true;
    const peg = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.2), mat('#a58a62'));
    peg.position.set(-2.2, 1.8, -2.98);
    g.add(bench, peg);
    // Folding table (the shop) and a cash box table (the counter).
    const table = new THREE.Mesh(new RoundedBoxGeometry(3.4, 0.08, 1.0, 2, 0.03), mat('#e6e1d6'));
    table.position.set(0, 0.85, -0.6);
    table.castShadow = table.receiveShadow = true;
    for (const x of [-1.5, 1.5]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.85, 0.9), mat('#666'));
      leg.position.set(x, 0.42, -0.6);
      g.add(leg);
    }
    const till = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.7), mat('#3a3248'));
    till.position.set(2.6, 0.4, 0.9);
    till.castShadow = true;
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.3), mat('#2f6b3a'));
    box.position.set(2.6, 0.9, 0.9);
    g.add(table, till, box);
    // String lights.
    for (let i = 0; i < 12; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: i % 2 ? '#ffd27a' : '#ff9ad5' }));
      b.position.set(-4 + i * 0.72, 2.7 - Math.sin((i / 11) * Math.PI) * 0.35, -1);
      g.add(b);
    }
    const warm = new THREE.PointLight('#ffcf8a', 14, 10);
    warm.position.set(0, 2.6, 0);
    g.add(warm);

    this.layout = {
      outside: new THREE.Vector3(-2, 0, 7), entrance: new THREE.Vector3(-1.5, 0, 3.4),
      counter: new THREE.Vector3(2.6, 0, 1.9), you: new THREE.Vector3(3.5, 0, 0.4),
      slots: [-1.1, 0, 1.1].map((x) => new THREE.Vector3(x, 0.89, -0.6)),
      browse: [-1.1, 0, 1.1].map((x) => new THREE.Vector3(x, 0, 0.4)),
      camera: new THREE.Vector3(1.6, 5.2, 9), target: new THREE.Vector3(0, 0.8, 0),
    };
  }

  private buildStore(g: THREE.Group, tier: ShopTierId, slots: number): void {
    const premium = tier === 'premium';
    const cols = Math.ceil(slots / 2);
    const width = Math.max(8, cols * 1.7 + 4);
    const depth = 6 + (tier === 'large' || premium ? 1 : 0);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), mat(premium ? '#d9d4cc' : '#2b2735', { roughness: premium ? 0.25 : 0.8, metalness: premium ? 0.1 : 0 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.z = 0.5;
    floor.receiveShadow = true;
    g.add(floor);
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.4, 2), mat(premium ? '#5a2238' : '#3a2a4a', { roughness: 0.95 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(-0.4, 0.005, 1.2);
    g.add(rug);
    const wallMat = mat(premium ? '#2b2420' : '#221e2c', { roughness: 0.9 });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(width, 4.5), wallMat);
    back.position.set(0, 2.25, -2.5);
    const side = new THREE.Mesh(new THREE.PlaneGeometry(depth, 4.5), wallMat);
    side.rotation.y = Math.PI / 2;
    side.position.set(-width / 2, 2.25, 0.5);
    g.add(back, side);
    if (premium) {
      const trim = mat('#d8b56a', { metalness: 0.9, roughness: 0.25 });
      const t1 = new THREE.Mesh(new THREE.BoxGeometry(width, 0.06, 0.06), trim);
      t1.position.set(0, 3.2, -2.47);
      const t2 = t1.clone();
      t2.position.y = 0.3;
      g.add(t1, t2);
      for (const x of [-width / 2 + 0.6, width / 2 - 0.6]) {
        const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.24, 0.6, 16), mat('#e9e2d6'));
        pot.position.set(x, 0.3, -1.8);
        const plant = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10), mat('#2f6b3a'));
        plant.position.set(x, 1.0, -1.8);
        g.add(pot, plant);
      }
    }
    const neonA = new THREE.PointLight(premium ? '#ffd79a' : '#ff4fa3', 14, 10);
    neonA.position.set(-width / 4, 3, -1.5);
    const neonB = new THREE.PointLight(premium ? '#ffe8c4' : '#3ad7ff', 12, 10);
    neonB.position.set(width / 4, 3, -1.5);
    g.add(neonA, neonB);

    const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(width - 1, 5), 0.72), new THREE.MeshBasicMaterial({ map: this.signTex, transparent: true }));
    sign.position.set(0, 3.75, -2.48);
    g.add(sign);

    const shelfW = cols * 1.6 + 0.6;
    const wood = mat(premium ? '#2a2420' : '#4b3f5c', { metalness: premium ? 0.3 : 0 });
    for (let r = 0; r < 2; r++) {
      const shelf = new THREE.Mesh(new RoundedBoxGeometry(shelfW, 0.1, 0.7, 2, 0.03), wood);
      shelf.position.set(-0.5, 0.9 + r * 1.25, -2.1);
      shelf.castShadow = shelf.receiveShadow = true;
      g.add(shelf);
    }
    const slotPos: THREE.Vector3[] = [];
    const browse: THREE.Vector3[] = [];
    for (let i = 0; i < slots; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const x = -0.5 - ((cols - 1) * 1.6) / 2 + col * 1.6;
      slotPos.push(new THREE.Vector3(x, 0.95 + row * 1.25, -2.05));
      browse.push(new THREE.Vector3(x, 0, -1.0));
    }

    const counterX = width / 2 - 1.6;
    const counter = new THREE.Mesh(new RoundedBoxGeometry(1.8, 1.0, 0.8, 3, 0.06), mat(premium ? '#e9e2d6' : '#3a3248', { roughness: 0.4, metalness: 0.3 }));
    counter.position.set(counterX, 0.5, 0.8);
    counter.castShadow = counter.receiveShadow = true;
    const till = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.3, 0.4, 2, 0.04), new THREE.MeshStandardMaterial({ color: '#16141c', emissive: '#3ddc84', emissiveIntensity: 0.15 }));
    till.position.set(counterX + 0.3, 1.15, 0.8);
    g.add(counter, till);

    const doorZ = 2.2;
    const frameMat = mat(premium ? '#d8b56a' : '#16141c', { metalness: 0.6, roughness: 0.3 });
    for (const dz of [-0.6, 0.6]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.6, 0.12), frameMat);
      post.position.set(-width / 2 + 0.1, 1.3, doorZ + dz);
      g.add(post);
    }
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.5), new THREE.MeshBasicMaterial({ color: '#ffe9b0', transparent: true, opacity: 0.18 }));
    glow.rotation.y = Math.PI / 2;
    glow.position.set(-width / 2 + 0.05, 1.25, doorZ);
    g.add(glow);

    this.layout = {
      outside: new THREE.Vector3(-width / 2 - 1.5, 0, doorZ), entrance: new THREE.Vector3(-width / 2 + 1, 0, doorZ),
      counter: new THREE.Vector3(counterX - 0.3, 0, 1.8), you: new THREE.Vector3(counterX + 0.2, 0, -0.1),
      slots: slotPos, browse,
      camera: new THREE.Vector3(1.2, 5.2 + cols * 0.3, 8 + cols * 0.5), target: new THREE.Vector3(0, 1, 0),
    };
  }

  private drawSign(name: string): void {
    const ctx = this.signCanvas.getContext('2d')!;
    const W = this.signCanvas.width, H = this.signCanvas.height;
    ctx.clearRect(0, 0, W, H);
    let size = 96;
    ctx.font = `800 ${size}px "Trebuchet MS", system-ui, sans-serif`;
    while (ctx.measureText(name).width > W * 0.92 && size > 40) ctx.font = `800 ${--size}px "Trebuchet MS", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#ff4fa3';
    ctx.shadowBlur = 30;
    ctx.fillStyle = '#ffd1ea';
    ctx.fillText(name, W / 2, H / 2);
    this.signTex.needsUpdate = true;
  }

  /** Rebuild the environment (on tier change) and the product displays. */
  setShop(shop: ShopState): void {
    const tier = tierOf(shop);
    if (tier.id !== this.tierId) {
      this.tierId = tier.id;
      this.buildEnv(tier.id, tier.slots);
    }
    this.drawSign(shop.name || 'My Vape Store');
    this.scene.remove(this.displays);
    disposeTree(this.displays);
    this.displays = new THREE.Group();
    this.scene.add(this.displays);
    shop.listings.forEach((l, i) => {
      const pos = this.layout.slots[i];
      if (!pos) return;
      const g = new THREE.Group();
      g.position.copy(pos);
      const p = l.product;
      const empty = l.stock <= 0;
      const disposable = p.brand.format === 'disposable';
      const body = new THREE.Mesh(
        disposable ? new RoundedBoxGeometry(0.22, 0.6, 0.12, 3, 0.05) : new RoundedBoxGeometry(0.38, 0.8, 0.2, 4, 0.06),
        new THREE.MeshStandardMaterial({ color: p.brand.labelColour, roughness: 0.35, metalness: 0.5, transparent: empty, opacity: empty ? 0.35 : 1 }),
      );
      body.position.y = disposable ? 0.32 : 0.42;
      body.castShadow = true;
      const canvas = document.createElement('canvas');
      canvas.width = 192;
      canvas.height = 320;
      drawLabel(canvas, p.brand, p.notes, this.data);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const label = new THREE.Mesh(
        disposable ? new THREE.PlaneGeometry(0.18, 0.36) : new THREE.PlaneGeometry(0.3, 0.5),
        new THREE.MeshStandardMaterial({ map: tex, transparent: empty, opacity: empty ? 0.35 : 1 }),
      );
      label.position.set(0, body.position.y, disposable ? 0.061 : 0.101);
      g.add(body, label);
      const boxMat = new THREE.MeshStandardMaterial({ color: p.brand.labelColour, roughness: 0.6 });
      const n = Math.min(10, l.stock);
      for (let k = 0; k < n; k++) {
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 0.1), boxMat);
        const side = k % 2 === 0 ? -1 : 1;
        const idx = Math.floor(k / 2);
        box.position.set(side * (0.3 + (idx % 3) * 0.15), 0.1 + Math.floor(idx / 3) * 0.21, -0.05);
        box.castShadow = true;
        g.add(box);
      }
      this.displays.add(g);
    });
  }

  // --- People -----------------------------------------------------------------------------

  private makePerson(colour: string, regular = false, isYou = false, young = false): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.55, 4, 12), mat(colour));
    body.position.y = 0.5;
    body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), mat('#f1d3b8', { roughness: 0.7 }));
    head.position.y = 1.08;
    head.castShadow = true;
    g.add(body, head);
    if (isYou) {
      const apron = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.45, 0.05), mat('#1d1b22'));
      apron.position.set(0, 0.55, 0.19);
      g.add(apron);
    }
    if (regular) {
      const badge = new THREE.Mesh(new THREE.OctahedronGeometry(0.07), new THREE.MeshStandardMaterial({ color: '#ffd96a', emissive: '#ffd96a', emissiveIntensity: 0.6 }));
      badge.position.set(0, 1.42, 0);
      g.add(badge);
    }
    if (young) g.scale.setScalar(0.86);
    return g;
  }

  private spawn(s: Shopper, path: THREE.Vector3[], waits: number[], opts: { delay?: number; hold?: boolean; onArrive?: () => void } = {}): Walker {
    const group = this.makePerson(ARCHETYPE_COLOUR[s.archetype] ?? '#cccccc', s.regular, false, s.young);
    group.position.copy(path[0]);
    group.visible = !opts.delay;
    this.people.add(group);
    const w: Walker = { group, path, waits, leg: 0, wait: 0, delay: opts.delay ?? 0, hold: !!opts.hold, onArrive: opts.onArrive, done: false };
    this.walkers.push(w);
    return w;
  }

  private jitter(): THREE.Vector3 {
    return new THREE.Vector3((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.3);
  }

  /** A quick customer who browses, maybe buys, and leaves. Fire and forget. */
  walkThrough(s: Shopper, slotIndex: number, bought: boolean, pop?: { text: string; colour: string }): void {
    const L = this.layout;
    const browse = (L.browse[slotIndex] ?? L.browse[0] ?? L.counter).clone().add(this.jitter());
    const path = [L.outside.clone(), L.entrance.clone(), browse];
    const waits = [0, 0, 0.4];
    if (bought) {
      path.push(L.counter.clone().add(this.jitter().multiplyScalar(0.4)));
      waits.push(0.3);
    }
    path.push(L.entrance.clone(), L.outside.clone());
    waits.push(0, 0);
    const w = this.spawn(s, path, waits);
    if (pop) {
      w.popAt = bought ? 3 : 2;
      w.popText = pop;
    }
  }

  /** Walk a customer up to the counter and keep them there. Resolves on arrival. */
  toCounter(s: Shopper, slotIndex: number): Promise<void> {
    const L = this.layout;
    const browse = (L.browse[slotIndex] ?? L.browse[0] ?? L.counter).clone().add(this.jitter());
    return new Promise((resolve) => {
      this.atCounter = this.spawn(s, [L.outside.clone(), L.entrance.clone(), browse, L.counter.clone()], [0, 0, 0.3, 0], { hold: true, onArrive: resolve });
    });
  }

  /** Send the customer at the counter on their way with a pop-up. */
  releaseCounter(pop: string, colour: string): void {
    const w = this.atCounter;
    this.atCounter = null;
    if (!w) return;
    this.pop(pop, colour, w.group.position);
    const L = this.layout;
    w.path = [w.group.position.clone(), L.entrance.clone(), L.outside.clone()];
    w.waits = [0.5, 0, 0];
    w.leg = 0;
    w.wait = 0.5;
    w.hold = false;
  }

  /** Three suspects by the shelves, numbered to match the choices. */
  showSuspects(n: number): void {
    this.clearSuspects();
    const L = this.layout;
    const colours = ['#9aa3b5', '#c69bff', '#ffc145'];
    for (let i = 0; i < n; i++) {
      const spot = (L.browse[i % L.browse.length] ?? L.counter).clone().add(new THREE.Vector3((i - 1) * 0.5, 0, 0.3));
      const w = this.spawn({ archetype: 'x' }, [spot], [0], { hold: true });
      (w.group.children[0] as THREE.Mesh).material = mat(colours[i % 3]);
      const tag = textSprite(String(i + 1), '#ffd96a', 0.8);
      tag.position.set(0, 1.6, 0);
      w.group.add(tag);
      this.suspects.push(w);
    }
  }

  resolveSuspects(caughtIndex: number | null, correct: boolean): void {
    this.suspects.forEach((w, i) => {
      if (i === caughtIndex) this.pop(correct ? 'Caught!' : 'Innocent!', correct ? '#3ddc84' : '#ff5a6a', w.group.position);
      const L = this.layout;
      w.path = [w.group.position.clone(), L.entrance.clone(), L.outside.clone()];
      w.waits = [i === caughtIndex ? 0.8 : 0.2 + i * 0.2, 0, 0];
      w.leg = 0;
      w.wait = w.waits[0];
      w.hold = false;
    });
    this.suspects = [];
  }

  private clearSuspects(): void {
    for (const w of this.suspects) {
      this.people.remove(w.group);
      w.done = true;
    }
    this.suspects = [];
  }

  clearPeople(): void {
    for (const w of this.walkers) {
      this.people.remove(w.group);
      disposeTree(w.group);
    }
    this.walkers = [];
    this.atCounter = null;
    this.suspects = [];
    for (const f of this.floaters) this.scene.remove(f.sprite);
    this.floaters = [];
  }

  pop(text: string, colour: string, at: THREE.Vector3): void {
    const s = textSprite(text, colour);
    s.position.copy(at).add(new THREE.Vector3(0, 1.7, 0));
    this.scene.add(s);
    this.floaters.push({ sprite: s, life: 1.5 });
  }

  private resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = Math.min(62, 42 * Math.max(1, 1.4 / this.camera.aspect) ** 0.55);
    this.camera.updateProjectionMatrix();
  }

  private tick(): void {
    const dt = Math.min(0.05, this.clock.getDelta());
    const speed = 2.6;
    for (const w of this.walkers) {
      if (w.done) continue;
      if (w.delay > 0) {
        w.delay -= dt;
        if (w.delay <= 0) w.group.visible = true;
        continue;
      }
      if (w.wait > 0) {
        w.wait -= dt;
        continue;
      }
      const target = w.path[w.leg + 1];
      if (!target) {
        if (w.hold) continue;
        w.done = true;
        this.people.remove(w.group);
        disposeTree(w.group);
        continue;
      }
      const pos = w.group.position;
      const to = target.clone().sub(pos);
      to.y = 0;
      const dist = to.length();
      const stepLen = speed * dt;
      if (dist <= stepLen) {
        pos.set(target.x, 0, target.z);
        w.leg++;
        w.wait = w.waits[w.leg] ?? 0;
        if (w.popText && w.popAt === w.leg) {
          this.pop(w.popText.text, w.popText.colour, pos);
          w.popText = undefined;
        }
        if (!w.path[w.leg + 1] && w.onArrive) {
          // Face the counter / you.
          w.group.rotation.y = Math.atan2(this.layout.you.x - pos.x, this.layout.you.z - pos.z);
          const cb = w.onArrive;
          w.onArrive = undefined;
          cb();
        }
      } else {
        pos.addScaledVector(to.normalize(), stepLen);
        w.group.rotation.y = Math.atan2(to.x, to.z);
        pos.y = Math.abs(Math.sin(performance.now() / 110)) * 0.04;
      }
    }
    this.walkers = this.walkers.filter((w) => !w.done);
    if (this.you) this.you.position.y = Math.abs(Math.sin(performance.now() / 900)) * 0.02;
    for (const f of this.floaters) {
      f.life -= dt;
      f.sprite.position.y += dt * 0.6;
      (f.sprite.material as THREE.SpriteMaterial).opacity = Math.min(1, f.life);
      if (f.life <= 0) {
        this.scene.remove(f.sprite);
        f.sprite.material.map?.dispose();
        f.sprite.material.dispose();
      }
    }
    this.floaters = this.floaters.filter((f) => f.life > 0);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
