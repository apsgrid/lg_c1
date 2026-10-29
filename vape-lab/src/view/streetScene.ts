// The run's street in 3D: the same layout the Paperboy-style runs use (firebombing a
// rival's shopfronts, or the Night Round to regulars' doors), built as a three.js
// scene for previews and engine export.
//
// Run units map to metres (METRES): run x (across the road) -> Z, run y (along) -> X,
// run z (up) -> Y. Buildings are on -Z, facing +Z.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mulberry32, type NightOrder } from '../sim';
import { AWNINGS, buildStreet, buildTraffic, FACADE, KERB, LANE, METRES as M, type Lot, type Mode, type Thing } from '../street/layout';

/** Height (run units) below which a throw counts as reaching a front or doorstep, as in the 2D run. */
const TARGET_Z = 62;
import type { DistrictTheme } from './districtTheme';

// Identical materials are shared (engines import one material, not hundreds); reset per build.
let matCache = new Map<string, THREE.MeshStandardMaterial>();
const cached = (key: string, make: () => THREE.MeshStandardMaterial) => {
  let m = matCache.get(key);
  if (!m) { m = make(); matCache.set(key, m); }
  return m;
};
const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => cached(`m:${color}:${JSON.stringify(extra)}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra }));
const glow = (color: string, i = 2) => cached(`g:${color}:${i}`, () => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: i, roughness: 0.4 }));
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

export interface StreetOptions {
  mode: Mode;
  rivalName: string;
  rivalColour: string;
  orders: NightOrder[];
  theme: DistrictTheme;
  police: number;
  seed: number;
  /** Rival fronts on fire / parcels on the doorsteps. */
  aftermath: boolean;
  night: boolean;
  wet: boolean;
}

/**
 * Everything a game engine needs to play the run on this street, in metres
 * (X along the street, Z across it with buildings at -Z, Y up). Read by render/godot/run.gd.
 */
export interface RunData {
  format: 'vape-wars-run';
  version: 1;
  mode: Mode;
  title: string;
  length: number;
  lane: number;
  facadeZ: number;
  targetY: number;
  ammo: number;
  start: [number, number];
  targets: Array<{ x0: number; x1: number; name: string; node: string; door?: number }>;
  buildings: Array<{ x0: number; x1: number; h: number }>;
  windows: Array<{ x0: number; x1: number; y0: number; y1: number }>;
  obstacles: Array<{ kind: string; node: string; x: number; z: number; hl: number; hw: number; vx: number; vz: number }>;
}

export interface StreetBuild { group: THREE.Group; length: number; targets: THREE.Vector3[]; carAt: THREE.Vector3; run: RunData }

function canvasTex(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function signTex(text: string, bg: string, fg: string, neon: boolean): THREE.CanvasTexture {
  return canvasTex(512, 96, (ctx) => {
    ctx.fillStyle = neon ? '#140c1e' : bg;
    ctx.fillRect(0, 0, 512, 96);
    let size = 60;
    ctx.font = `800 ${size}px system-ui, sans-serif`;
    while (ctx.measureText(text).width > 480 && size > 18) ctx.font = `800 ${--size}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (neon) { ctx.shadowColor = bg; ctx.shadowBlur = 18; }
    ctx.fillStyle = neon ? bg : fg;
    ctx.fillText(text, 256, 50);
  });
}

/** A box from run-space bounds. */
function runBox(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, material: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(UNIT_BOX, material);
  m.scale.set((y1 - y0) * M, (z1 - z0) * M, (x1 - x0) * M);
  m.position.set(((y0 + y1) / 2) * M, ((z0 + z1) / 2) * M, ((x0 + x1) / 2) * M);
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** A plane on a building front (facing +Z) at run coords (y along, z up). */
function facadePlane(y0: number, y1: number, z0: number, z1: number, material: THREE.Material, out = 0.6): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry((y1 - y0) * M, (z1 - z0) * M), material);
  m.position.set(((y0 + y1) / 2) * M, ((z0 + z1) / 2) * M, FACADE * M + out * M);
  return m;
}

function fire(group: THREE.Group, x: number, y: number, z: number, width: number): void {
  const cols = ['#ffd23a', '#ff7a1a', '#ff4a1a'];
  for (let k = 0; k < 7; k++) {
    const h = 1.4 + ((k * 37) % 5) * 0.35;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.32 + (k % 3) * 0.1, h, 8), glow(cols[k % 3], 3));
    cone.position.set(x + (k - 3) * (width / 7), y + h / 2, z + (k % 2) * 0.15);
    cone.name = `fire_${k}`;
    group.add(cone);
  }
  const light = new THREE.PointLight('#ff7a1a', 14, 12);
  light.position.set(x, y + 0.8, z + 1.2);
  light.name = 'FireLight';
  group.add(light);
}

