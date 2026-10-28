import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { GameData, Product } from '../sim/types';
import { drawLabel } from './label';

interface Puff {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
}

interface Sparkle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
}

export interface BottlePick {
  noteId: string;
  clientX: number;
  clientY: number;
}

function softSprite(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Mix note colours by amount; falls back to the base liquid colour. */
export function liquidColour(product: Product, data: GameData): THREE.Color {
  const base = data.bases.find((b) => b.id === product.base);
  const out = new THREE.Color(base?.liquidColour ?? '#cccccc');
  const active = product.notes.filter((n) => n.amount > 0);
  const total = active.reduce((s, n) => s + n.amount, 0);
  if (total === 0) return out;
  const mix = new THREE.Color(0, 0, 0);
  for (const n of active) {
    const def = data.notes.find((d) => d.id === n.noteId);
    if (def) mix.add(new THREE.Color(def.colour).multiplyScalar(n.amount / total));
  }
  return out.lerp(mix, 0.75);
}

export class LabScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  onBottlePointerDown: ((pick: BottlePick) => void) | null = null;
  onBottleHover: ((noteId: string | null, x: number, y: number) => void) | null = null;

  private clock = new THREE.Clock();
  private device = new THREE.Group();
  private body!: THREE.Mesh;
  private bodyMat!: THREE.MeshStandardMaterial;
  private liquid!: THREE.Mesh;
  private liquidMat!: THREE.MeshPhysicalMaterial;
  private led!: THREE.MeshStandardMaterial;
  private labelCanvas = document.createElement('canvas');
  private labelTex: THREE.CanvasTexture;
  private bottles: THREE.Group[] = [];
  private hovered: THREE.Group | null = null;
  private usedNotes = new Set<string>();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  private targetFill = 0.4;
  private fill = 0.4;
  private targetLiquid = new THREE.Color('#ff9aa8');
  private shake = 0;
  private glow = 0;

  private puffs: Puff[] = [];
  private puffPoints: THREE.Points;
  private puffColour = new THREE.Color('#ffffff');
  private sparkles: Sparkle[] = [];
  private sparklePoints: THREE.Points;
  private ring: THREE.Mesh;
  private ringT = -1;

  constructor(private container: HTMLElement, private data: GameData) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color('#14121c');
    this.scene.fog = new THREE.Fog('#14121c', 9, 20);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    this.camera.position.set(0.6, 2.7, 6.6);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.5, 0);
    this.controls.enableDamping = true;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 11;
    this.controls.maxPolarAngle = Math.PI * 0.52;
    this.controls.enablePan = false;

    this.labelCanvas.width = 384;
    this.labelCanvas.height = 640;
    this.labelTex = new THREE.CanvasTexture(this.labelCanvas);
    this.labelTex.colorSpace = THREE.SRGBColorSpace;
    this.labelTex.anisotropy = 4;

    this.buildLights();
    this.buildRoom();
    this.buildDevice();
    this.buildShelf();

    const sprite = softSprite();
    this.puffPoints = this.makePoints(400, sprite, 0.9, THREE.NormalBlending);
    this.sparklePoints = this.makePoints(160, sprite, 0.12, THREE.AdditiveBlending);
    (this.sparklePoints.material as THREE.PointsMaterial).color.set('#ffd96a');

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.0, 64),
      new THREE.MeshBasicMaterial({ color: '#ffd96a', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.02;
    this.scene.add(this.ring);

    this.bindPointer();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.setActive(true);
  }

  private active = false;
  /** Pause rendering while another view is on screen. */
  setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    this.renderer.setAnimationLoop(on ? () => this.tick() : null);
    if (on) this.resize();
  }

  private makePoints(count: number, map: THREE.Texture, size: number, blending: THREE.Blending): THREE.Points {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setDrawRange(0, 0);
    const mat = new THREE.PointsMaterial({
      size, map, transparent: true, depthWrite: false, vertexColors: true, blending, sizeAttenuation: true,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.scene.add(pts);
    return pts;
  }

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight('#c9c4ff', '#2a1f2e', 0.7));
    const key = new THREE.DirectionalLight('#ffffff', 2.2);
    key.position.set(3, 6, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -5;
    key.shadow.camera.right = 5;
    key.shadow.camera.top = 5;
    key.shadow.camera.bottom = -5;
    key.shadow.bias = -0.0005;
    this.scene.add(key);
    const rimA = new THREE.PointLight('#ff4fa3', 18, 10);
    rimA.position.set(-3, 3, -1.5);
    const rimB = new THREE.PointLight('#3ad7ff', 14, 10);
    rimB.position.set(3, 2, -2);
    this.scene.add(rimA, rimB);
  }

  private buildRoom(): void {
    const bench = new THREE.Mesh(
      new THREE.BoxGeometry(12, 0.3, 6),
      new THREE.MeshStandardMaterial({ color: '#2b2735', roughness: 0.55, metalness: 0.1 }),
    );
    bench.position.y = -0.15;
    bench.receiveShadow = true;
    this.scene.add(bench);

    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 8),
      new THREE.MeshStandardMaterial({ color: '#1d1a26', roughness: 0.9 }),
    );
    wall.position.set(0, 3.8, -3);
    wall.receiveShadow = true;
    this.scene.add(wall);

    // Turntable pad under the device.
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(1.05, 1.1, 0.06, 48),
      new THREE.MeshStandardMaterial({ color: '#393245', roughness: 0.3, metalness: 0.6 }),
    );
    pad.position.y = 0.03;
    pad.receiveShadow = true;
    this.scene.add(pad);
  }

  private buildDevice(): void {
    this.bodyMat = new THREE.MeshStandardMaterial({ color: '#3a6df0', roughness: 0.32, metalness: 0.55 });
    this.body = new THREE.Mesh(new RoundedBoxGeometry(0.95, 2.0, 0.5, 6, 0.16), this.bodyMat);
    this.body.position.y = 1.06;
    this.body.castShadow = true;
    this.device.add(this.body);

    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(0.74, 1.24),
      new THREE.MeshStandardMaterial({ map: this.labelTex, roughness: 0.5 }),
    );
    label.position.set(0, 1.0, 0.256);
    this.device.add(label);

    // Glass tank + liquid.
    const glass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.3, 0.8, 40, 1, true),
      new THREE.MeshPhysicalMaterial({
        color: '#ffffff', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    glass.position.y = 2.46;
    this.device.add(glass);

    this.liquidMat = new THREE.MeshPhysicalMaterial({
      color: '#ff9aa8', roughness: 0.15, transparent: true, opacity: 0.85, emissive: '#000000', clearcoat: 1,
    });
    this.liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 1, 40), this.liquidMat);
    this.device.add(this.liquid);

    const capMat = new THREE.MeshStandardMaterial({ color: '#16141c', roughness: 0.25, metalness: 0.8 });
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.08, 40), capMat);
    collar.position.y = 2.06;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.08, 40), capMat);
    top.position.y = 2.88;
    const mouth = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.2, 0.36, 32), capMat);
    mouth.position.y = 3.1;
    collar.castShadow = top.castShadow = mouth.castShadow = true;
    this.device.add(collar, top, mouth);

    this.led = new THREE.MeshStandardMaterial({ color: '#111', emissive: '#3ad7ff', emissiveIntensity: 1.5 });
    const button = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 24), this.led);
    button.rotation.x = Math.PI / 2;
    button.position.set(0, 1.83, 0.26);
    this.device.add(button);

    this.scene.add(this.device);
  }

  private buildShelf(): void {
    const shelfMat = new THREE.MeshStandardMaterial({ color: '#4b3f5c', roughness: 0.6, metalness: 0.2 });
    const glassMat = (colour: string) => new THREE.MeshPhysicalMaterial({
      color: colour, roughness: 0.1, transparent: true, opacity: 0.8, clearcoat: 1, emissive: colour, emissiveIntensity: 0.08,
    });
    const capMat = new THREE.MeshStandardMaterial({ color: '#e9e6f2', roughness: 0.4 });
    const rows = [this.data.notes.slice(0, 7), this.data.notes.slice(7)];
    rows.forEach((row, r) => {
      const y = 0.9 + r * 1.15;
      const shelf = new THREE.Mesh(new RoundedBoxGeometry(5.6, 0.08, 0.7, 2, 0.03), shelfMat);
      shelf.position.set(0, y - 0.04, -2.3);
      shelf.receiveShadow = true;
      shelf.castShadow = true;
      this.scene.add(shelf);
      row.forEach((note, i) => {
        const g = new THREE.Group();
        const bodyM = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.5, 24), glassMat(note.colour));
        bodyM.position.y = 0.25;
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.12, 0.12, 16), glassMat(note.colour));
        neck.position.y = 0.56;
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.12, 16), capMat);
        cap.position.y = 0.68;
        bodyM.castShadow = cap.castShadow = true;
        g.add(bodyM, neck, cap);
        const spacing = 4.9 / (row.length - 1 || 1);
        g.position.set(-2.45 + i * spacing, y, -2.25);
        g.userData.noteId = note.id;
        g.userData.baseY = y;
        this.bottles.push(g);
        this.scene.add(g);
      });
    });
  }

  private bindPointer(): void {
    const el = this.renderer.domElement;
    const pick = (e: PointerEvent): THREE.Group | null => {
      const rect = el.getBoundingClientRect();
      this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hit = this.raycaster.intersectObjects(this.bottles, true)[0];
      let o: THREE.Object3D | null = hit?.object ?? null;
      while (o && !o.userData.noteId) o = o.parent;
      return (o as THREE.Group) ?? null;
    };
    el.addEventListener('pointermove', (e) => {
      const b = pick(e);
      if (b !== this.hovered) {
        this.hovered = b;
        el.style.cursor = b ? 'grab' : '';
      }
      this.onBottleHover?.(b?.userData.noteId ?? null, e.clientX, e.clientY);
    });
    el.addEventListener('pointerleave', () => {
      this.hovered = null;
      this.onBottleHover?.(null, 0, 0);
    });
    el.addEventListener('pointerdown', (e) => {
      const b = pick(e);
      if (!b) return;
      this.controls.enabled = false;
      const restore = () => {
        this.controls.enabled = true;
        window.removeEventListener('pointerup', restore);
      };
      window.addEventListener('pointerup', restore);
      this.onBottlePointerDown?.({ noteId: b.userData.noteId, clientX: e.clientX, clientY: e.clientY });
    });
  }

  /** Whether a screen point is over the device (used as a drop target). */
  isOverDevice(clientX: number, clientY: number): boolean {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return false;
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObject(this.device, true).length > 0;
  }

  setProduct(product: Product): void {
    this.bodyMat.color.set(product.brand.labelColour).multiplyScalar(product.brand.style === 'luxe' ? 0.35 : 0.8);
    this.bodyMat.metalness = product.brand.style === 'luxe' ? 0.9 : product.brand.style === 'minimal' ? 0.2 : 0.55;
    drawLabel(this.labelCanvas, product.brand, product.notes, this.data);
    this.labelTex.needsUpdate = true;
    const total = product.notes.reduce((s, n) => s + n.amount, 0);
    this.targetFill = Math.min(1, 0.15 + total / 300);
    this.targetLiquid = liquidColour(product, this.data);
    this.puffColour.copy(this.targetLiquid).lerp(new THREE.Color('#ffffff'), 0.75);
    this.led.emissive.set(product.tuning.cooling > 60 ? '#7fe8ff' : product.tuning.intensity > 70 ? '#ff5a5a' : '#c69bff');
    this.usedNotes = new Set(product.notes.map((n) => n.noteId));
  }

  /** Test batch: the device shakes, puffs vapour and the liquid drops a touch. */
  playTest(vapour: number): Promise<void> {
    return new Promise((resolve) => {
      const puffsN = 3;
      this.shake = 1;
      for (let k = 0; k < puffsN; k++) {
        setTimeout(() => this.emitPuff(20 + Math.round(vapour * 0.6)), 250 + k * 420);
      }
      setTimeout(() => {
        this.fill = Math.max(0.1, this.fill - 0.06);
        resolve();
      }, 1700);
    });
  }

  private emitPuff(count: number): void {
    const origin = new THREE.Vector3(0, 3.3, 0).applyMatrix4(this.device.matrixWorld);
    for (let i = 0; i < count && this.puffs.length < 400; i++) {
      this.puffs.push({
        pos: origin.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.1, 0, (Math.random() - 0.5) * 0.1)),
        vel: new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.6 + Math.random() * 0.7, (Math.random() - 0.2) * 0.6),
        life: 0,
        maxLife: 1.8 + Math.random() * 1.4,
        size: 0.3 + Math.random() * 0.5,
      });
    }
  }

  /** Subtle reveal: golden sparkles, a floor ring and a liquid glow. */
  playSynergyReveal(): void {
    this.glow = 1;
    this.ringT = 0;
    for (let i = 0; i < 120 && this.sparkles.length < 160; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.6 + Math.random() * 0.4;
      this.sparkles.push({
        pos: new THREE.Vector3(Math.cos(a) * r, 0.3 + Math.random() * 2.6, Math.sin(a) * r),
        vel: new THREE.Vector3(Math.cos(a) * 0.3, 0.4 + Math.random() * 0.6, Math.sin(a) * 0.3),
        life: 1.2 + Math.random() * 0.8,
      });
    }
  }

  private resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Widen the view on tall/narrow stages so the whole shelf stays in frame.
    this.camera.fov = Math.min(56, 40 * Math.max(1, 1.25 / this.camera.aspect) ** 0.5);
    this.camera.updateProjectionMatrix();
  }

  private tick(): void {
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;

    // Device: idle turntable spin, wobble while testing.
    this.device.rotation.y += dt * 0.25;
    this.shake = Math.max(0, this.shake - dt * 0.6);
    this.device.position.x = Math.sin(t * 40) * 0.02 * this.shake;
    this.device.position.y = Math.abs(Math.sin(t * 9)) * 0.06 * this.shake;

    // Liquid level + colour easing.
    this.fill += (this.targetFill - this.fill) * Math.min(1, dt * 4);
    this.liquid.scale.y = 0.74 * this.fill;
    this.liquid.position.y = 2.1 + (0.74 * this.fill) / 2;
    this.liquidMat.color.lerp(this.targetLiquid, Math.min(1, dt * 5));
    this.glow = Math.max(0, this.glow - dt * 0.4);
    this.liquidMat.emissive.copy(this.liquidMat.color).multiplyScalar(0.15 + this.glow * 0.9);

    // Bottles: hover lift, used ones bob gently.
    for (const b of this.bottles) {
      const lift = b === this.hovered ? 0.12 : this.usedNotes.has(b.userData.noteId) ? 0.04 + Math.sin(t * 2 + b.position.x) * 0.02 : 0;
      b.position.y += (b.userData.baseY + lift - b.position.y) * Math.min(1, dt * 10);
    }

    this.updatePuffs(dt);
    this.updateSparkles(dt);

    if (this.ringT >= 0) {
      this.ringT += dt;
      const k = this.ringT / 1.6;
      this.ring.scale.setScalar(1 + k * 2.5);
      (this.ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.8 * (1 - k));
      if (k >= 1) this.ringT = -1;
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private updatePuffs(dt: number): void {
    const geo = this.puffPoints.geometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const col = geo.getAttribute('color') as THREE.BufferAttribute;
    this.puffs = this.puffs.filter((p) => (p.life += dt) < p.maxLife);
    this.puffs.forEach((p, i) => {
      p.vel.multiplyScalar(1 - dt * 0.8);
      p.vel.y += dt * 0.15;
      p.pos.addScaledVector(p.vel, dt);
      pos.setXYZ(i, p.pos.x, p.pos.y, p.pos.z);
      const fade = 1 - p.life / p.maxLife;
      col.setXYZ(i, this.puffColour.r * fade, this.puffColour.g * fade, this.puffColour.b * fade);
    });
    pos.needsUpdate = col.needsUpdate = true;
    geo.setDrawRange(0, this.puffs.length);
    (this.puffPoints.material as THREE.PointsMaterial).opacity = 0.55;
  }

  private updateSparkles(dt: number): void {
    const geo = this.sparklePoints.geometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const col = geo.getAttribute('color') as THREE.BufferAttribute;
    this.sparkles = this.sparkles.filter((s) => (s.life -= dt) > 0);
    this.sparkles.forEach((s, i) => {
      s.pos.addScaledVector(s.vel, dt);
      pos.setXYZ(i, s.pos.x, s.pos.y, s.pos.z);
      const a = Math.min(1, s.life) * (0.6 + 0.4 * Math.sin(s.life * 30));
      col.setXYZ(i, a, a, a);
    });
    pos.needsUpdate = col.needsUpdate = true;
    geo.setDrawRange(0, this.sparkles.length);
  }
}
