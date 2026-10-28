import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { SHELF_SLOTS, type DayReport, type GameData, type ShopState, type Visit } from '../sim';
import { drawLabel } from './label';

const ARCHETYPE_COLOUR: Record<string, string> = {
  fruit_fanatic: '#ff6f7d', anti_sweet: '#9aa3b5', ice_fan: '#5ad7ff',
  novelty_seeker: '#c69bff', budget_buyer: '#ffc145', brand_loyalist: '#3ddc84',
};

const DOOR = new THREE.Vector3(-3.4, 0, 2.2);
const OUTSIDE = new THREE.Vector3(-4.6, 0, 2.2);
const COUNTER = new THREE.Vector3(2.0, 0, 1.0);

interface Walker {
  group: THREE.Group;
  path: THREE.Vector3[];
  waits: number[];
  leg: number;
  wait: number;
  delay: number;
  visit: Visit;
  popped: Set<number>;
  done: boolean;
}

interface Floater {
  sprite: THREE.Sprite;
  life: number;
}

function textSprite(text: string, colour: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const ctx = c.getContext('2d')!;
  ctx.font = '800 56px system-ui, sans-serif';
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
  s.scale.set(0.9, 0.34, 1);
  s.renderOrder = 10;
  return s;
}

export class ShopScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private clock = new THREE.Clock();
  private slots: THREE.Group[] = [];
  private signCanvas = document.createElement('canvas');
  private signTex: THREE.CanvasTexture;
  private walkers: Walker[] = [];
  private floaters: Floater[] = [];
  private finish: (() => void) | null = null;
  private active = false;
  private slotPos: THREE.Vector3[] = [];

  constructor(private container: HTMLElement, private data: GameData) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color('#14121c');
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.camera.position.set(1.2, 5.2, 8.4);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.0, 0);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 14;
    this.controls.maxPolarAngle = Math.PI * 0.46;

    this.signCanvas.width = 1024;
    this.signCanvas.height = 160;
    this.signTex = new THREE.CanvasTexture(this.signCanvas);
    this.signTex.colorSpace = THREE.SRGBColorSpace;

    this.build();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    this.renderer.setAnimationLoop(on ? () => this.tick() : null);
    if (on) this.resize();
  }

  private build(): void {
    this.scene.add(new THREE.HemisphereLight('#d9d4ff', '#2a1f2e', 0.9));
    const key = new THREE.DirectionalLight('#fff4e6', 2.0);
    key.position.set(3, 7, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6 });
    this.scene.add(key);
    const neonA = new THREE.PointLight('#ff4fa3', 14, 9);
    neonA.position.set(-2.5, 3, -1.5);
    const neonB = new THREE.PointLight('#3ad7ff', 12, 9);
    neonB.position.set(2.5, 3, -1.5);
    this.scene.add(neonA, neonB);

    // Floor with a checker rug, walls.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 7), new THREE.MeshStandardMaterial({ color: '#2b2735', roughness: 0.8 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2), new THREE.MeshStandardMaterial({ color: '#3a2a4a', roughness: 0.9 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(-0.4, 0.005, 1.0);
    rug.receiveShadow = true;
    this.scene.add(rug);
    const wallMat = new THREE.MeshStandardMaterial({ color: '#221e2c', roughness: 0.9 });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(10, 4.5), wallMat);
    back.position.set(0, 2.25, -2.2);
    back.receiveShadow = true;
    const side = new THREE.Mesh(new THREE.PlaneGeometry(7, 4.5), wallMat);
    side.rotation.y = Math.PI / 2;
    side.position.set(-5, 2.25, 0.5);
    this.scene.add(back, side);

    // Shop sign.
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 0.72), new THREE.MeshBasicMaterial({ map: this.signTex, transparent: true }));
    sign.position.set(0, 3.7, -2.18);
    this.scene.add(sign);

    // Shelving: two rows of three display slots.
    const wood = new THREE.MeshStandardMaterial({ color: '#4b3f5c', roughness: 0.6 });
    for (let r = 0; r < 2; r++) {
      const shelf = new THREE.Mesh(new RoundedBoxGeometry(5.4, 0.1, 0.7, 2, 0.03), wood);
      shelf.position.set(0, 0.9 + r * 1.25, -1.8);
      shelf.castShadow = shelf.receiveShadow = true;
      this.scene.add(shelf);
    }
    for (let i = 0; i < SHELF_SLOTS; i++) {
      const g = new THREE.Group();
      const row = Math.floor(i / 3);
      const col = i % 3;
      g.position.set(-1.8 + col * 1.8, 0.95 + row * 1.25, -1.75);
      this.scene.add(g);
      this.slots.push(g);
      this.slotPos.push(new THREE.Vector3(g.position.x, 0, -0.7));
    }

    // Counter + till.
    const counter = new THREE.Mesh(new RoundedBoxGeometry(1.8, 1.0, 0.8, 3, 0.06), new THREE.MeshStandardMaterial({ color: '#3a3248', roughness: 0.4, metalness: 0.3 }));
    counter.position.set(COUNTER.x + 0.6, 0.5, COUNTER.z - 0.2);
    counter.castShadow = counter.receiveShadow = true;
    const till = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.3, 0.4, 2, 0.04), new THREE.MeshStandardMaterial({ color: '#16141c', emissive: '#3ddc84', emissiveIntensity: 0.15 }));
    till.position.set(COUNTER.x + 0.9, 1.15, COUNTER.z - 0.2);
    this.scene.add(counter, till);

    // Door frame.
    const frameMat = new THREE.MeshStandardMaterial({ color: '#16141c', metalness: 0.6, roughness: 0.3 });
    for (const dz of [-0.6, 0.6]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.6, 0.12), frameMat);
      post.position.set(-4.9, 1.3, DOOR.z + dz);
      this.scene.add(post);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1.32), frameMat);
    lintel.position.set(-4.9, 2.6, DOOR.z);
    const doorGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.5), new THREE.MeshBasicMaterial({ color: '#ffe9b0', transparent: true, opacity: 0.18 }));
    doorGlow.rotation.y = Math.PI / 2;
    doorGlow.position.set(-4.95, 1.25, DOOR.z);
    this.scene.add(lintel, doorGlow);
  }

  private drawSign(name: string): void {
    const ctx = this.signCanvas.getContext('2d')!;
    const W = this.signCanvas.width, H = this.signCanvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.font = '800 96px "Trebuchet MS", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#ff4fa3';
    ctx.shadowBlur = 30;
    ctx.fillStyle = '#ffd1ea';
    let size = 96;
    while (ctx.measureText(name).width > W * 0.92 && size > 40) ctx.font = `800 ${--size}px "Trebuchet MS", system-ui, sans-serif`;
    ctx.fillText(name, W / 2, H / 2);
    this.signTex.needsUpdate = true;
  }

  /** Rebuild shelf displays: one device per listing plus boxes for stock. */
  setShop(shop: ShopState): void {
    this.drawSign(shop.name || 'My Vape Store');
    this.slots.forEach((g, i) => {
      for (const child of [...g.children]) {
        g.remove(child);
        child.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.geometry.dispose();
            const m = o.material as THREE.MeshStandardMaterial;
            m.map?.dispose();
            m.dispose();
          }
        });
      }
      const l = shop.listings[i];
      if (!l) return;
      const p = l.product;
      const empty = l.stock <= 0;
      const body = new THREE.Mesh(
        new RoundedBoxGeometry(0.38, 0.8, 0.2, 4, 0.06),
        new THREE.MeshStandardMaterial({ color: p.brand.labelColour, roughness: 0.35, metalness: 0.5, transparent: empty, opacity: empty ? 0.35 : 1 }),
      );
      body.position.y = 0.42;
      body.castShadow = true;
      const canvas = document.createElement('canvas');
      canvas.width = 192;
      canvas.height = 320;
      drawLabel(canvas, p.brand, p.notes, this.data);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const label = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.5), new THREE.MeshStandardMaterial({ map: tex, transparent: empty, opacity: empty ? 0.35 : 1 }));
      label.position.set(0, 0.42, 0.101);
      g.add(body, label);
      const boxMat = new THREE.MeshStandardMaterial({ color: p.brand.labelColour, roughness: 0.6 });
      const n = Math.min(10, l.stock);
      for (let k = 0; k < n; k++) {
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.12), boxMat);
        const side = k % 2 === 0 ? -1 : 1;
        const idx = Math.floor(k / 2);
        box.position.set(side * (0.34 + (idx % 3) * 0.18), 0.11 + Math.floor(idx / 3) * 0.23, -0.05);
        box.castShadow = true;
        g.add(box);
      }
    });
  }

  private makeCustomer(v: Visit): THREE.Group {
    const g = new THREE.Group();
    const colour = ARCHETYPE_COLOUR[v.archetype] ?? '#cccccc';
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.55, 4, 12), new THREE.MeshStandardMaterial({ color: colour, roughness: 0.6 }));
    body.position.y = 0.5;
    body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), new THREE.MeshStandardMaterial({ color: '#f1d3b8', roughness: 0.7 }));
    head.position.y = 1.08;
    head.castShadow = true;
    g.add(body, head);
    if (v.regularId) {
      // Regulars wear a little star badge.
      const badge = new THREE.Mesh(new THREE.OctahedronGeometry(0.07), new THREE.MeshStandardMaterial({ color: '#ffd96a', emissive: '#ffd96a', emissiveIntensity: 0.6 }));
      badge.position.set(0, 1.42, 0);
      g.add(badge);
    }
    g.position.copy(OUTSIDE);
    return g;
  }

  /** Walk the day's visitors through the shop. Resolves when everyone has left (or on skip). */
  playDay(report: DayReport, shop: ShopState): Promise<void> {
    this.skip();
    const n = report.visits.length;
    const gap = Math.min(0.7, 7 / Math.max(1, n));
    const indexOf = (pid?: string) => shop.listings.findIndex((l) => l.product.id === pid);
    report.visits.forEach((v, i) => {
      const jitter = new THREE.Vector3((i % 3 - 1) * 0.25, 0, ((i * 7) % 3 - 1) * 0.2);
      const idx = indexOf(v.productId);
      const browse = idx >= 0 ? idx : i % Math.max(1, shop.listings.length);
      const shelf = (this.slotPos[browse] ?? new THREE.Vector3(0, 0, -0.7)).clone().add(jitter);
      const path = [OUTSIDE.clone(), DOOR.clone(), shelf];
      const waits = [0, 0, 0.5];
      if (v.qty > 0 && !v.caught) {
        path.push(COUNTER.clone().add(new THREE.Vector3(0, 0, 0.5)).add(jitter.clone().multiplyScalar(0.5)));
        waits.push(0.4);
      }
      if (v.walkout === 'banned') path.splice(2);
      path.push(DOOR.clone(), OUTSIDE.clone());
      waits.push(0, 0);
      const group = this.makeCustomer(v);
      group.visible = false;
      this.scene.add(group);
      this.walkers.push({ group, path, waits, leg: 0, wait: 0, delay: i * gap, visit: v, popped: new Set(), done: false });
    });
    return new Promise((resolve) => {
      this.finish = resolve;
      if (!n) this.skip();
    });
  }

  skip(): void {
    for (const w of this.walkers) this.scene.remove(w.group);
    for (const f of this.floaters) this.scene.remove(f.sprite);
    this.walkers = [];
    this.floaters = [];
    const f = this.finish;
    this.finish = null;
    f?.();
  }

  private pop(text: string, colour: string, at: THREE.Vector3): void {
    const s = textSprite(text, colour);
    s.position.copy(at).add(new THREE.Vector3(0, 1.7, 0));
    this.scene.add(s);
    this.floaters.push({ sprite: s, life: 1.4 });
  }

  private resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = Math.min(60, 42 * Math.max(1, 1.4 / this.camera.aspect) ** 0.55);
    this.camera.updateProjectionMatrix();
  }

  private tick(): void {
    const dt = Math.min(0.05, this.clock.getDelta());
    const speed = 2.4;
    for (const w of this.walkers) {
      if (w.done) continue;
      if (w.delay > 0) {
        w.delay -= dt;
        continue;
      }
      w.group.visible = true;
      if (w.wait > 0) {
        w.wait -= dt;
        continue;
      }
      const target = w.path[w.leg + 1];
      if (!target) {
        w.done = true;
        this.scene.remove(w.group);
        continue;
      }
      const pos = w.group.position;
      const to = target.clone().sub(pos);
      const dist = to.length();
      const step = speed * dt;
      if (dist <= step) {
        pos.copy(target);
        w.leg++;
        w.wait = w.waits[w.leg] ?? 0;
        const v = w.visit;
        // Pop-ups at the shelf (decision) and at the counter (sale).
        if (w.leg === 2 && !w.popped.has(2)) {
          w.popped.add(2);
          if (v.caught) this.pop('Caught!', '#ff5a6a', pos);
          else if (v.walkout === 'stockout') this.pop('Sold out', '#ff5a6a', pos);
          else if (v.walkout === 'nothing') this.pop('…', '#a39fbb', pos);
          else if (v.walkout === 'banned') this.pop('Banned', '#ff5a6a', pos);
        }
        if (w.leg === 3 && v.qty > 0 && !v.caught && !w.popped.has(3)) {
          w.popped.add(3);
          this.pop(`+${Math.round(v.spent)} cr`, '#3ddc84', pos);
        }
      } else {
        pos.addScaledVector(to.normalize(), step);
        w.group.rotation.y = Math.atan2(to.x, to.z);
        w.group.position.y = Math.abs(Math.sin(performance.now() / 110)) * 0.04;
      }
    }
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
    if (this.finish && this.walkers.length && this.walkers.every((w) => w.done)) {
      this.walkers = [];
      const f = this.finish;
      this.finish = null;
      f();
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