function buildLot(l: Lot, i: number, o: StreetOptions, group: THREE.Group, targets: THREE.Vector3[]): void {
  const lot = new THREE.Group();
  lot.name = l.kind === 'rival' ? `rival_front_${targets.length + 1}` : l.order ? `order_house_${l.order.door}` : `lot_${i + 1}`;
  const wall = mat(l.wall, { roughness: 0.85 });
  lot.add(runBox(FACADE - l.depth, FACADE, l.y0, l.y1, 0, l.hgt, wall));
  lot.add(runBox(FACADE - l.depth, FACADE, l.y0, l.y1, l.hgt, l.hgt + 3, mat(l.roof)));
  const len = l.y1 - l.y0;
  for (const w of l.windows) {
    const lit = l.kind === 'rival' ? (o.aftermath ? '#ff8a3a' : '#9fe8ff') : l.order ? '#ffd27a' : (w.y0 * 7 + w.z0) % 3 === 0 ? null : '#ffd27a';
    const m = lit && o.night ? glow(lit, l.kind === 'rival' ? 0.75 : 0.9) : mat(lit ? '#9fb8d0' : '#2a2838', { roughness: 0.15, metalness: 0.4 });
    const plane = facadePlane(l.y0 + w.y0, l.y0 + w.y1, w.z0, w.z1, m);
    plane.name = lit && o.night ? `window_lit_${i}` : `window_${i}`;
    lot.add(plane);
  }
  if (l.sign) {
    const bandZ = l.kind === 'rival' ? 66 : 54;
    const sign = facadePlane(l.y0 + 4, l.y1 - 4, bandZ, bandZ + 18, new THREE.MeshBasicMaterial({ map: signTex(l.sign, l.signColour ?? '#888', l.kind === 'rival' ? '#111' : '#fff', !!l.neon), toneMapped: false }), 1);
    sign.name = l.kind === 'rival' ? 'rival_sign' : 'shop_sign';
    lot.add(sign);
    if (l.kind === 'shop' && !l.neon) {
      const awning = new THREE.Mesh(new THREE.BoxGeometry((len - 46) * M, 0.06, 0.9), mat(l.signColour ?? AWNINGS[i % AWNINGS.length], { roughness: 0.8 }));
      awning.position.set((l.y0 + (len - 46) / 2) * M, 52 * M, FACADE * M + 0.45);
      awning.rotation.x = 0.25;
      lot.add(awning);
    }
  }
  if (l.kind === 'rival') {
    const w = l.windows[0];
    // Boxed stock in the window, and the door.
    for (let u = w.y0 + 10; u < w.y1 - 10; u += 16) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(8 * M, 14 * M, 4 * M), mat(l.signColour ?? '#fff'));
      box.position.set((l.y0 + u + 4) * M, (w.z0 + 9) * M, FACADE * M - 0.1);
      lot.add(box);
    }
    lot.add(facadePlane(l.y1 - 52, l.y1 - 24, 0, 50, mat('#15131c', { roughness: 0.3 })));
    const centre = new THREE.Vector3(((l.y0 + l.y1) / 2) * M, 2, FACADE * M + 0.2);
    targets.push(centre);
    const marker = new THREE.Object3D();
    marker.name = `marker_target_${targets.length}`;
    marker.position.copy(centre);
    marker.userData = { marker: 'target', mode: 'firebomb' };
    lot.add(marker);
    if (o.aftermath) fire(lot, ((l.y0 + w.y0 + l.y0 + w.y1) / 2) * M, w.z0 * M, FACADE * M + 0.2, (w.y1 - w.y0) * M);
  }
  if (l.kind === 'house') {
    lot.add(facadePlane(l.y1 - 34, l.y1 - 14, 0, 40, mat(l.order ? '#6a2a3a' : '#2a1e1a')));
    if (l.order) {
      const porch = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), glow(o.aftermath ? '#3ddc84' : '#ffe6b0', 3));
      porch.position.set((l.y1 - 40) * M, 46 * M, FACADE * M + 0.1);
      porch.name = 'porch_light';
      const pl = new THREE.PointLight('#ffcf8a', 6, 5);
      pl.position.set((l.y1 - 40) * M, 44 * M, FACADE * M + 0.6);
      pl.name = 'PorchLight';
      const plaque = facadePlane(l.y1 - 112, l.y1 - 8, 58, 74, new THREE.MeshBasicMaterial({ map: signTex(`${l.order.door} · ${l.order.name}`, '#0c0a14', '#ffd27a', false), toneMapped: false }), 1);
      plaque.name = 'house_plaque';
      lot.add(porch, pl, plaque);
      const centre = new THREE.Vector3((l.y1 - 24) * M, 0, FACADE * M + 0.5);
      targets.push(centre);
      const marker = new THREE.Object3D();
      marker.name = `marker_target_${targets.length}`;
      marker.position.copy(centre);
      marker.userData = { marker: 'target', mode: 'delivery', door: l.order.door };
      lot.add(marker);
      if (o.aftermath) {
        const parcel = new THREE.Mesh(new RoundedBoxGeometry(0.45, 0.3, 0.35, 2, 0.03), mat('#c08a4a'));
        parcel.position.set(centre.x, 0.15, centre.z + 0.4);
        parcel.rotation.y = 0.3;
        parcel.name = 'parcel';
        lot.add(parcel);
      }
    }
  }
  group.add(lot);
}

