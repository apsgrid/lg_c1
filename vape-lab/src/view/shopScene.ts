import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { cityLoc, sellLocId, shelfSlots, tierOf, type CityLocation, type GameData, type ShopState } from '../sim';
import { drawDistrictView, themeFor, type DistrictTheme } from './districtTheme';
import { drawLabel } from './label';
import { blobShadowTexture, Post } from './post';

const ARCHETYPE_COLOUR: Record<string, string> = {
  fruit_fanatic: '#ff6f7d', anti_sweet: '#9aa3b5', ice_fan: '#5ad7ff',
  novelty_seeker: '#c69bff', budget_buyer: '#ffc145', brand_loyalist: '#3ddc84',
};

export interface Shopper {
  archetype: string;
  colour?: string;
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
  /** Where each shop upgrade stands: position + facing. */
  decor: Record<string, { at: THREE.Vector3; rot?: number }>;
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
  moving: boolean;
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
        const map = (m as THREE.MeshStandardMaterial).map;
        if (map && !map.userData.shared) map.dispose();
        m.dispose();
      }
    }
  });
}

const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });

function canvasTex(w: number, hgt: number, paint: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hgt;
  paint(c.getContext('2d')!);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A soft glow behind the diorama, tinted by the district. */
function backdropTexture(tint: string): THREE.CanvasTexture {
  return canvasTex(512, 512, (ctx) => {
    const g = ctx.createRadialGradient(256, 200, 20, 256, 260, 380);
    g.addColorStop(0, tint);
    g.addColorStop(0.55, '#15131f');
    g.addColorStop(1, '#09080f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
  });
}

/** Floor tiles (or boards) with a little variation, so floors aren't flat colour. */
function floorTexture(base: string, boards: boolean): THREE.CanvasTexture {
  const tex = canvasTex(256, 256, (ctx) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 256, 256);
    const n = boards ? 4 : 2;
    const size = 256 / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < (boards ? 1 : n); j++) {
      const v = ((i * 7 + j * 13) % 5) / 5 - 0.4;
      ctx.fillStyle = v > 0 ? `rgba(255,255,255,${v * 0.06})` : `rgba(0,0,0,${-v * 0.12})`;
      if (boards) ctx.fillRect(i * size, 0, size, 256);
      else ctx.fillRect(i * size, j * size, size, size);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 3;
    for (let i = 0; i <= n; i++) {
      ctx.beginPath(); ctx.moveTo(i * size, 0); ctx.lineTo(i * size, 256); ctx.stroke();
      if (!boards) { ctx.beginPath(); ctx.moveTo(0, i * size); ctx.lineTo(256, i * size); ctx.stroke(); }
    }
    if (boards) for (let i = 0; i < n; i++) { ctx.beginPath(); ctx.moveTo(i * size, (i * 97) % 256); ctx.lineTo((i + 1) * size, (i * 97) % 256); ctx.stroke(); }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function posterTexture(lines: string[], bg: string, fg: string, accent: string): THREE.CanvasTexture {
  return canvasTex(256, 360, (ctx) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 256, 360);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 8;
    ctx.strokeRect(10, 10, 236, 340);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = accent;
    ctx.font = '900 78px system-ui, sans-serif';
    ctx.fillText(lines[0], 128, 120);
    ctx.fillStyle = fg;
    ctx.font = '800 30px system-ui, sans-serif';
    lines.slice(1).forEach((ln, i) => ctx.fillText(ln, 128, 220 + i * 40));
  });
}

export class ShopScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private clock = new THREE.Clock();
  private env = new THREE.Group();
  private displays = new THREE.Group();
  private decor = new THREE.Group();
  private people = new THREE.Group();
  private signCanvas = document.createElement('canvas');
  private signTex: THREE.CanvasTexture;
  private walkers: Walker[] = [];
  private floaters: Floater[] = [];
  private atCounter: Walker | null = null;
  private suspects: Walker[] = [];
  private active = false;
  private envKey = '';
  private decorKey = '';
  private layout!: Layout;
  private you!: THREE.Group;
  private post: Post;

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

    this.scene.add(this.env, this.displays, this.decor, this.people);
    this.post = new Post(this.renderer, this.scene, this.camera, { bloom: 0.5, envIntensity: 0.5 });
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

  private buildEnv(tier: string, slots: number, theme: DistrictTheme, loc: CityLocation | undefined): void {
    this.clearPeople();
    this.scene.remove(this.env);
    disposeTree(this.env);
    this.env = new THREE.Group();
    this.scene.add(this.env);
    const g = this.env;
    const outdoors = tier === 'car';
    const premium = tier === 'premium';

    if (this.scene.background instanceof THREE.Texture) this.scene.background.dispose();
    this.scene.background = backdropTexture(tier === 'garage' ? '#3a3040' : theme.sky);
    this.scene.fog = null;
    g.add(new THREE.HemisphereLight(outdoors ? '#bcc8ff' : premium ? '#fff1d6' : '#d9d4ff', '#2a1f2e', outdoors ? 1.1 : 0.9));
    const key = new THREE.DirectionalLight(premium ? '#fff0d8' : '#fff4e6', outdoors ? 1.4 : 2.0);
    key.position.set(3, 7, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8 });
    g.add(key);

    if (tier === 'car') this.buildCar(g, theme, loc);
    else if (tier === 'garage') this.buildGarage(g);
    else this.buildStore(g, tier, slots, theme, loc);

    // You, behind the counter.
    this.you = this.makePerson('#ff4fa3', false, true);
    this.you.position.copy(this.layout.you);
    this.you.rotation.y = Math.atan2(this.layout.counter.x - this.layout.you.x, this.layout.counter.z - this.layout.you.z);
    g.add(this.you);

    this.camera.position.copy(this.layout.camera);
    this.controls.target.copy(this.layout.target);
    this.controls.update();
  }

  /** A window (or backdrop) onto the district outside. */
  private districtView(loc: CityLocation | undefined, theme: DistrictTheme, w: number, hgt: number): THREE.Mesh {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = Math.round(512 * (hgt / w));
    drawDistrictView(c, loc, theme);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(new THREE.PlaneGeometry(w, hgt), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  }

  private buildCar(g: THREE.Group, theme: DistrictTheme, loc: CityLocation | undefined): void {
    const backdrop = this.districtView(loc, theme, 16, 6);
    backdrop.position.set(0, 3, -6);
    g.add(backdrop);
    // A diorama: a slab of street (road, kerb, pavement) on a plinth with a neon edge.
    const plinth = new THREE.Mesh(new RoundedBoxGeometry(13.5, 0.5, 11, 2, 0.06), mat('#1b1826', { roughness: 0.7 }));
    plinth.position.set(-0.75, -0.26, 0);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(13.3, 10.8), mat(theme.ground, { roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(-0.75, 0.001, 0);
    ground.receiveShadow = true;
    const pave = new THREE.Mesh(new THREE.PlaneGeometry(13.3, 2.2), mat('#34323d', { roughness: 0.95 }));
    pave.rotation.x = -Math.PI / 2;
    pave.position.set(-0.75, 0.004, 4.3);
    pave.receiveShadow = true;
    const kerb = new THREE.Mesh(new THREE.BoxGeometry(13.3, 0.1, 0.16), mat('#6a6874'));
    kerb.position.set(-0.75, 0.05, 3.2);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(13.5, 0.04, 0.04), new THREE.MeshStandardMaterial({ color: theme.neonA, emissive: theme.neonA, emissiveIntensity: 0.7 }));
    edge.position.set(-0.75, -0.12, 5.52);
    g.add(plinth, ground, pave, kerb, edge);
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
      camera: new THREE.Vector3(3.2, 5.2, 11.5), target: new THREE.Vector3(0, 0.8, 1.0),
      decor: {},
    };
  }

  private buildGarage(g: THREE.Group): void {
    const floorTex = floorTexture('#5a5a5e', false);
    floorTex.repeat.set(3, 2.4);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(9, 7), mat('#ffffff', { map: floorTex, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    g.add(floor);
    // The garage and its driveway sit on a plinth, like a model.
    const plinth = new THREE.Mesh(new RoundedBoxGeometry(9.8, 0.5, 11.2, 2, 0.06), mat('#1b1826', { roughness: 0.7 }));
    plinth.position.set(0, -0.26, 2.0);
    const drive = new THREE.Mesh(new THREE.PlaneGeometry(9.6, 4.1), mat('#3a3a42', { roughness: 0.95 }));
    drive.rotation.x = -Math.PI / 2;
    drive.position.set(0, 0.001, 5.55);
    drive.receiveShadow = true;
    const edge = new THREE.Mesh(new THREE.BoxGeometry(9.8, 0.04, 0.04), new THREE.MeshStandardMaterial({ color: '#ffb020', emissive: '#ffb020', emissiveIntensity: 0.6 }));
    edge.position.set(0, -0.12, 7.62);
    g.add(plinth, drive, edge);
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
      decor: {
        sign: { at: new THREE.Vector3(0, 2.25, -2.97) },
        card_reader: { at: new THREE.Vector3(2.35, 0.8, 0.9) },
      },
    };
  }

  private buildStore(g: THREE.Group, tier: string, slots: number, theme: DistrictTheme, loc: CityLocation | undefined): void {
    const premium = tier === 'premium';
    const cols = Math.ceil(slots / 2);
    const width = Math.max(8, cols * 1.7 + 4);
    const depth = 6 + (tier === 'large' || premium ? 1 : 0);
    const floorTex = floorTexture(premium ? '#d9d4cc' : theme.floor, !premium && ['market', 'uni', 'church', 'suburbs', 'school'].includes(loc?.id ?? ''));
    floorTex.repeat.set(width / 2, depth / 2);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), mat('#ffffff', { map: floorTex, roughness: premium ? 0.25 : 0.75, metalness: premium ? 0.1 : 0 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.z = 0.5;
    floor.receiveShadow = true;
    g.add(floor);
    // The diorama: the shop and a strip of pavement on a plinth, with a neon edge.
    const outW = 3.2;
    const baseW = width + outW + 0.4;
    const baseX = (-width / 2 - outW + width / 2 + 0.2) / 2;
    const plinth = new THREE.Mesh(new RoundedBoxGeometry(baseW, 0.5, depth + 0.6, 2, 0.06), mat('#1b1826', { roughness: 0.7 }));
    plinth.position.set(baseX, -0.26, 0.5);
    plinth.receiveShadow = true;
    const edge = new THREE.Mesh(new THREE.BoxGeometry(baseW, 0.04, 0.04), new THREE.MeshStandardMaterial({ color: theme.neonA, emissive: theme.neonA, emissiveIntensity: 0.7 }));
    edge.position.set(baseX, -0.12, 0.5 + (depth + 0.6) / 2 + 0.01);
    const pave = new THREE.Mesh(new THREE.PlaneGeometry(outW, depth + 0.4), mat('#4a4854', { roughness: 0.9 }));
    pave.rotation.x = -Math.PI / 2;
    pave.position.set(-width / 2 - outW / 2, 0.002, 0.5);
    pave.receiveShadow = true;
    const kerb = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, depth + 0.4), mat('#6a6874'));
    kerb.position.set(-width / 2 - outW + 0.09, 0.05, 0.5);
    g.add(plinth, edge, pave, kerb);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 3.6, 8), mat('#3a3844', { metalness: 0.6 }));
    pole.position.set(-width / 2 - outW + 0.5, 1.8, -1.6);
    const lampHead = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), new THREE.MeshStandardMaterial({ color: '#ffe6b0', emissive: '#ffcf8a', emissiveIntensity: 2.5 }));
    lampHead.position.set(-width / 2 - outW + 0.5, 3.65, -1.6);
    const streetLight = new THREE.PointLight('#ffcf8a', 8, 6);
    streetLight.position.set(-width / 2 - outW + 0.7, 3.3, -1.2);
    g.add(pole, lampHead, streetLight);
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.4, 2), mat(premium ? '#5a2238' : theme.rug, { roughness: 0.95 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(-0.4, 0.005, 1.2);
    g.add(rug);
    const wallMat = mat(premium ? '#2b2420' : theme.wall, { roughness: 0.9 });
    // Walls with real thickness, so the cutaway reads like a model.
    const back = new THREE.Mesh(new THREE.BoxGeometry(width + 0.2, 4.5, 0.2), wallMat);
    back.position.set(0.1 - 0.2, 2.25, -2.6);
    // The side wall has a real doorway (customers walk in through it).
    const doorZ = 2.2, doorHalf = 0.6, doorTop = 2.6;
    const wallZ0 = 0.5 - depth / 2 - 0.1 - 0.1, wallZ1 = 0.5 + depth / 2 + 0.1 - 0.1;
    const sideA = new THREE.Mesh(new THREE.BoxGeometry(0.2, 4.5, doorZ - doorHalf - wallZ0), wallMat);
    sideA.position.set(-width / 2 - 0.1, 2.25, (wallZ0 + doorZ - doorHalf) / 2);
    const sideB = new THREE.Mesh(new THREE.BoxGeometry(0.2, 4.5, wallZ1 - doorZ - doorHalf), wallMat);
    sideB.position.set(-width / 2 - 0.1, 2.25, (doorZ + doorHalf + wallZ1) / 2);
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.2, 4.5 - doorTop, doorHalf * 2), wallMat);
    lintel.position.set(-width / 2 - 0.1, (4.5 + doorTop) / 2, doorZ);
    const side = new THREE.Group();
    side.add(sideA, sideB, lintel);
    back.receiveShadow = sideA.receiveShadow = sideB.receiveShadow = true;
    const mat2 = new THREE.Mesh(new THREE.PlaneGeometry(0.9, doorHalf * 2 - 0.1), mat('#2a2430', { roughness: 1 }));
    mat2.rotation.x = -Math.PI / 2;
    mat2.position.set(-width / 2 + 0.45, 0.006, doorZ);
    g.add(mat2);
    const capMat = mat(premium ? '#d8b56a' : '#6a6478', { roughness: 0.7, metalness: premium ? 0.8 : 0 });
    const capBack = new THREE.Mesh(new THREE.BoxGeometry(width + 0.24, 0.06, 0.24), capMat);
    capBack.position.set(-0.1, 4.53, -2.6);
    const capSide = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.06, depth + 0.24), capMat);
    capSide.position.set(-width / 2 - 0.1, 4.53, 0.4);
    const skirt = mat(`#${new THREE.Color(theme.wall).multiplyScalar(0.6).getHexString()}`);
    const skirtBack = new THREE.Mesh(new THREE.BoxGeometry(width, 0.16, 0.04), skirt);
    skirtBack.position.set(0, 0.08, -2.48);
    const skirtSide = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, doorZ - doorHalf - (0.5 - depth / 2)), skirt);
    skirtSide.position.set(-width / 2 + 0.02, 0.08, (0.5 - depth / 2 + doorZ - doorHalf) / 2);
    g.add(back, side, capBack, capSide, skirtBack, skirtSide);
    // Pendant lamps over the floor.
    for (const x of [-width / 4, 0.1 * width, width / 4 + 0.6]) {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.9, 4), mat('#111'));
      cord.position.set(x, 4.05, 0.3);
      const shadeM = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.26, 20, 1, true), mat(premium ? '#d8b56a' : '#1d1b22', { side: THREE.DoubleSide, metalness: 0.5, roughness: 0.4 }));
      shadeM.position.set(x, 3.5, 0.3);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), new THREE.MeshStandardMaterial({ color: '#fff3d6', emissive: '#ffd9a0', emissiveIntensity: 3 }));
      bulb.position.set(x, 3.38, 0.3);
      g.add(cord, shadeM, bulb);
    }
    const pendant = new THREE.PointLight('#ffd9a0', 10, 9);
    pendant.position.set(0, 3.2, 0.5);
    g.add(pendant);
    // Posters: the house rules, and something new in.
    const poster18 = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.87), new THREE.MeshStandardMaterial({ map: posterTexture(['18+', 'ONLY', 'ID checked'], '#1a1824', '#ece9f6', '#ff5a6a'), roughness: 0.6 }));
    poster18.position.set(width / 2 - 0.55, 2.3, -2.48);
    const posterNew = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.87), new THREE.MeshStandardMaterial({ map: posterTexture(['NEW', 'flavours', 'in store'], '#1a1824', '#ece9f6', theme.neonB), roughness: 0.6 }));
    posterNew.position.set(width / 2 - 1.3, 2.3, -2.48);
    g.add(poster18, posterNew);
    if (!premium) {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.17, 0.45, 16), mat('#c9805a', { roughness: 0.8 }));
      pot.position.set(width / 2 - 0.4, 0.22, 3.0);
      const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), mat('#2f6b3a', { roughness: 0.8, flatShading: true }));
      leaves.position.set(width / 2 - 0.4, 0.8, 3.0);
      leaves.castShadow = true;
      g.add(pot, leaves);
    }
    // A window onto the street outside: you can see which district you're in.
    const win = this.districtView(loc, theme, 2, 1.4);
    win.rotation.y = Math.PI / 2;
    win.position.set(-width / 2 + 0.05, 1.9, -1.5);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.55, 2.15), mat('#16141c', { metalness: 0.5, roughness: 0.4 }));
    frame.position.set(-width / 2 + 0.01, 1.9, -1.5);
    g.add(frame, win);
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
    const neonA = new THREE.PointLight(premium ? '#ffd79a' : theme.neonA, 14, 10);
    neonA.position.set(-width / 4, 3, -1.5);
    const neonB = new THREE.PointLight(premium ? '#ffe8c4' : theme.neonB, 12, 10);
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

    const frameMat = mat(premium ? '#d8b56a' : '#16141c', { metalness: 0.6, roughness: 0.3 });
    for (const dz of [-0.6, 0.6]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.6, 0.12), frameMat);
      post.position.set(-width / 2 + 0.1, 1.3, doorZ + dz);
      g.add(post);
    }
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1.32), frameMat);
    head.position.set(-width / 2 + 0.1, 2.6, doorZ);
    g.add(head);
    // Light spilling out of the doorway onto the pavement.
    const spill = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.3), new THREE.MeshBasicMaterial({ color: '#ffe0a0', transparent: true, opacity: 0.12, depthWrite: false }));
    spill.rotation.x = -Math.PI / 2;
    spill.position.set(-width / 2 - 0.8, 0.01, doorZ);
    g.add(spill);

    this.layout = {
      outside: new THREE.Vector3(-width / 2 - 1.5, 0, doorZ), entrance: new THREE.Vector3(-width / 2 + 1, 0, doorZ),
      counter: new THREE.Vector3(counterX - 0.3, 0, 1.8), you: new THREE.Vector3(counterX + 0.2, 0, -0.1),
      slots: slotPos, browse,
      camera: new THREE.Vector3(1.2, 4.5 + width * 0.25, 5 + width * 0.6), target: new THREE.Vector3(-0.3, 1, 0.3),
      decor: {
        sign: { at: new THREE.Vector3(-width / 2 + 0.08, 3.05, doorZ), rot: Math.PI / 2 },
        card_reader: { at: new THREE.Vector3(counterX - 0.4, 1.0, 0.8) },
        sofa: { at: new THREE.Vector3(-width / 2 + 0.7, 0, -1.0), rot: Math.PI / 2 },
        tasting_bar: { at: new THREE.Vector3(width / 2 - 0.9, 0, -1.6) },
        cctv: { at: new THREE.Vector3(width / 2 - 0.5, 3.4, -2.35) },
        neon: { at: new THREE.Vector3(-width / 2 + 0.03, 1.9, -0.2), rot: Math.PI / 2 },
        lounge: { at: new THREE.Vector3(-width / 2 + 2.2, 0, 3.0) },
      },
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

  /** Rebuild the environment (on tier or slot change), upgrades and product displays. */
  setShop(shop: ShopState): void {
    const tier = tierOf(shop);
    const slots = shelfSlots(shop);
    const locId = tier.id === 'garage' ? shop.home : sellLocId(shop);
    const envKey = `${tier.id}:${slots}:${locId}`;
    if (envKey !== this.envKey) {
      this.envKey = envKey;
      this.decorKey = '';
      this.buildEnv(tier.id, slots, themeFor(locId), cityLoc(this.data, locId));
    }
    const decorKey = `${envKey}|${(shop.upgrades ?? []).join(',')}|${shop.name}`;
    if (decorKey !== this.decorKey) {
      this.decorKey = decorKey;
      this.buildDecor(shop);
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

  // --- Upgrades ---------------------------------------------------------------------------

  private buildDecor(shop: ShopState): void {
    this.scene.remove(this.decor);
    disposeTree(this.decor);
    this.decor = new THREE.Group();
    this.scene.add(this.decor);
    for (const id of shop.upgrades ?? []) {
      const spot = this.layout.decor[id];
      if (!spot) continue;
      const g = this.makeDecor(id, shop.name || 'My Vape Store');
      g.position.copy(spot.at);
      g.rotation.y = spot.rot ?? 0;
      g.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
      this.decor.add(g);
    }
  }

  private makeDecor(id: string, name: string): THREE.Group {
    const g = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      g.add(mesh);
      return mesh;
    };
    switch (id) {
      case 'sign': {
        const c = document.createElement('canvas');
        c.width = 512;
        c.height = 128;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#f4ead2';
        ctx.fillRect(0, 0, 512, 128);
        ctx.strokeStyle = '#7a5a3a';
        ctx.lineWidth = 10;
        ctx.strokeRect(5, 5, 502, 118);
        ctx.fillStyle = '#7a2f4a';
        ctx.font = 'italic 800 54px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(name, 256, 66, 480);
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        add(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide }), 0, 0, 0.02);
        break;
      }
      case 'card_reader':
        add(new RoundedBoxGeometry(0.16, 0.06, 0.24, 2, 0.02), mat('#1d1b22'), 0, 0.03, 0);
        add(new THREE.PlaneGeometry(0.1, 0.07), new THREE.MeshBasicMaterial({ color: '#3ddc84' }), 0, 0.062, -0.03).rotation.x = -Math.PI / 2;
        break;
      case 'sofa': {
        const fabric = mat('#7a3a5a', { roughness: 0.9 });
        add(new RoundedBoxGeometry(1.8, 0.4, 0.8, 3, 0.1), fabric, 0, 0.3, 0);
        add(new RoundedBoxGeometry(1.8, 0.6, 0.2, 3, 0.08), fabric, 0, 0.7, -0.35);
        for (const x of [-0.85, 0.85]) add(new RoundedBoxGeometry(0.2, 0.5, 0.8, 3, 0.08), fabric, x, 0.5, 0);
        add(new RoundedBoxGeometry(0.4, 0.3, 0.1, 2, 0.05), mat('#ffd96a'), -0.4, 0.62, -0.2);
        break;
      }
      case 'tasting_bar': {
        add(new RoundedBoxGeometry(1.2, 1.0, 0.5, 2, 0.05), mat('#5a3a2a'), 0, 0.5, 0);
        add(new RoundedBoxGeometry(1.3, 0.06, 0.6, 2, 0.02), mat('#d8b56a', { metalness: 0.6, roughness: 0.3 }), 0, 1.03, 0);
        for (const x of [-0.35, 0.35]) {
          add(new THREE.CylinderGeometry(0.16, 0.16, 0.06, 16), mat('#2a2420'), x, 0.7, 0.55);
          add(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 8), mat('#888', { metalness: 0.8 }), x, 0.35, 0.55);
        }
        for (const [x, col] of [[-0.4, '#e8435a'], [-0.15, '#5fe0b0'], [0.1, '#ffb020'], [0.35, '#c69bff']] as const) {
          add(new THREE.CylinderGeometry(0.035, 0.035, 0.14, 10), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.3 }), x as number, 1.13, 0);
        }
        break;
      }
      case 'cctv': {
        add(new THREE.BoxGeometry(0.08, 0.08, 0.2), mat('#ddd'), 0, 0, 0.1);
        const cam = add(new RoundedBoxGeometry(0.16, 0.14, 0.32, 2, 0.04), mat('#f2f2f2'), -0.05, -0.08, 0.3);
        cam.rotation.set(0.5, -0.6, 0);
        add(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff2a3a' }), -0.12, -0.04, 0.44);
        break;
      }
      case 'neon': {
        add(new THREE.PlaneGeometry(1.8, 1.2), new THREE.MeshBasicMaterial({ color: '#2a1838', side: THREE.DoubleSide }), 0, 0, 0);
        const tube = new THREE.MeshStandardMaterial({ color: '#ff4fa3', emissive: '#ff4fa3', emissiveIntensity: 2.2 });
        const ring = add(new THREE.TorusGeometry(0.32, 0.03, 8, 40), tube, -0.4, 0.05, 0.03);
        ring.rotation.set(0, 0, 0);
        add(new THREE.TorusGeometry(0.18, 0.03, 8, 30), new THREE.MeshStandardMaterial({ color: '#3ad7ff', emissive: '#3ad7ff', emissiveIntensity: 2.2 }), 0.35, 0.15, 0.03);
        add(new THREE.BoxGeometry(0.7, 0.04, 0.04), tube, 0.3, -0.3, 0.03);
        const glow = new THREE.PointLight('#ff4fa3', 6, 4);
        glow.position.set(0, 0, 0.6);
        g.add(glow);
        break;
      }
      case 'lounge': {
        add(new THREE.CylinderGeometry(1.1, 1.1, 0.01, 40), mat('#3a5a4a', { roughness: 0.95 }), 0, 0.006, 0);
        for (const x of [-0.6, 0.6]) {
          const chair = new THREE.Group();
          const leather = mat('#6b4226', { roughness: 0.5 });
          const seat = new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.35, 0.7, 3, 0.1), leather);
          seat.position.y = 0.3;
          const back = new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.6, 0.18, 3, 0.08), leather);
          back.position.set(0, 0.65, 0.28);
          chair.add(seat, back);
          chair.position.set(x, 0, 0);
          chair.rotation.y = x < 0 ? Math.PI * 0.85 : -Math.PI * 0.85;
          g.add(chair);
        }
        add(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 20), mat('#d8b56a', { metalness: 0.7, roughness: 0.3 }), 0, 0.5, -0.1);
        add(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8), mat('#d8b56a', { metalness: 0.7 }), 0, 0.25, -0.1);
        break;
      }
    }
    return g;
  }

  // --- People -----------------------------------------------------------------------------

  private makePerson(colour: string, regular = false, isYou = false, young = false, seed = Math.random()): THREE.Group {
    const g = new THREE.Group();
    const skinTones = ['#f1d3b8', '#e0b48f', '#c68e63', '#9a6440', '#6e452a'];
    const hairTones = ['#2b1d14', '#5a3a22', '#a8743d', '#e3c27a', '#1d1b22', '#b8432f', '#8a8f99'];
    const pick = <T,>(arr: T[], k: number) => arr[Math.floor(((seed * 9301 + k * 49297) % 1) * arr.length) % arr.length];
    const skin = mat(pick(skinTones, 1), { roughness: 0.7 });
    const cloth = mat(colour, { roughness: 0.65 });
    const trousers = mat(pick(['#2a2c3a', '#3a3a44', '#4a3b2c', '#1f2a3d'], 2), { roughness: 0.8 });

    // Soft blob shadow on the floor.
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.75), new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, depthWrite: false }));
    shadow.userData.noExport = true;
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.012;
    g.add(shadow);

    const body = new THREE.Group();
    g.add(body);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.32, 4, 12), cloth);
    torso.position.y = 0.78;
    torso.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 18, 14), skin);
    head.position.y = 1.18;
    head.castShadow = true;
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.165, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(pick(hairTones, 3), { roughness: 0.9 }));
    hair.position.y = 1.2;
    hair.rotation.x = -0.25;
    body.add(torso, head, hair);

    // Limbs hang from pivots so they can swing while walking.
    const limb = (len: number, r: number, m: THREE.Material, x: number, y: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 3, 8), m);
      mesh.position.y = -len / 2 - r;
      mesh.castShadow = true;
      pivot.add(mesh);
      body.add(pivot);
      return pivot;
    };
    const legL = limb(0.3, 0.07, trousers, -0.09, 0.5);
    const legR = limb(0.3, 0.07, trousers, 0.09, 0.5);
    const armL = limb(0.28, 0.055, cloth, -0.25, 0.98);
    const armR = limb(0.28, 0.055, cloth, 0.25, 0.98);
    armL.rotation.z = 0.12;
    armR.rotation.z = -0.12;

    if (isYou) {
      const apron = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.42, 0.04, 2, 0.02), mat('#1d1b22'));
      apron.position.set(0, 0.72, 0.19);
      body.add(apron);
    }
    if (regular) {
      const badge = new THREE.Mesh(new THREE.OctahedronGeometry(0.07), new THREE.MeshStandardMaterial({ color: '#ffd96a', emissive: '#ffd96a', emissiveIntensity: 1.6 }));
      badge.position.set(0, 1.52, 0);
      g.add(badge);
    }
    g.userData.limbs = { legL, legR, armL, armR, body, phase: seed * 10 };
    if (young) g.scale.setScalar(0.88);
    return g;
  }

  /** Swing arms and legs while moving; settle when standing. */
  private animateLimbs(g: THREE.Group, moving: boolean, t: number): void {
    const L = g.userData.limbs as { legL: THREE.Group; legR: THREE.Group; armL: THREE.Group; armR: THREE.Group; body: THREE.Group; phase: number } | undefined;
    if (!L) return;
    const target = moving ? Math.sin(t * 9 + L.phase) * 0.55 : 0;
    const ease = (o: THREE.Group, v: number) => { o.rotation.x += (v - o.rotation.x) * 0.3; };
    ease(L.legL, target);
    ease(L.legR, -target);
    ease(L.armL, -target * 0.8);
    ease(L.armR, target * 0.8);
    L.body.position.y = moving ? Math.abs(Math.sin(t * 9 + L.phase)) * 0.035 : Math.sin(t * 1.5 + L.phase) * 0.006;
  }

  private spawn(s: Shopper, path: THREE.Vector3[], waits: number[], opts: { delay?: number; hold?: boolean; onArrive?: () => void } = {}): Walker {
    const group = this.makePerson(s.colour ?? ARCHETYPE_COLOUR[s.archetype] ?? '#cccccc', s.regular, false, s.young);
    group.position.copy(path[0]);
    group.visible = !opts.delay;
    this.people.add(group);
    const w: Walker = { group, path, waits, leg: 0, wait: 0, delay: opts.delay ?? 0, hold: !!opts.hold, onArrive: opts.onArrive, moving: false, done: false };
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
      const w = this.spawn({ archetype: 'x', colour: colours[i % 3] }, [spot], [0], { hold: true });
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
    this.post?.setSize(w, h);
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
      w.moving = false;
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
        w.moving = true;
      }
    }
    this.walkers = this.walkers.filter((w) => !w.done);
    const now = performance.now() / 1000;
    for (const w of this.walkers) this.animateLimbs(w.group, w.moving, now);
    if (this.you) this.animateLimbs(this.you, false, now);
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
    this.post.render();
  }
}
