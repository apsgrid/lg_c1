// The Studio's test-run renderer: builds a shop interior or shopfront from a
// ShotSpec (time of day, weather, palette, lights, props, people, camera).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { cityLoc, nightOrders, type GameData, type NightOrder, type ShopState } from '../sim';
import { buildCity3D } from './cityScene3d';
import { buildStreet3D, type RunData } from './streetScene';
import { WALL_KINDS, type PersonSpec, type ShotSpec, type Spot } from '../studio/spec';
import { drawDistrictView, themeFor } from './districtTheme';
import { blobShadowTexture, Post } from './post';
import { buildProp } from './props';

const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });
const glowMat = (color: string, intensity = 2) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.4 });

const SIZES = { small: [8, 6], medium: [10, 7], large: [13, 8] } as const;
const SKY: Record<ShotSpec['time'], [string, string]> = {
  day: ['#8fc0ee', '#cfe0f0'], dusk: ['#ff9a6a', '#3a2a5a'], night: ['#1a2240', '#0b0c18'], late: ['#0c0c1a', '#050509'],
};
const AMBIENT: Record<ShotSpec['time'], number> = { day: 1.3, dusk: 0.85, night: 0.55, late: 0.35 };

function mixHex(a: string, b: string, t: number): string {
  return `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;
}

function gradientTexture(top: string, bottom: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function signTexture(text: string, colour: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 160;
  const ctx = c.getContext('2d')!;
  let size = 100;
  ctx.font = `800 ${size}px "Trebuchet MS", system-ui, sans-serif`;
  while (ctx.measureText(text).width > 940 && size > 30) ctx.font = `800 ${--size}px "Trebuchet MS", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = colour;
  ctx.shadowBlur = 34;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 512, 84);
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = colour;
  ctx.fillText(text, 512, 84);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function disposeTree(o: THREE.Object3D): void {
  o.traverse((x) => {
    const m = x as THREE.Mesh;
    if (!m.isMesh && !(x as THREE.LineSegments).isLineSegments) return;
    m.geometry?.dispose();
    for (const mm of Array.isArray(m.material) ? m.material : [m.material]) {
      const map = (mm as THREE.MeshStandardMaterial).map;
      if (map && !map.userData.shared) map.dispose();
      mm.dispose();
    }
  });
}