function car(colour: string, facingCamera: boolean, police = false): THREE.Group {
  const g = new THREE.Group();
  const paint = mat(colour, { roughness: 0.3, metalness: 0.6 });
  const body = new THREE.Mesh(new RoundedBoxGeometry(4.0, 0.7, 1.8, 3, 0.15), paint);
  body.position.y = 0.6;
  const cabin = new THREE.Mesh(new RoundedBoxGeometry(2.0, 0.6, 1.6, 3, 0.2), mat('#1a1d28', { roughness: 0.15, metalness: 0.6 }));
  cabin.position.set(-0.2, 1.2, 0);
  g.add(body, cabin);
  for (const [x, z] of [[1.3, 0.85], [1.3, -0.85], [-1.3, 0.85], [-1.3, -0.85]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 18), mat('#111'));
    w.rotation.x = Math.PI / 2;
    w.position.set(x, 0.34, z);
    g.add(w);
  }
  for (const z of [-0.6, 0.6]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.3), glow('#fff6c4', facingCamera ? 2.5 : 1.5));
    head.position.set(2.01, 0.75, z);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.3), glow('#ff2233', 1.6));
    tail.position.set(-2.01, 0.8, z);
    g.add(head, tail);
  }
  if (police) {
    for (const [z, c] of [[-0.3, '#3a6dff'], [0.3, '#ff3344']] as const) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.5), glow(c, 3));
      bar.position.set(-0.2, 1.56, z);
      g.add(bar);
    }
  }
  g.traverse((x) => { if ((x as THREE.Mesh).isMesh) { x.castShadow = true; } });
  return g;
}

function thing(t: Thing): THREE.Object3D | null {
  const at = (o: THREE.Object3D) => { o.position.set(t.y * M, 0, t.x * M); return o; };
  switch (t.kind) {
    case 'parked': case 'oncoming': { const c = car(t.colour, t.kind === 'oncoming'); if (t.kind === 'oncoming') c.rotation.y = Math.PI; return at(c); }
    case 'police': return at(car('#e8e8f0', false, true));
    case 'cone': { const c = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.6, 12), mat('#ff7a1a')); c.position.y = 0.3; const g = new THREE.Group(); g.add(c); return at(g); }
    case 'bin': { const g = new THREE.Group(); const b = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.9, 0.55, 2, 0.05), mat(t.colour)); b.position.y = 0.45; g.add(b); return at(g); }
    case 'roadworks': {
      const g = new THREE.Group();
      for (let k = 0; k < 4; k++) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.25, 0.1), mat(k % 2 ? '#ffffff' : '#e83a3a')); s.position.set(0, 0.8, -0.9 + k * 0.6); s.rotation.y = Math.PI / 2; g.add(s); }
      for (const z of [-1.1, 1.1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.8, 0.06), mat('#333')); leg.position.set(0, 0.4, z); g.add(leg); }
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), glow('#ffb020', 3));
      lamp.position.set(0, 1.0, 0);
      g.add(lamp);
      return at(g);
    }
    case 'crate': { const g = new THREE.Group(); const b = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.45, 0.6, 2, 0.04), mat('#a8743a')); b.position.y = 0.22; g.add(b); return at(g); }
    case 'dog': {
      const g = new THREE.Group();
      const b = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.3, 0.25, 2, 0.08), mat('#a0703a')); b.position.y = 0.45;
      const h = new THREE.Mesh(new RoundedBoxGeometry(0.25, 0.25, 0.22, 2, 0.06), mat('#b8844a')); h.position.set(0.38, 0.65, 0);
      g.add(b, h);
      return at(g);
    }
    case 'cat': { const g = new THREE.Group(); const b = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.2, 0.15, 2, 0.05), mat('#1a1820')); b.position.y = 0.2; g.add(b); return at(g); }
  }
  return null;
}

