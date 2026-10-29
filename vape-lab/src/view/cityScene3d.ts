// The city in 3D: the same map as the City view (data/city.json, 0-100 grid) built
// as a three.js scene, with district-tinted blocks, a landmark per location, turf
// rings, rival stores and your places. 1 map unit = 4 m; origin at the map centre.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { cityLoc, leader, mulberry32, turfOf, YOU, type GameData, type ShopState } from '../sim';
import { themeFor } from './districtTheme';

export const CITY_K = 4;
const P = (x: number, y: number) => new THREE.Vector3((x - 50) * CITY_K, 0, (y - 50) * CITY_K);
// Identical materials are shared (engines import one material, not hundreds); reset per build.
let matCache = new Map<string, THREE.MeshStandardMaterial>();
const cached = (key: string, make: () => THREE.MeshStandardMaterial) => {
  let m = matCache.get(key);
  if (!m) { m = make(); matCache.set(key, m); }
  return m;
};
const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => cached(`m:${color}:${JSON.stringify(extra)}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra }));
const glow = (color: string, i = 2) => cached(`g:${color}:${i}`, () => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: i, roughness: 0.5 }));
const UNIT = new THREE.BoxGeometry(1, 1, 1);
const LINES = [2, 8, 22, 36, 50, 64, 78, 92, 98];
const PARKS: Array<[number, number, number, number]> = [[26, 32, 10, 8], [62, 56, 9, 7], [8, 64, 8, 9]];

export interface CityBuild { group: THREE.Group; focus: Record<string, THREE.Vector3> }

function windowTexture(lit: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#16141e';
  ctx.fillRect(0, 0, 64, 64);
  let s = 7;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let y = 4; y < 64; y += 16) for (let x = 4; x < 64; x += 16) {
    ctx.fillStyle = lit && rnd() < 0.55 ? (rnd() < 0.8 ? '#ffd27a' : '#bfe0ff') : '#2a2a38';
    ctx.fillRect(x, y, 8, 9);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function label(text: string, colour: string): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 112;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(12,10,20,0.85)';
  ctx.beginPath();
  ctx.roundRect(4, 4, 504, 104, 24);
  ctx.fill();
  ctx.strokeStyle = colour;
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.font = '800 54px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 256, 60, 470);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(22, 4.8), new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false, side: THREE.DoubleSide }));
  m.rotation.x = -0.35;
  return m;
}

/** The harbour edge: the same curve the 2D map draws. */
function waterEdgeY(x: number): number {
  // Quadratic from (72,100) via (80,74) to (104,70), solved for y at x by sampling.
  let best = 200, bd = Infinity;
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    const px = (1 - t) ** 2 * 72 + 2 * (1 - t) * t * 80 + t * t * 104;
    const py = (1 - t) ** 2 * 100 + 2 * (1 - t) * t * 74 + t * t * 70;
    if (Math.abs(px - x) < bd) { bd = Math.abs(px - x); best = py; }
  }
  return x < 72 ? 999 : best;
}
const inWater = (x: number, y: number) => y > waterEdgeY(x);

function building(w: number, d: number, h: number, wall: THREE.Material, windows: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(UNIT, wall);
  body.scale.set(w, h, d);
  body.position.y = h / 2;
  body.castShadow = body.receiveShadow = true;
  g.add(body);
  // Window faces on the two sides the default camera sees (+Z and +X), with UVs scaled
  // so window size stays the same whatever the building's size.
  for (const [face, width] of [['z', w], ['x', d]] as const) {
    const geo = new THREE.PlaneGeometry(width * 0.92, h * 0.86);
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(1, width / 5), uv.getY(i) * Math.max(1, h / 5));
    const m = new THREE.Mesh(geo, windows);
    m.name = 'windows';
    if (face === 'z') m.position.set(0, h / 2, d / 2 + 0.02);
    else { m.rotation.y = Math.PI / 2; m.position.set(w / 2 + 0.02, h / 2, 0); }
    g.add(m);
  }
  return g;
}

function landmark(type: string, accent: string, night: boolean): THREE.Group {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  const neon = glow(accent, night ? 2.5 : 0.6);
  switch (type) {
    case 'cbd':
      add(new THREE.BoxGeometry(9, 70, 9), mat('#2a3a50', { roughness: 0.15, metalness: 0.7 }), 0, 35, 0);
      add(new THREE.BoxGeometry(9.4, 1, 9.4), neon, 0, 70.5, 0);
      break;
    case 'neon_mile':
      add(new THREE.BoxGeometry(16, 10, 10), mat('#1d1030'), 0, 5, 0);
      for (let k = 0; k < 3; k++) add(new THREE.BoxGeometry(16.4, 0.5, 10.4), glow(k % 2 ? '#7a4dff' : accent, night ? 3 : 0.8), 0, 3 + k * 3, 0);
      break;
    case 'church':
      add(new THREE.BoxGeometry(8, 9, 16), mat('#6a6058'), 0, 4.5, 0);
      add(new THREE.BoxGeometry(5, 18, 5), mat('#6a6058'), 0, 9, 9);
      add(new THREE.ConeGeometry(3.6, 10, 4), mat('#4a4440'), 0, 23, 9).rotation.y = Math.PI / 4;
      break;
    case 'school':
      add(new THREE.BoxGeometry(22, 8, 10), mat('#7a3a30'), 0, 4, 0);
      add(new THREE.CylinderGeometry(1.4, 1.4, 0.3, 24), glow('#fff3c4', night ? 1.5 : 0.3), 0, 6, 5.2).rotation.x = Math.PI / 2;
      break;
    case 'uni':
      add(new THREE.BoxGeometry(20, 12, 12), mat('#8a8070'), 0, 6, 0);
      for (let k = -2; k <= 2; k++) add(new THREE.CylinderGeometry(0.6, 0.6, 9, 12), mat('#d8d0c0'), k * 4, 4.5, 7);
      break;
    case 'beach':
      add(new THREE.BoxGeometry(4, 3, 4), mat('#e85a5a'), 0, 3.5, 0);
      for (const [x, z] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]]) add(new THREE.CylinderGeometry(0.15, 0.15, 2, 6), mat('#d8c8a0'), x, 1, z);
      add(new THREE.BoxGeometry(3, 0.4, 24), mat('#7a5a3a'), 8, 0.6, 10);
      break;
    case 'industrial':
      add(new THREE.BoxGeometry(24, 9, 14), mat('#5a5a60', { metalness: 0.4 }), 0, 4.5, 0);
      add(new THREE.CylinderGeometry(1.2, 1.5, 22, 12), mat('#7a6a5a'), 9, 11, -4);
      break;
    case 'market':
      for (let k = 0; k < 6; k++) {
        add(new THREE.BoxGeometry(4, 1.2, 3), mat('#5a4030'), (k % 3) * 5 - 5, 0.6, Math.floor(k / 3) * 5 - 2.5);
        add(new THREE.BoxGeometry(4.4, 0.15, 3.4), mat(['#e85a5a', '#ffcf5a', '#5ad7ff'][k % 3]), (k % 3) * 5 - 5, 2.6, Math.floor(k / 3) * 5 - 2.5);
      }
      break;
    case 'mall':
      add(new THREE.BoxGeometry(28, 14, 20), mat('#cfcbd6', { roughness: 0.4 }), 0, 7, 0);
      add(new THREE.BoxGeometry(20, 10, 0.3), mat('#9fd8ff', { roughness: 0.05, metalness: 0.5, emissive: '#9fd8ff', emissiveIntensity: night ? 0.6 : 0 }), 0, 6, 10.2);
      break;
    case 'hospital':
      add(new THREE.BoxGeometry(18, 24, 14), mat('#d6e6e0'), 0, 12, 0);
      add(new THREE.BoxGeometry(1.2, 4, 0.4), glow('#ff3b4a', night ? 3 : 1), 0, 20, 7.2);
      add(new THREE.BoxGeometry(4, 1.2, 0.4), glow('#ff3b4a', night ? 3 : 1), 0, 20, 7.2);
      break;
    default:
      for (const [x, z] of [[-6, 0], [0, 0], [6, 0]]) {
        add(new THREE.BoxGeometry(5, 5, 6), mat('#8a7060'), x, 2.5, z);
        add(new THREE.ConeGeometry(4.2, 3, 4), mat('#5a3a30'), x, 6.5, z).rotation.y = Math.PI / 4;
      }
  }
  return g;
}

function pin(colour: string, height = 14): THREE.Group {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, height, 8), glow(colour, 1.2));
  stem.position.y = height / 2;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12), glow(colour, 2.5));
  ball.position.y = height + 1;
  g.add(stem, ball);
  return g;
}

export function buildCity3D(s: ShopState, data: GameData, opts: { night: boolean; wet: boolean }): CityBuild {
  matCache = new Map();
  const group = new THREE.Group();
  group.name = 'City';
  const rng = mulberry32(1234);
  const locs = data.city ?? [];
  const nearest = (x: number, y: number) => locs.reduce((b, l) => (Math.hypot(l.x - x, l.y - y) < Math.hypot(b.x - x, b.y - y) ? l : b), locs[0]);
  const wet = opts.wet ? { roughness: 0.1, metalness: 0.35 } : {};

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(110 * CITY_K, 110 * CITY_K), mat('#22243a', wet));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = 'ground';
  group.add(ground);
  // Harbour water and sand.
  const shape = new THREE.Shape();
  const sp = (x: number, y: number) => [(x - 50) * CITY_K, -(y - 50) * CITY_K] as const;
  shape.moveTo(...sp(70, 104));
  shape.lineTo(...sp(72, 100));
  shape.quadraticCurveTo(...sp(80, 74), ...sp(104, 70));
  shape.lineTo(...sp(106, 106));
  shape.lineTo(...sp(70, 106));
  const water = new THREE.Mesh(new THREE.ShapeGeometry(shape, 24), mat('#12304a', { roughness: 0.04, metalness: 0.3 }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.05;
  water.name = 'harbour';
  group.add(water);
  // Roads.
  const road = mat('#2e3048', wet);
  const dashMat = new THREE.MeshBasicMaterial({ color: '#d9c060' });
  for (const g of [8, 22, 36, 50, 64, 78, 92]) {
    for (const vertical of [true, false]) {
      const main = (vertical && g === 50);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(vertical ? (main ? 10 : 6) : 98 * CITY_K, vertical ? 98 * CITY_K : 6), road);
      m.rotation.x = -Math.PI / 2;
      const c = vertical ? P(g, 50) : P(50, g);
      m.position.set(c.x, 0.03, c.z);
      m.receiveShadow = true;
      group.add(m);
    }
  }
  const mainH = new THREE.Mesh(new THREE.PlaneGeometry(98 * CITY_K, 10), road);
  mainH.rotation.x = -Math.PI / 2;
  mainH.position.set(0, 0.035, P(50, 44).z);
  group.add(mainH);
  for (let t = 2; t < 98; t += 3) {
    for (const [x, y, rot] of [[50, t, true], [t, 44, false]] as const) {
      const d = new THREE.Mesh(new THREE.PlaneGeometry(rot ? 0.3 : 4, rot ? 4 : 0.3), dashMat);
      d.rotation.x = -Math.PI / 2;
      const c = P(x, y);
      d.position.set(c.x, 0.05, c.z);
      group.add(d);
    }
  }
  // Blocks of buildings, tinted and sized by the nearest district.
  const litTex = windowTexture(opts.night), darkTex = windowTexture(false);
  const lit = new THREE.MeshStandardMaterial({ map: litTex, emissiveMap: opts.night ? litTex : null, emissive: opts.night ? '#ffffff' : '#000000', emissiveIntensity: opts.night ? 0.9 : 0, roughness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ map: darkTex, roughness: 0.4 });
  const wallCache = new Map<string, THREE.Material>();
  for (let i = 0; i < LINES.length - 1; i++) for (let j = 0; j < LINES.length - 1; j++) {
    const x0 = LINES[i] + 1.6, x1 = LINES[i + 1] - 1.6, y0 = LINES[j] + 1.6, y1 = LINES[j + 1] - 1.6;
    if (x1 - x0 < 2 || y1 - y0 < 2) continue;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    if (inWater(cx, cy) || inWater(x1, y1) || inWater(x0, y1)) continue;
    if (PARKS.some(([px, py, pw, ph]) => cx > px - 2 && cx < px + pw + 2 && cy > py - 2 && cy < py + ph + 2)) continue;
    // Leave room for a landmark.
    if (locs.some((l) => Math.abs(l.x - cx) < (x1 - x0) / 2 + 1 && Math.abs(l.y - cy) < (y1 - y0) / 2 + 1)) continue;
    const near = nearest(cx, cy);
    const theme = themeFor(near.id);
    const key = theme.wall;
    if (!wallCache.has(key)) wallCache.set(key, mat(`#${new THREE.Color(theme.wall).lerp(new THREE.Color('#6a6a78'), 0.35).getHexString()}`));
    const wall = wallCache.get(key)!;
    const pave = new THREE.Mesh(UNIT, mat('#33354a'));
    const c0 = P(x0, y0), c1 = P(x1, y1);
    pave.scale.set(c1.x - c0.x, 0.2, c1.z - c0.z);
    pave.position.set((c0.x + c1.x) / 2, 0.1, (c0.z + c1.z) / 2);
    pave.receiveShadow = true;
    group.add(pave);
    const tall = { towers: [18, 55], clubs: [9, 20], houses: [5, 9], trees: [6, 14], spire: [5, 9], sheds: [6, 10], stalls: [4, 7], waves: [5, 10] }[theme.skyline];
    const n = theme.skyline === 'sheds' ? 2 : 3;
    const cw = (c1.x - c0.x - 2) / n, cd = (c1.z - c0.z - 2) / n;
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      if (rng() < 0.15) continue;
      const h = tall[0] + rng() * (tall[1] - tall[0]);
      const bld = building(cw - 2, cd - 2, h, wall, rng() < 0.75 ? lit : dark);
      bld.position.set(c0.x + 1 + cw * (a + 0.5), 0.2, c0.z + 1 + cd * (b + 0.5));
      bld.name = `building_${near.id}`;
      group.add(bld);
    }
  }
  // Parks.
  for (const [x, y, w, h] of PARKS) {
    const c0 = P(x, y), c1 = P(x + w, y + h);
    const park = new THREE.Mesh(new THREE.PlaneGeometry(c1.x - c0.x, c1.z - c0.z), mat('#1f4a2c'));
    park.rotation.x = -Math.PI / 2;
    park.position.set((c0.x + c1.x) / 2, 0.06, (c0.z + c1.z) / 2);
    park.name = 'park';
    group.add(park);
    for (let k = 0; k < 14; k++) {
      const tx = c0.x + 2 + rng() * (c1.x - c0.x - 4), tz = c0.z + 2 + rng() * (c1.z - c0.z - 4);
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6 + rng(), 1), mat(rng() < 0.5 ? '#2f6b3a' : '#3a7a44', { flatShading: true }));
      crown.position.set(tx, 3, tz);
      crown.castShadow = true;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 2, 6), mat('#4a3020'));
      trunk.position.set(tx, 1, tz);
      group.add(crown, trunk);
    }
  }
  // Districts: plaza, landmark, label, turf ring in the leader's colour, a district light.
  const turf = turfOf(s, data);
  const focus: Record<string, THREE.Vector3> = {};
  const ownerColour = (o: string) => (o === YOU ? '#ff4fa3' : s.rivals.find((r) => r.id === o)?.colour ?? '#8a8aa0');
  for (const loc of locs) {
    const theme = themeFor(loc.id);
    const at = P(loc.x, loc.y);
    focus[loc.id] = at.clone();
    const d = new THREE.Group();
    d.name = `district_${loc.id}`;
    d.position.copy(at);
    const plaza = new THREE.Mesh(new THREE.CylinderGeometry(13, 13, 0.3, 40), mat('#3a3850'));
    plaza.position.y = 0.15;
    plaza.receiveShadow = true;
    const lead = leader(turf[loc.id] ?? {});
    const ring = new THREE.Mesh(new THREE.TorusGeometry(13.5, 0.35, 8, 64), glow(ownerColour(lead.owner), opts.night ? 2 : 0.8));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.4;
    ring.name = 'turf_ring';
    const lm = landmark(loc.id, theme.neonA, opts.night);
    lm.name = 'landmark';
    const tag = label(loc.name, theme.neonA);
    tag.position.set(0, 30 + (loc.id === 'cbd' ? 48 : 0), 14);
    tag.name = 'district_label';
    const light = new THREE.PointLight(theme.neonA, opts.night ? 300 : 60, 60);
    light.position.set(0, 12, 8);
    light.name = `DistrictLight_${loc.id}`;
    const marker = new THREE.Object3D();
    marker.name = `marker_loc_${loc.id}`;
    marker.userData = { marker: 'location', id: loc.id };
    d.add(plaza, ring, lm, tag, light, marker);
    group.add(d);
  }
  // Rival stores, and your places.
  const crowd: Record<string, number> = {};
  for (const r of s.rivals) for (const id of r.stores) {
    const loc = cityLoc(data, id);
    if (!loc) continue;
    const k = crowd[id] = (crowd[id] ?? 0) + 1;
    const shop = new THREE.Group();
    shop.name = `rival_${r.id}_${id}`;
    const body = new THREE.Mesh(new RoundedBoxGeometry(6, 4, 5, 2, 0.2), mat('#2a2436'));
    body.position.y = 2;
    const band = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.9, 5.2), glow(r.closedUntil >= s.day ? '#3a2020' : r.colour, opts.night ? 2 : 0.8));
    band.position.y = 3.6;
    shop.add(body, band);
    shop.position.copy(P(loc.x, loc.y)).add(new THREE.Vector3(16, 0, -14 + k * 7));
    group.add(shop);
  }
  const place = (id: string | undefined, colour: string, name: string, dx: number) => {
    const loc = cityLoc(data, id);
    if (!loc) return;
    const p = pin(colour);
    p.name = name;
    p.position.copy(P(loc.x, loc.y)).add(new THREE.Vector3(dx, 0, 16));
    group.add(p);
  };
  place(s.home, '#ffffff', 'your_home', -10);
  if (s.stash) place(s.stash, '#ffd96a', 'your_stash', -4);
  if (s.tier >= 2) place(s.store, '#ff4fa3', 'your_store', 4);
  for (const b of s.branches ?? []) place(b, '#ff4fa3', `your_branch_${b}`, 8);
  place(s.car, '#5ad7ff', 'your_car', 10);
  return { group, focus };
}