export class StudioScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
  readonly controls: OrbitControls;
  private root = new THREE.Group();
  private rain: THREE.LineSegments | null = null;
  private rainBox = { x0: 0, x1: 0, z0: 0, z1: 0, top: 6 };
  private post: Post;
  private active = false;
  private clock = new THREE.Clock();
  spec: ShotSpec | null = null;
  /** The game state the city and street scenes are built from. */
  shopProvider: (() => ShopState) | null = null;
  /** The playable run for the street on screen (null for other scenes). */
  run: RunData | null = null;

  constructor(private container: HTMLElement, private data: GameData) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 1.5;
    this.controls.maxDistance = 30;
    this.scene.add(this.root);
    this.post = new Post(this.renderer, this.scene, this.camera, { bloom: 0.6, envIntensity: 0.45 });
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    this.renderer.setAnimationLoop(on ? () => this.tick() : null);
    if (on) this.resize();
  }

  private resize(): void {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post.setSize?.(w, h);
  }

  private tick(): void {
    const dt = Math.min(0.05, this.clock.getDelta());
    if (this.rain) {
      const pos = this.rain.geometry.getAttribute('position') as THREE.BufferAttribute;
      const b = this.rainBox;
      for (let i = 0; i < pos.count; i += 2) {
        let y = pos.getY(i) - dt * 9;
        if (y < 0) {
          y = b.top;
          const x = b.x0 + Math.random() * (b.x1 - b.x0), z = b.z0 + Math.random() * (b.z1 - b.z0);
          pos.setX(i, x); pos.setZ(i, z); pos.setX(i + 1, x + 0.02); pos.setZ(i + 1, z);
        }
        pos.setY(i, y);
        pos.setY(i + 1, y + 0.35);
      }
      pos.needsUpdate = true;
    }
    this.controls.update();
    this.post.render();
  }

  /** The camera as currently framed (for "use this view"). */
  currentView(): { position: [number, number, number]; target: [number, number, number] } {
    const r = (v: THREE.Vector3) => [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)] as [number, number, number];
    return { position: r(this.camera.position), target: r(this.controls.target) };
  }

  /** The prop groups, by id, for the asset plan's sizes and placements. */
  propNodes(): Map<string, THREE.Object3D> {
    const out = new Map<string, THREE.Object3D>();
    this.root.traverse((o) => { if (o.userData.propId) out.set(o.userData.propId as string, o); });
    return out;
  }

  build(spec: ShotSpec): void {
    this.spec = spec;
    this.scene.remove(this.root);
    disposeTree(this.root);
    this.root = new THREE.Group();
    this.root.name = 'Shot';
    this.scene.add(this.root);
    this.rain = null;
    this.run = null;
    const g = this.root;
    const [W, D] = SIZES[spec.size];
    const night = spec.time === 'night' || spec.time === 'late';
    const [skyTop, skyBottom] = SKY[spec.time];
    // The studio reflection environment reads as daylight: keep it faint at night.
    this.scene.environmentIntensity = night ? 0.12 : spec.time === 'dusk' ? 0.3 : 0.45;

    // Sky, fog and the overall light.
    if (this.scene.background instanceof THREE.Texture) this.scene.background.dispose();
    this.scene.background = gradientTexture(skyTop, skyBottom);
    this.scene.fog = spec.weather.fog > 0.02 ? new THREE.FogExp2(mixHex(skyBottom, '#8a8aa0', 0.25), 0.004 + spec.weather.fog * 0.07) : null;
    const warm = spec.lighting.warmth;
    const keyColour = warm >= 0 ? mixHex('#ffffff', '#ffc890', warm) : mixHex('#ffffff', '#9ab8ff', -warm);
    const hemi = new THREE.HemisphereLight(mixHex(skyTop, '#ffffff', 0.4), '#1a1420', AMBIENT[spec.time] * (0.5 + spec.lighting.key * 0.5));
    hemi.name = 'HemisphereLight';
    const key = new THREE.DirectionalLight(keyColour, spec.lighting.key * (night ? 1.2 : 2.4));
    key.name = 'KeyLight';
    key.position.set(4, 8, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12 });
    g.add(hemi, key, key.target);

    const wet = spec.weather.rain > 0.3;
    if (spec.scene !== 'shop' && this.shopProvider) {
      this.buildWorld(g, spec, key, night, wet);
      return;
    }
    if (spec.setting === 'interior') this.buildInterior(g, spec, W, D, wet);
    else this.buildShopfront(g, spec, W, wet);

    // Props and people.
    const placed = new Map<Spot, number>();
    for (const p of spec.props) {
      const n = placed.get(p.spot) ?? 0;
      placed.set(p.spot, n + 1);
      const obj = buildProp(p, spec.palette.accent, spec.lighting.neon);
      const wall = WALL_KINDS.includes(p.kind as never);
      const at = this.spotAt(spec, p.spot, W, D, n, wall);
      obj.position.set(at.x, at.y, at.z);
      obj.rotation.y += at.rotY;
      obj.name = `prop_${p.id}`;
      obj.userData = { propId: p.id, kind: p.kind, route: p.asset.route, query: p.asset.query, prompt: p.asset.prompt, name: p.name };
      g.add(obj);
    }
    const crowd = new Map<Spot, number>();
    spec.people.forEach((person, i) => {
      const n = crowd.get(person.spot) ?? 0;
      crowd.set(person.spot, n + 1);
      const at = this.spotAt(spec, person.spot, W, D, n + 1, false);
      const body = this.makePerson(person, i, spec);
      const staff = person.role === 'staff';
      if (staff && spec.setting === 'shopfront') {
        // Staff are inside, seen through the window.
        body.position.set(-1.6 + n * 0.8, 0, -0.9);
        body.lookAt(body.position.x, 0, 3);
      } else if (staff && person.spot === 'counter') {
        body.position.set(W / 2 - 1.6 + n * 0.7, 0, -0.35);
        body.lookAt(body.position.x, 0, 3);
      } else {
        body.position.set(at.x, 0, at.z + 0.4);
        body.lookAt(at.x, 0, at.z - 2);
        if (person.spot === 'shelves') body.lookAt(at.x, 0, -D);
        if (spec.setting === 'shopfront') body.lookAt(at.x * 0.8, 0, -1);
      }
      body.name = `person_${i + 1}`;
      g.add(body);
    });

    if (spec.weather.rain > 0.02) this.addRain(spec, W, D);
    this.frame(spec, W, D);
  }

  /** The city, or a run's street: built from the game state, then framed and lit to fit. */
  private buildWorld(g: THREE.Group, spec: ShotSpec, key: THREE.DirectionalLight, night: boolean, wet: boolean): void {
    const shop = this.shopProvider!();
    let focus: THREE.Vector3;
    let dirs: Record<ShotSpec['camera']['shot'], THREE.Vector3>;
    let span: number;
    if (spec.scene === 'city') {
      const city = buildCity3D(shop, this.data, { night, wet });
      g.add(city.group);
      focus = spec.camera.focus === 'room' ? new THREE.Vector3(0, 0, 20) : (city.focus[spec.district] ?? new THREE.Vector3());
      span = spec.camera.focus === 'room' ? 420 : 110;
      dirs = { wide: new THREE.Vector3(0.1, 0.75, 1), medium: new THREE.Vector3(0.5, 0.6, 0.9), close: new THREE.Vector3(0.45, 0.35, 0.9), low: new THREE.Vector3(0.5, 0.04, 0.9), overhead: new THREE.Vector3(0.01, 1, 0.02) };
      if (this.scene.fog instanceof THREE.FogExp2) this.scene.fog.density = 0.0006 + spec.weather.fog * 0.006;
      this.rainBox = { x0: focus.x - 60, x1: focus.x + 60, z0: focus.z - 40, z1: focus.z + 80, top: 40 };
    } else {
      const rival = shop.rivals.find((r) => r.id === spec.street.rival) ?? shop.rivals[0];
      const firebomb = spec.street.mode === 'firebomb';
      const district = firebomb ? rival.loc : spec.district;
      const real = firebomb ? [] : nightOrders(shop, this.data);
      const orders: NightOrder[] = real.length ? real : ['Ana', 'Ben', 'Cal', 'Dee'].map((name, i) => ({ regularId: `r${i}`, name, archetype: 'fruit_fanatic', productId: '', productName: '', price: 0, door: 12 + i * 7 }));
      let seed = 7;
      for (const ch of `${spec.street.mode}:${rival.id}:${district}`) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
      const street = buildStreet3D({
        mode: spec.street.mode, rivalName: rival.name, rivalColour: rival.colour, orders, theme: themeFor(district),
        police: cityLoc(this.data, district)?.police ?? 0.5, seed, aftermath: spec.street.aftermath, night, wet,
      });
      g.add(street.group);
      this.run = street.run;
      focus = (street.targets[0] ?? street.carAt).clone();
      if (spec.camera.focus === 'door' || spec.camera.focus === 'counter') focus = street.carAt.clone().add(new THREE.Vector3(4, 1, 0));
      if (spec.camera.focus === 'room') focus = new THREE.Vector3(Math.min(street.length / 2, 60), 2, -3);
      span = spec.camera.focus === 'room' ? 120 : 40;
      dirs = { wide: new THREE.Vector3(-0.6, 0.55, 1), medium: new THREE.Vector3(-0.4, 0.35, 1), close: new THREE.Vector3(-0.3, 0.25, 1), low: new THREE.Vector3(-0.5, 0.02, 1), overhead: new THREE.Vector3(0.01, 1, 0.05) };
      if (this.scene.fog instanceof THREE.FogExp2) this.scene.fog.density = 0.002 + spec.weather.fog * 0.03;
      this.rainBox = { x0: focus.x - 40, x1: focus.x + 40, z0: -12, z1: 25, top: 18 };
    }
    // Shadows sized to what's on screen.
    key.position.copy(focus).add(new THREE.Vector3(span * 0.3, span * 0.8, span * 0.5));
    key.target.position.copy(focus);
    Object.assign(key.shadow.camera, { left: -span * 0.7, right: span * 0.7, top: span * 0.7, bottom: -span * 0.7, near: 1, far: span * 3 });
    key.shadow.camera.updateProjectionMatrix();
    if (spec.weather.rain > 0.02) this.addRain(spec, 0, 0);
    this.camera.fov = (2 * Math.atan(12 / spec.camera.lens) * 180) / Math.PI;
    this.camera.far = 2000;
    this.camera.updateProjectionMatrix();
    this.controls.maxDistance = 900;
    if (spec.camera.custom) {
      this.camera.position.set(...spec.camera.custom.position);
      this.controls.target.set(...spec.camera.custom.target);
    } else {
      const dist = { wide: 1, medium: 0.6, close: 0.3, low: 0.4, overhead: 1.1 }[spec.camera.shot] * span * (28 / spec.camera.lens) ** 0.5;
      const pos = focus.clone().addScaledVector(dirs[spec.camera.shot].normalize(), dist);
      if (spec.camera.shot === 'low') pos.y = spec.scene === 'city' ? 2 : 0.6;
      this.camera.position.copy(pos);
      this.controls.target.copy(focus).add(new THREE.Vector3(0, spec.camera.shot === 'low' ? (spec.scene === 'city' ? 18 : 3) : 0, 0));
    }
    this.controls.update();
  }

  private spotAt(spec: ShotSpec, spot: Spot, W: number, D: number, n: number, wall: boolean): { x: number; y: number; z: number; rotY: number } {
    const jitter = n * 0.9;
    if (spec.setting === 'shopfront') {
      const m: Record<Spot, [number, number]> = {
        door: [1.4, 1.0], window: [-1.6, 1.2], counter: [-1.6, 1.2], shelves: [-1.0, 1.2], centre: [0, 1.8], outside: [0, 2.6],
        'front-left': [-W / 2 + 0.6, 2.8], 'front-right': [W / 2 - 0.6, 2.8], 'back-left': [-W / 2 + 0.6, 0.7], 'back-right': [W / 2 - 0.6, 0.7],
      };
      const [x, z] = m[spot];
      if (wall) return { x: x + jitter, y: 3.2, z: 0.06, rotY: 0 };
      return { x: x + jitter, y: 0, z, rotY: 0 };
    }
    const cx = W / 2 - 1.8;
    const m: Record<Spot, [number, number]> = {
      counter: [cx - 0.3, 1.4], shelves: [-0.5, -D / 2 + 1.4], door: [-W / 2 + 1.1, D / 2 - 1.3], window: [-W / 2 + 1.0, -D / 2 + 2.0],
      centre: [0, 0.4], 'back-left': [-W / 2 + 1.0, -D / 2 + 0.8], 'back-right': [W / 2 - 0.9, -D / 2 + 0.8],
      'front-left': [-W / 2 + 1.4, D / 2 - 0.4], 'front-right': [W / 2 - 0.8, D / 2 - 0.6], outside: [-W / 2 - 1.6, 0],
    };
    const [x, z] = m[spot];
    if (wall) {
      const backWall = ['back-left', 'back-right', 'shelves', 'centre', 'counter'].includes(spot);
      if (backWall) return { x: x + jitter, y: spot === 'shelves' ? 3.4 : 2.4, z: -D / 2 + 0.03, rotY: 0 };
      return { x: -W / 2 + 0.03, y: 2.3, z: z + jitter, rotY: Math.PI / 2 };
    }
    return { x: x + (spot.startsWith('front') || spot === 'centre' ? jitter : 0), y: 0, z: z + (spot.startsWith('front') || spot === 'centre' ? 0 : jitter * 0.6), rotY: spot === 'back-left' || spot === 'window' ? Math.PI / 4 : spot === 'back-right' ? -Math.PI / 4 : 0 };
  }

  private districtWindow(spec: ShotSpec, w: number, h: number): THREE.Mesh {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = Math.round(512 * (h / w));
    const theme = themeFor(spec.district);
    drawDistrictView(c, cityLoc(this.data, spec.district), { ...theme, view: [SKY[spec.time][0], spec.time === 'day' ? theme.view[1] : mixHex(theme.view[1], '#000000', 0.6)] });
    const ctx = c.getContext('2d')!;
    if (spec.weather.rain > 0.02) {
      ctx.strokeStyle = 'rgba(200,220,255,0.35)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 80 * spec.weather.rain; i++) {
        const x = Math.random() * c.width, y = Math.random() * c.height, l = 10 + Math.random() * 30;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 2, y + l); ctx.stroke();
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  }

  private shelvesAndStock(g: THREE.Group, spec: ShotSpec, x: number, z: number, width: number): void {
    const wood = mat(spec.style === 'premium' ? '#2a2420' : mixHex(spec.palette.wall, '#6a5a7a', 0.5));
    const colours = [spec.palette.accent, spec.palette.accent2, '#ffd27a', '#9cff3a', '#c69bff', '#f2f2f8'];
    for (let r = 0; r < 2; r++) {
      const shelf = new THREE.Mesh(new RoundedBoxGeometry(width, 0.1, 0.6, 2, 0.03), wood);
      shelf.position.set(x, 0.9 + r * 1.2, z);
      shelf.castShadow = shelf.receiveShadow = true;
      g.add(shelf);
      for (let k = 0; k < Math.floor(width / 0.32); k++) {
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.26, 0.12), mat(colours[(k + r) % colours.length], { roughness: 0.35, metalness: 0.2 }));
        box.position.set(x - width / 2 + 0.25 + k * 0.32, 1.08 + r * 1.2, z);
        box.castShadow = true;
        g.add(box);
      }
      const strip = new THREE.Mesh(new THREE.BoxGeometry(width, 0.02, 0.02), glowMat(spec.palette.accent2, 1.4 * spec.lighting.neon));
      strip.position.set(x, 0.84 + r * 1.2, z + 0.31);
      g.add(strip);
    }
  }

  private buildInterior(g: THREE.Group, spec: ShotSpec, W: number, D: number, wet: boolean): void {
    const premium = spec.style === 'premium';
    const gritty = spec.style === 'gritty';
    // Plinth, pavement strip outside the door, floor.
    const outW = 3.2;
    const plinth = new THREE.Mesh(new RoundedBoxGeometry(W + outW + 0.4, 0.5, D + 0.6, 2, 0.06), mat('#1b1826', { roughness: 0.7 }));
    plinth.position.set(-outW / 2, -0.26, 0);
    plinth.receiveShadow = true;
    const pave = new THREE.Mesh(new THREE.PlaneGeometry(outW, D + 0.4), mat('#3a3844', { roughness: wet ? 0.12 : 0.9, metalness: wet ? 0.3 : 0 }));
    pave.rotation.x = -Math.PI / 2;
    pave.position.set(-W / 2 - outW / 2, 0.002, 0);
    pave.receiveShadow = true;
    pave.name = 'pavement';
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), mat(spec.palette.floor, { roughness: premium ? 0.2 : gritty ? 0.95 : 0.6, metalness: premium ? 0.15 : 0 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.name = 'floor';
    const edge = new THREE.Mesh(new THREE.BoxGeometry(W + outW + 0.4, 0.04, 0.04), glowMat(spec.palette.accent, 0.7 * spec.lighting.neon));
    edge.position.set(-outW / 2, -0.12, D / 2 + 0.31);
    g.add(plinth, pave, floor, edge);
    // Walls with a doorway and a window onto the district.
    const wallMat = mat(spec.palette.wall, { roughness: gritty ? 0.95 : 0.8 });
    const back = new THREE.Mesh(new THREE.BoxGeometry(W + 0.2, 4.5, 0.2), wallMat);
    back.position.set(-0.1, 2.25, -D / 2 - 0.1);
    back.name = 'wall_back';
    const doorZ = D / 2 - 1.3, half = 0.65, top = 2.7;
    const z0 = -D / 2 - 0.2, z1 = D / 2;
    const sideA = new THREE.Mesh(new THREE.BoxGeometry(0.2, 4.5, doorZ - half - z0), wallMat);
    sideA.position.set(-W / 2 - 0.1, 2.25, (z0 + doorZ - half) / 2);
    const sideB = new THREE.Mesh(new THREE.BoxGeometry(0.2, 4.5, z1 - doorZ - half), wallMat);
    sideB.position.set(-W / 2 - 0.1, 2.25, (doorZ + half + z1) / 2);
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.2, 4.5 - top, half * 2), wallMat);
    lintel.position.set(-W / 2 - 0.1, (4.5 + top) / 2, doorZ);
    for (const m of [back, sideA, sideB, lintel]) { m.receiveShadow = true; m.castShadow = true; }
    sideA.name = 'wall_side';
    g.add(back, sideA, sideB, lintel);
    const win = this.districtWindow(spec, 2.4, 1.5);
    win.rotation.y = Math.PI / 2;
    win.position.set(-W / 2 + 0.02, 2.0, -D / 2 + 2.0);
    win.name = 'window_view';
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.65, 2.55), mat('#16141c', { metalness: 0.5, roughness: 0.4 }));
    frame.position.set(-W / 2, 2.0, -D / 2 + 2.0);
    g.add(frame, win);
    // Counter, till, shelves of stock, shop sign.
    const cx = W / 2 - 1.8;
    const counter = new THREE.Mesh(new RoundedBoxGeometry(2.0, 1.0, 0.8, 3, 0.06), mat(premium ? '#e9e2d6' : mixHex(spec.palette.wall, '#3a3248', 0.5), { roughness: 0.4, metalness: 0.3 }));
    counter.position.set(cx, 0.5, 0.6);
    counter.castShadow = counter.receiveShadow = true;
    counter.name = 'counter';
    const till = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.3, 0.4, 2, 0.04), glowMat('#3ddc84', 0.2));
    till.position.set(cx + 0.4, 1.15, 0.6);
    const front = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.03, 0.02), glowMat(spec.palette.accent, 1.6 * spec.lighting.neon));
    front.position.set(cx, 0.95, 1.01);
    g.add(counter, till, front);
    this.shelvesAndStock(g, spec, -0.5, -D / 2 + 0.35, Math.min(W - 3, 6));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(W - 1, 5), 0.8), new THREE.MeshBasicMaterial({ map: signTexture(spec.sign, spec.palette.accent), transparent: true, toneMapped: false }));
    sign.position.set(0, 3.85, -D / 2 + 0.02);
    sign.name = 'shop_sign';
    g.add(sign);
    // Pendant lamps and the neon wash.
    for (const x of [-W / 4, 0.1 * W, W / 4 + 0.6]) {
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.26, 20, 1, true), mat(premium ? '#d8b56a' : '#1d1b22', { side: THREE.DoubleSide, metalness: 0.5, roughness: 0.4 }));
      shade.position.set(x, 3.5, 0.3);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), glowMat(spec.lighting.warmth >= 0 ? '#ffd9a0' : '#e0ecff', 3));
      bulb.position.set(x, 3.38, 0.3);
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.9, 4), mat('#111'));
      cord.position.set(x, 4.05, 0.3);
      g.add(shade, bulb, cord);
    }
    const pendant = new THREE.PointLight(spec.lighting.warmth >= 0 ? '#ffd9a0' : '#e0ecff', 10 * (0.4 + spec.lighting.key * 0.6), 10);
    pendant.position.set(0, 3.2, 0.5);
    pendant.name = 'PendantLight';
    const neonA = new THREE.PointLight(spec.palette.accent, 14 * spec.lighting.neon, 10);
    neonA.position.set(-W / 4, 3, -D / 2 + 1);
    neonA.name = 'NeonA';
    const neonB = new THREE.PointLight(spec.palette.accent2, 12 * spec.lighting.neon, 10);
    neonB.position.set(W / 4, 3, -D / 2 + 1);
    neonB.name = 'NeonB';
    const street = new THREE.PointLight('#ffcf8a', 8, 7);
    street.position.set(-W / 2 - 2.4, 3.3, 0);
    street.name = 'StreetLamp';
    g.add(pendant, neonA, neonB, street);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 3.6, 8), mat('#3a3844', { metalness: 0.6 }));
    pole.position.set(-W / 2 - 2.6, 1.8, -0.4);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), glowMat('#ffe6b0', 2.5));
    head.position.set(-W / 2 - 2.6, 3.65, -0.4);
    g.add(pole, head);
    this.rainBox = { x0: -W / 2 - outW, x1: -W / 2 - 0.2, z0: -D / 2, z1: D / 2, top: 5 };
  }

  private buildShopfront(g: THREE.Group, spec: ShotSpec, W: number, wet: boolean): void {
    const theme = themeFor(spec.district);
    // Street: pavement, kerb, road with wet sheen, plinth.
    const plinth = new THREE.Mesh(new RoundedBoxGeometry(W + 9, 0.5, 11, 2, 0.06), mat('#1b1826', { roughness: 0.7 }));
    plinth.position.set(0, -0.26, 4.5);
    const pave = new THREE.Mesh(new THREE.PlaneGeometry(W + 8.8, 3.4), mat('#45434f', { roughness: wet ? 0.1 : 0.85, metalness: wet ? 0.35 : 0 }));
    pave.rotation.x = -Math.PI / 2;
    pave.position.set(0, 0.002, 1.7);
    pave.name = 'pavement';
    const kerb = new THREE.Mesh(new THREE.BoxGeometry(W + 8.8, 0.12, 0.2), mat('#6a6874'));
    kerb.position.set(0, 0.06, 3.4);
    const road = new THREE.Mesh(new THREE.PlaneGeometry(W + 8.8, 6.4), mat('#1f1e26', { roughness: wet ? 0.06 : 0.9, metalness: wet ? 0.45 : 0 }));
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, -0.01, 6.7);
    road.name = 'road';
    for (let x = -W / 2 - 4; x < W / 2 + 4; x += 2.4) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.12), new THREE.MeshBasicMaterial({ color: '#d9c060' }));
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(x, 0.0, 7);
      g.add(dash);
    }
    g.add(plinth, pave, kerb, road);
    // The shop's facade: big window into a glowing interior, door, sign, awning.
    const wallMat = mat(spec.palette.wall, { roughness: spec.style === 'gritty' ? 0.95 : 0.7 });
    const hgt = 4.6;
    const face = (x0: number, x1: number, y0: number, y1: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, 0.3), wallMat);
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, -0.15);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
    };
    const winX0 = -W / 2 + 0.6, winX1 = 0.4, doorX0 = 0.9, doorX1 = 2.1;
    face(-W / 2, W / 2, 3.0, hgt);
    face(-W / 2, winX0, 0, 3.0);
    face(winX1, doorX0, 0, 3.0);
    face(doorX1, W / 2, 0, 3.0);
    face(winX0, winX1, 0, 0.5);
    const interior = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.2, 3.0), new THREE.MeshBasicMaterial({ map: gradientTexture(mixHex(spec.palette.accent, '#ffffff', 0.55), mixHex(spec.palette.accent2, '#101018', 0.4)), toneMapped: false }));
    interior.position.set(0, 1.5, -1.6);
    interior.name = 'interior_glow';
    g.add(interior);
    this.shelvesAndStock(g, spec, (winX0 + winX1) / 2, -1.2, winX1 - winX0 - 0.4);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(winX1 - winX0, 2.5), new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.05, metalness: 0, transmission: 0.95, thickness: 0.02, transparent: true, opacity: 0.18 }));
    glass.position.set((winX0 + winX1) / 2, 1.75, -0.02);
    glass.name = 'window_glass';
    const door = new THREE.Mesh(new THREE.PlaneGeometry(doorX1 - doorX0, 2.6), new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.05, transmission: 0.9, transparent: true, opacity: 0.25 }));
    door.position.set((doorX0 + doorX1) / 2, 1.3, -0.05);
    door.name = 'door';
    g.add(glass, door);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(W - 1, 6), 0.95), new THREE.MeshBasicMaterial({ map: signTexture(spec.sign, spec.palette.accent), transparent: true, toneMapped: false }));
    sign.position.set(0, 3.75, 0.02);
    sign.name = 'shop_sign';
    g.add(sign);
    const awning = new THREE.Mesh(new THREE.BoxGeometry(winX1 - winX0 + 0.3, 0.08, 1.1), mat(spec.palette.accent2, { roughness: 0.8 }));
    awning.position.set((winX0 + winX1) / 2, 3.05, 0.5);
    awning.rotation.x = 0.25;
    awning.castShadow = true;
    g.add(awning);
    // Neighbours and the skyline beyond.
    for (const side of [-1, 1]) {
      const n = new THREE.Mesh(new THREE.BoxGeometry(4, 5.4 + side * 0.6, 0.5), mat(mixHex(theme.wall, '#14121c', 0.35), { roughness: 0.9 }));
      n.position.set(side * (W / 2 + 2), (5.4 + side * 0.6) / 2, -0.3);
      n.receiveShadow = true;
      g.add(n);
      for (let k = 0; k < 4; k++) {
        const w2 = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.9), spec.time === 'day' ? mat('#9fb8d0') : glowMat(k % 3 ? '#ffd27a' : '#2a2838', k % 3 ? 0.8 : 0));
        w2.position.set(side * (W / 2 + 2) - 1.2 + (k % 2) * 2.2, 2.2 + Math.floor(k / 2) * 1.6, -0.04);
        g.add(w2);
      }
    }
    const sky = this.districtWindow(spec, W + 14, 7);
    sky.position.set(0, 5.5, -6);
    sky.name = 'skyline';
    g.add(sky);
    // Light: interior glow spilling out, the sign's neon, a street lamp.
    const spill = new THREE.PointLight(spec.palette.accent, 16 * spec.lighting.neon, 9);
    spill.position.set(-1, 1.8, 0.8);
    spill.name = 'ShopGlow';
    const spill2 = new THREE.PointLight(spec.palette.accent2, 10 * spec.lighting.neon, 8);
    spill2.position.set(2, 3.4, 1.0);
    spill2.name = 'SignGlow';
    const lamp = new THREE.PointLight('#ffcf8a', 14, 10);
    lamp.position.set(W / 2 + 1, 4.2, 3.0);
    lamp.name = 'StreetLamp';
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 4.6, 8), mat('#3a3844', { metalness: 0.6 }));
    pole.position.set(W / 2 + 1, 2.3, 3.2);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), glowMat('#ffe6b0', 2.5));
    head.position.set(W / 2 + 1, 4.6, 3.2);
    g.add(spill, spill2, lamp, pole, head);
    this.rainBox = { x0: -W / 2 - 4, x1: W / 2 + 4, z0: 0.2, z1: 9.5, top: 7 };
  }

  private addRain(spec: ShotSpec, W: number, D: number): void {
    void W; void D;
    const n = Math.round(400 + spec.weather.rain * 2600);
    const pos = new Float32Array(n * 6);
    const b = this.rainBox;
    for (let i = 0; i < n; i++) {
      const x = b.x0 + Math.random() * (b.x1 - b.x0), y = Math.random() * b.top, z = b.z0 + Math.random() * (b.z1 - b.z0);
      pos.set([x, y, z, x + 0.02, y + 0.35, z], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#b8c8ff', transparent: true, opacity: 0.35 }));
    this.rain.userData.noExport = true;
    this.rain.frustumCulled = false;
    this.root.add(this.rain);
  }

  private frame(spec: ShotSpec, W: number, D: number): void {
    this.camera.far = 200;
    this.controls.maxDistance = 30;
    this.camera.fov = (2 * Math.atan(12 / spec.camera.lens) * 180) / Math.PI;
    this.camera.updateProjectionMatrix();
    if (spec.camera.custom) {
      this.camera.position.set(...spec.camera.custom.position);
      this.controls.target.set(...spec.camera.custom.target);
      this.controls.update();
      return;
    }
    const front = spec.setting === 'shopfront';
    const focus: Record<ShotSpec['camera']['focus'], [number, number, number]> = front
      ? { room: [0, 2.0, 0], counter: [-1.2, 1.6, 0], shelves: [-1.4, 1.6, -0.5], door: [1.5, 1.3, 0.5], window: [-1.6, 1.6, 0] }
      : { room: [-0.3, 1.0, 0], counter: [W / 2 - 1.9, 1.1, 0.8], shelves: [-0.5, 1.4, -D / 2 + 0.5], door: [-W / 2 + 0.6, 1.2, D / 2 - 1.3], window: [-W / 2 + 0.3, 1.9, -D / 2 + 2] };
    const t = new THREE.Vector3(...focus[spec.camera.focus]);
    const span = front ? W + 4 : Math.max(W, D) + 2;
    const dist = { wide: 1.05, medium: 0.62, close: 0.32, low: 0.55, overhead: 0.9 }[spec.camera.shot] * span * (28 / spec.camera.lens) ** 0.5;
    const dir = {
      wide: new THREE.Vector3(0.18, 0.5, 1), medium: new THREE.Vector3(0.22, 0.32, 1), close: new THREE.Vector3(0.15, 0.18, 1),
      low: new THREE.Vector3(0.2, 0.02, 1), overhead: new THREE.Vector3(0.05, 1.6, 0.55),
    }[spec.camera.shot].normalize();
    const pos = t.clone().addScaledVector(dir, dist);
    if (spec.camera.shot === 'low') pos.y = 0.45;
    this.camera.position.copy(pos);
    this.controls.target.copy(t);
    this.controls.update();
  }

  private makePerson(p: PersonSpec, i: number, spec: ShotSpec): THREE.Group {
    const g = new THREE.Group();
    const seed = (i * 0.618 + 0.13) % 1;
    const pickC = <T,>(arr: T[], k: number) => arr[Math.floor(((seed * 9301 + k * 49297) % 1) * arr.length) % arr.length];
    const skin = mat(pickC(['#f1d3b8', '#e0b48f', '#c68e63', '#9a6440', '#6e452a'], 1), { roughness: 0.7 });
    const clothes = p.colour ?? (p.role === 'staff' ? spec.palette.accent : pickC(['#ff6f7d', '#9aa3b5', '#5ad7ff', '#c69bff', '#ffc145', '#3ddc84', '#2a2c3a'], 2));
    const cloth = mat(clothes, { roughness: 0.7 });
    const legs = mat(pickC(['#2a2c3a', '#3a3a44', '#4a3b2c', '#1f2a3d'], 3), { roughness: 0.8 });
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.012;
    shadow.userData.noExport = true;
    g.add(shadow);
    const sit = p.pose === 'sit';
    const lift = sit ? -0.32 : 0;
    const part = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.rotation.x = rx;
      mesh.castShadow = true;
      g.add(mesh);
    };
    part(new THREE.CapsuleGeometry(0.2, 0.36, 4, 12), cloth, 0, 1.0 + lift, 0);
    part(new THREE.SphereGeometry(0.16, 18, 14), skin, 0, 1.47 + lift, 0);
    part(new THREE.SphereGeometry(0.17, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(pickC(['#2b1d14', '#5a3a22', '#a8743d', '#e3c27a', '#1d1b22', '#b8432f'], 4), { roughness: 0.9 }), 0, 1.5 + lift, -0.01, -0.25);
    for (const x of [-0.1, 0.1]) part(new THREE.CapsuleGeometry(0.075, 0.42, 3, 8), legs, x, sit ? 0.42 : 0.33, sit ? 0.2 : 0, sit ? Math.PI / 2 : 0);
    const reach = p.pose === 'browse' ? -0.9 : p.pose === 'lean' ? -0.5 : 0;
    for (const x of [-0.27, 0.27]) part(new THREE.CapsuleGeometry(0.058, 0.36, 3, 8), cloth, x, 1.0 + lift, reach ? 0.12 : 0, x > 0 ? reach : 0);
    if (p.role === 'regular') part(new THREE.OctahedronGeometry(0.07), glowMat('#ffd96a', 1.6), 0, 1.85 + lift, 0);
    return g;
  }
}
