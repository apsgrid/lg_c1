// Stylised props for the Studio preview, built from primitives in metres with
// the prop's floor point at the origin. Wall props face +Z.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { PartSpec, PropSpec } from '../studio/spec';

const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });
const glowMat = (color: string, intensity = 2.2) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.4 });

function textTexture(text: string, colour: string, w = 512, h = 128, neon = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  let size = Math.round(h * 0.6);
  ctx.font = `800 ${size}px "Trebuchet MS", system-ui, sans-serif`;
  while (ctx.measureText(text).width > w * 0.9 && size > 12) ctx.font = `800 ${--size}px "Trebuchet MS", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (neon) { ctx.shadowColor = colour; ctx.shadowBlur = h * 0.2; }
  ctx.fillStyle = neon ? '#ffffff' : colour;
  ctx.fillText(text, w / 2, h / 2);
  if (neon) { ctx.fillStyle = colour; ctx.globalAlpha = 0.6; ctx.fillText(text, w / 2, h / 2); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildPart(p: PartSpec): THREE.Mesh {
  const [a, b, c] = p.size;
  const geo = p.shape === 'box' ? new RoundedBoxGeometry(a, b, c, 2, Math.min(a, b, c) * 0.08)
    : p.shape === 'cylinder' ? new THREE.CylinderGeometry(a, a, b, 20)
      : p.shape === 'cone' ? new THREE.ConeGeometry(a, b, 20)
        : new THREE.SphereGeometry(a, 20, 14);
  const m = new THREE.Mesh(geo, p.glow ? glowMat(p.colour) : mat(p.colour));
  m.position.set(...p.at);
  m.rotation.y = p.rotY ?? 0;
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** Build one prop. `accent` is the scene's neon colour, used where the prop has none of its own. */
export function buildProp(p: PropSpec, accent: string, neon: number): THREE.Group {
  const g = new THREE.Group();
  const col = p.colour;
  const glow = p.glow ?? accent;
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rotY = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  const rbox = (w: number, h: number, d: number) => new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.12);
  switch (p.kind) {
    case 'plant': {
      add(new THREE.CylinderGeometry(0.24, 0.18, 0.45, 18), mat(col ?? '#c9805a', { roughness: 0.85 }), 0, 0.22, 0);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const leaf = add(new THREE.SphereGeometry(0.22, 10, 8), mat(i % 2 ? '#2f6b3a' : '#3a7a44', { roughness: 0.8, flatShading: true }), Math.cos(a) * 0.18, 0.75 + (i % 3) * 0.18, Math.sin(a) * 0.18);
        leaf.scale.set(1, 0.6, 1.4);
        leaf.rotation.y = a;
      }
      break;
    }
    case 'sofa': {
      const fabric = mat(col ?? '#7a3a5a', { roughness: 0.9 });
      add(rbox(1.9, 0.42, 0.85), fabric, 0, 0.3, 0);
      add(rbox(1.9, 0.6, 0.22), fabric, 0, 0.7, -0.33);
      for (const x of [-0.88, 0.88]) add(rbox(0.22, 0.55, 0.85), fabric, x, 0.5, 0);
      break;
    }
    case 'armchair': {
      const leather = mat(col ?? '#6b4226', { roughness: 0.5 });
      add(rbox(0.8, 0.4, 0.8), leather, 0, 0.3, 0);
      add(rbox(0.8, 0.65, 0.2), leather, 0, 0.75, -0.3);
      for (const x of [-0.36, 0.36]) add(rbox(0.14, 0.45, 0.8), leather, x, 0.55, 0);
      break;
    }
    case 'stool':
      add(new THREE.CylinderGeometry(0.2, 0.2, 0.07, 20), mat(col ?? '#2a2420'), 0, 0.72, 0);
      add(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 8), mat('#999', { metalness: 0.8, roughness: 0.3 }), 0, 0.36, 0);
      add(new THREE.CylinderGeometry(0.2, 0.22, 0.03, 20), mat('#999', { metalness: 0.8, roughness: 0.3 }), 0, 0.015, 0);
      break;
    case 'bench':
      add(rbox(1.6, 0.08, 0.45), mat(col ?? '#7a5a3a'), 0, 0.45, 0);
      add(rbox(1.6, 0.35, 0.06), mat(col ?? '#7a5a3a'), 0, 0.72, -0.2);
      for (const x of [-0.7, 0.7]) add(new THREE.BoxGeometry(0.06, 0.45, 0.4), mat('#333', { metalness: 0.6 }), x, 0.22, 0);
      break;
    case 'neon_sign': {
      const text = p.text || 'open';
      add(new THREE.PlaneGeometry(1.6, 0.55), new THREE.MeshBasicMaterial({ map: textTexture(text, glow), transparent: true, toneMapped: false }), 0, 0, 0.03);
      add(new THREE.BoxGeometry(1.7, 0.6, 0.03), mat('#15131c', { roughness: 0.4 }), 0, 0, 0);
      const l = new THREE.PointLight(glow, 4 * neon, 4);
      l.position.set(0, 0, 0.5);
      g.add(l);
      break;
    }
    case 'arcade': {
      const body = mat(col ?? '#3a1d5a', { roughness: 0.5 });
      add(rbox(0.7, 1.75, 0.75), body, 0, 0.875, 0);
      const screen = add(new THREE.PlaneGeometry(0.5, 0.4), glowMat(glow, 1.6), 0, 1.35, 0.38);
      screen.rotation.x = -0.25;
      add(new THREE.BoxGeometry(0.66, 0.08, 0.3), mat('#15131c'), 0, 1.02, 0.42);
      add(new THREE.BoxGeometry(0.66, 0.14, 0.04), glowMat(glow, 1.2), 0, 1.72, 0.38);
      break;
    }
    case 'vending': {
      add(rbox(0.95, 1.9, 0.8), mat(col ?? '#c23a4a', { roughness: 0.35, metalness: 0.3 }), 0, 0.95, 0);
      add(new THREE.PlaneGeometry(0.6, 1.25), glowMat('#cfe8ff', 0.9), -0.1, 1.15, 0.405);
      for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) add(new THREE.BoxGeometry(0.1, 0.18, 0.05), mat(['#ffb020', '#3ad7ff', '#3ddc84', '#ff4fa3'][(r + k) % 4]), -0.32 + k * 0.15, 0.7 + r * 0.28, 0.42);
      add(new THREE.BoxGeometry(0.12, 0.3, 0.03), glowMat(glow, 1.4), 0.33, 1.3, 0.41);
      break;
    }
    case 'display_case': {
      add(rbox(1.4, 0.9, 0.6), mat(col ?? '#2a2632', { metalness: 0.4, roughness: 0.4 }), 0, 0.45, 0);
      add(new THREE.BoxGeometry(1.36, 0.5, 0.56), new THREE.MeshPhysicalMaterial({ color: '#ffffff', transmission: 0.9, roughness: 0.05, thickness: 0.02, transparent: true, opacity: 0.25 }), 0, 1.15, 0);
      for (let k = 0; k < 5; k++) add(new THREE.BoxGeometry(0.12, 0.2, 0.08), mat(['#ff4fa3', '#3ad7ff', '#ffd27a', '#9cff3a', '#c69bff'][k], { roughness: 0.4 }), -0.5 + k * 0.25, 1.0, 0);
      add(new THREE.BoxGeometry(1.36, 0.02, 0.02), glowMat(glow, 2), 0, 1.39, 0.27);
      break;
    }
    case 'shelf_unit': {
      const wood = mat(col ?? '#4b3f5c');
      for (const x of [-0.6, 0.6]) add(new THREE.BoxGeometry(0.05, 1.9, 0.4), wood, x, 0.95, 0);
      for (let r = 0; r < 4; r++) {
        add(new THREE.BoxGeometry(1.25, 0.04, 0.4), wood, 0, 0.2 + r * 0.5, 0);
        for (let k = 0; k < 5; k++) add(new THREE.BoxGeometry(0.14, 0.22, 0.12), mat(['#ff4fa3', '#3ad7ff', '#ffd27a', '#9cff3a', '#c69bff'][(r + k) % 5]), -0.46 + k * 0.23, 0.33 + r * 0.5, 0);
      }
      break;
    }
    case 'crate_stack':
      for (const [x, y, z, r] of [[0, 0.22, 0, 0], [0.48, 0.22, 0.05, 0.2], [0.2, 0.66, 0.02, -0.15]] as const) add(rbox(0.45, 0.44, 0.45), mat(col ?? '#a8743a', { roughness: 0.85 }), x, y, z, r);
      break;
    case 'bin':
      add(rbox(0.5, 0.9, 0.55), mat(col ?? '#2f7a4a', { roughness: 0.6 }), 0, 0.45, 0);
      add(rbox(0.54, 0.06, 0.6), mat(col ?? '#2f7a4a', { roughness: 0.6 }), 0, 0.92, 0);
      for (const x of [-0.18, 0.18]) add(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 12), mat('#111'), x, 0.07, -0.25).rotation.z = Math.PI / 2;
      break;
    case 'umbrella_stand': {
      add(new THREE.CylinderGeometry(0.16, 0.14, 0.55, 18, 1, true), mat(col ?? '#3a3a44', { metalness: 0.6, side: THREE.DoubleSide }), 0, 0.28, 0);
      for (const [x, z, c] of [[0.04, 0.03, '#e83a3a'], [-0.05, 0.02, '#3a6db0'], [0, -0.05, '#ffd27a']] as const) {
        const u = add(new THREE.CylinderGeometry(0.035, 0.05, 0.9, 10), mat(c), x, 0.62, z);
        u.rotation.z = x * 2;
      }
      break;
    }
    case 'tv':
      add(rbox(1.3, 0.78, 0.06), mat('#111', { roughness: 0.3 }), 0, 0, 0);
      add(new THREE.PlaneGeometry(1.2, 0.68), glowMat(glow, 1.1), 0, 0, 0.035);
      break;
    case 'poster': {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 360;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#1a1824';
      ctx.fillRect(0, 0, 256, 360);
      ctx.strokeStyle = glow;
      ctx.lineWidth = 10;
      ctx.strokeRect(10, 10, 236, 340);
      ctx.fillStyle = glow;
      ctx.font = '900 46px system-ui, sans-serif';
      ctx.textAlign = 'center';
      const words = (p.text || 'new flavours').toUpperCase().split(' ');
      words.slice(0, 4).forEach((w, i) => ctx.fillText(w, 128, 120 + i * 56, 220));
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      add(new THREE.PlaneGeometry(0.62, 0.87), mat('#ffffff', { map: tex }), 0, 0, 0.01);
      break;
    }
    case 'rug':
      add(new THREE.CylinderGeometry(1.1, 1.1, 0.01, 40), mat(col ?? accent, { roughness: 0.95 }), 0, 0.006, 0).receiveShadow = true;
      break;
    case 'floor_lamp': {
      add(new THREE.CylinderGeometry(0.18, 0.2, 0.04, 20), mat('#222', { metalness: 0.7 }), 0, 0.02, 0);
      add(new THREE.CylinderGeometry(0.02, 0.02, 1.6, 8), mat('#222', { metalness: 0.7 }), 0, 0.82, 0);
      add(new THREE.ConeGeometry(0.25, 0.32, 20, 1, true), mat(col ?? '#e9d8b8', { side: THREE.DoubleSide, emissive: '#ffcf8a', emissiveIntensity: 0.6 }), 0, 1.65, 0);
      const l = new THREE.PointLight('#ffcf8a', 5, 5);
      l.position.set(0, 1.55, 0);
      g.add(l);
      break;
    }
    case 'fridge':
      add(rbox(0.8, 1.9, 0.7), mat(col ?? '#e8e8f0', { roughness: 0.3, metalness: 0.2 }), 0, 0.95, 0);
      add(new THREE.PlaneGeometry(0.66, 1.6), new THREE.MeshPhysicalMaterial({ color: '#bfe8ff', emissive: '#bfe8ff', emissiveIntensity: 0.5, roughness: 0.05, transparent: true, opacity: 0.7 }), 0, 1.0, 0.355);
      for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) add(new THREE.CylinderGeometry(0.04, 0.04, 0.22, 10), mat(['#3ad7ff', '#ff4fa3', '#ffd27a', '#9cff3a'][(r + k) % 4]), -0.24 + k * 0.16, 0.45 + r * 0.38, 0.1);
      break;
    case 'car': {
      const paint = mat(col ?? '#3a6df0', { roughness: 0.3, metalness: 0.6 });
      add(new RoundedBoxGeometry(1.8, 0.7, 4.0, 3, 0.15), paint, 0, 0.6, 0);
      add(new RoundedBoxGeometry(1.6, 0.6, 2.0, 3, 0.2), mat('#1a1d28', { roughness: 0.15, metalness: 0.6 }), 0, 1.2, -0.3);
      for (const [x, z] of [[-0.85, 1.3], [0.85, 1.3], [-0.85, -1.3], [0.85, -1.3]]) add(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 20), mat('#111'), x, 0.34, z).rotation.z = Math.PI / 2;
      for (const x of [-0.65, 0.65]) {
        add(new THREE.BoxGeometry(0.3, 0.12, 0.04), glowMat('#fff6c4', 2), x, 0.75, 2.01);
        add(new THREE.BoxGeometry(0.3, 0.12, 0.04), glowMat('#ff2233', 1.5), x, 0.8, -2.01);
      }
      break;
    }
    case 'bollard':
      add(new THREE.CylinderGeometry(0.1, 0.12, 0.9, 14), mat(col ?? '#2a2a30', { metalness: 0.5 }), 0, 0.45, 0);
      add(new THREE.CylinderGeometry(0.105, 0.105, 0.06, 14), glowMat('#ffd27a', 1.2), 0, 0.8, 0);
      break;
    case 'bike': {
      const frame = mat(col ?? '#e83a3a', { metalness: 0.5, roughness: 0.4 });
      for (const z of [-0.5, 0.5]) add(new THREE.TorusGeometry(0.33, 0.03, 8, 28), mat('#111'), 0, 0.34, z).rotation.y = Math.PI / 2;
      add(new THREE.CylinderGeometry(0.025, 0.025, 1.0, 8), frame, 0, 0.6, 0).rotation.x = Math.PI / 2;
      add(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 8), frame, 0, 0.5, 0.05).rotation.x = 0.6;
      add(new THREE.BoxGeometry(0.12, 0.04, 0.22), mat('#111'), 0, 0.85, -0.25);
      add(new THREE.CylinderGeometry(0.015, 0.015, 0.5, 8), frame, 0, 0.9, 0.42).rotation.z = Math.PI / 2;
      break;
    }
    case 'custom':
      for (const part of p.parts ?? []) g.add(buildPart(part));
      break;
  }
  g.scale.setScalar(p.scale ?? 1);
  g.rotation.y = p.rotY ?? 0;
  return g;
}