function verge(o: StreetOptions, length: number, group: THREE.Group): void {
  const style = o.theme.skyline;
  const rng = mulberry32(o.seed ^ 0x5eed);
  for (let x = 6; x < length; x += 12 + rng() * 6) {
    const z = (KERB + 60) * M + rng() * 3;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    if (style === 'waves') {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 4.5, 8), mat('#7a5a3a'));
      trunk.position.y = 2.25;
      trunk.rotation.z = 0.12;
      g.add(trunk);
      for (let k = 0; k < 6; k++) {
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.05, 0.4), mat('#2f7a44'));
        leaf.position.set(Math.cos(k) * 0.8, 4.4, Math.sin(k) * 0.8);
        leaf.rotation.set(0, -k, -0.35);
        g.add(leaf);
      }
    } else if (style === 'stalls') {
      const stall = new THREE.Mesh(new RoundedBoxGeometry(2.4, 1.0, 1.4, 2, 0.05), mat('#5a4030'));
      stall.position.y = 0.5;
      const roof = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 1.6), mat(AWNINGS[Math.floor(rng() * AWNINGS.length)]));
      roof.position.y = 2.0;
      g.add(stall, roof);
    } else if (style === 'towers' || style === 'clubs') {
      const planter = new THREE.Mesh(new RoundedBoxGeometry(1.4, 0.7, 1.4, 2, 0.05), mat(style === 'clubs' ? '#2a1838' : '#3a3a48'));
      planter.position.y = 0.35;
      const bush = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8), mat('#2c6a3e', { flatShading: true }));
      bush.position.y = 0.95;
      g.add(planter, bush);
    } else if (style === 'sheds') {
      for (let k = -2; k <= 2; k++) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6), mat('#6a6a70', { metalness: 0.6 }));
        post.position.set(k * 1.2, 1.1, 0);
        g.add(post);
      }
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 2.0), mat('#8a8a90', { transparent: true, opacity: 0.35, side: THREE.DoubleSide, metalness: 0.6 }));
      mesh.position.y = 1.1;
      g.add(mesh);
    } else {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 2.2, 8), mat('#3a2a20'));
      trunk.position.y = 1.1;
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 1), mat(rng() < 0.5 ? '#1f4a2c' : '#2c6a3e', { flatShading: true }));
      crown.position.y = 3.0;
      g.add(trunk, crown);
    }
    g.traverse((x) => { if ((x as THREE.Mesh).isMesh) x.castShadow = true; });
    group.add(g);
  }
}

export function buildStreet3D(o: StreetOptions): StreetBuild {
  matCache = new Map();
  const group = new THREE.Group();
  group.name = o.mode === 'firebomb' ? 'FirebombStreet' : 'NightRoundStreet';
  const rng = mulberry32(o.seed);
  const { lots, end } = buildStreet({ mode: o.mode, rivalName: o.rivalName, rivalColour: o.rivalColour, orders: o.orders }, o.theme.skyline, o.theme, rng);
  const things = buildTraffic(end, o.police, rng);
  const length = end * M;
  // Ground: back alleys, left pavement, road, right pavement, verge (sand and sea at the beach).
  const strip = (z0: number, z1: number, colour: string, extra: THREE.MeshStandardMaterialParameters = {}, name = '') => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(length + 40, (z1 - z0) * M), mat(colour, extra));
    m.rotation.x = -Math.PI / 2;
    m.position.set(length / 2, 0, ((z0 + z1) / 2) * M);
    m.receiveShadow = true;
    m.name = name;
    group.add(m);
  };
  const wet = o.wet ? { roughness: 0.08, metalness: 0.4 } : {};
  strip(-400, FACADE, '#15131c');
  strip(FACADE, -KERB, '#3a3844', wet, 'pavement_left');
  strip(-KERB, KERB, '#1f1e26', wet, 'road');
  strip(KERB, KERB + 26, '#3a3844', wet, 'pavement_right');
  const v = o.theme.skyline;
  strip(KERB + 26, 600, v === 'waves' ? '#bfa775' : v === 'towers' || v === 'clubs' || v === 'stalls' ? '#2c2a36' : v === 'sheds' ? '#2a2a2b' : '#1f3324', {}, 'verge');
  if (v === 'waves') {
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(length + 40, 60), mat('#12304a', { roughness: 0.05, metalness: 0.3 }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(length / 2, 0.02, (KERB + 110) * M + 30);
    sea.name = 'sea';
    group.add(sea);
  }
  for (let x = 0; x < length; x += 6) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.15), new THREE.MeshBasicMaterial({ color: '#d9c060' }));
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(x, 0.005, 0);
    group.add(dash);
  }
  for (const z of [-KERB, KERB]) {
    const kerb = new THREE.Mesh(new THREE.BoxGeometry(length + 40, 0.12, 0.2), mat('#6a6874'));
    kerb.position.set(length / 2, 0.06, z * M);
    group.add(kerb);
  }
  const targets: THREE.Vector3[] = [];
  lots.forEach((l, i) => buildLot(l, i, o, group, targets));
  things.forEach((t, i) => {
    const obj = thing(t);
    if (obj) { obj.name = `traffic_${i + 1}_${t.kind}`; group.add(obj); }
  });
  // Street lamps both sides; a real light on every other one.
  let n = 0;
  for (let y = 150; y < end; y += 300) {
    for (const side of [-1, 1]) {
      const z = side < 0 ? (-KERB - 18) * M : (KERB + 18) * M;
      const x = (y + (side > 0 ? 150 : 0)) * M;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 7, 8), mat('#3a3844', { metalness: 0.6 }));
      pole.position.set(x, 3.5, z);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), glow(o.theme.skyline === 'clubs' ? o.theme.neonA : '#ffe6b0', o.night ? 3 : 0.5));
      head.position.set(x, 7.1, z);
      head.name = 'lamp_head';
      group.add(pole, head);
      if (o.night && n++ % 2 === 0) {
        const l = new THREE.PointLight(o.theme.skyline === 'clubs' ? o.theme.neonA : '#ffcf8a', 25, 16);
        l.position.set(x, 6.8, z);
        l.name = `StreetLamp_${n}`;
        group.add(l);
      }
    }
  }
  verge(o, length, group);
  // You, in the car, partway down the street.
  const carAt = new THREE.Vector3((targets[1]?.x ?? length * 0.3) - 8, 0, -1.2);
  const you = car('#3a6df0', false);
  you.position.copy(carAt);
  you.name = 'your_car';
  const beam = new THREE.SpotLight('#fff3d0', 60, 30, 0.5, 0.5);
  beam.position.set(carAt.x + 2, 0.8, carAt.z);
  beam.target.position.set(carAt.x + 20, 0, carAt.z);
  beam.name = 'Headlights';
  group.add(you, beam, beam.target);
  for (const [name, x] of [['marker_start', 0], ['marker_end', length]] as const) {
    const m = new THREE.Object3D();
    m.name = name;
    m.position.set(x, 0, 0);
    m.userData = { marker: name.slice(7) };
    group.add(m);
  }
  const r = (n: number) => +n.toFixed(3);
  let k = 0;
  const run: RunData = {
    format: 'vape-wars-run', version: 1, mode: o.mode,
    title: o.mode === 'firebomb' ? `Firebomb run: ${o.rivalName}` : 'Night Round',
    length: r(length), lane: r(LANE * M), facadeZ: r(FACADE * M), targetY: r(TARGET_Z * M),
    ammo: o.mode === 'firebomb' ? 8 : o.orders.length + 3,
    start: [2, r(-10 * M)],
    targets: lots.filter((l) => l.kind === 'rival' || l.order).map((l) => ({
      x0: r(l.y0 * M), x1: r(l.y1 * M), name: l.order ? l.order.name : (l.sign ?? o.rivalName), node: `marker_target_${++k}`, door: l.order?.door,
    })),
    buildings: lots.map((l) => ({ x0: r(l.y0 * M), x1: r(l.y1 * M), h: r(l.hgt * M) })),
    windows: lots.filter((l) => l.kind !== 'rival' && !l.order).flatMap((l) => l.windows.map((w) => ({ x0: r((l.y0 + w.y0) * M), x1: r((l.y0 + w.y1) * M), y0: r(w.z0 * M), y1: r(w.z1 * M) }))),
    obstacles: things.map((t, i) => ({ kind: t.kind, node: `traffic_${i + 1}_${t.kind}`, x: r(t.y * M), z: r(t.x * M), hl: r((t.l / 2) * M), hw: r((t.w / 2) * M), vx: r(t.vy * M), vz: r(t.vx * M) })),
  };
  return { group, length, targets, carAt, run };
}
