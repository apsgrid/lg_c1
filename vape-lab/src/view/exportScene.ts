// Export what's on screen for three.js, Godot, Unreal or Blender: a .glb of the scene
// (meshes, PBR materials, canvas textures, lights, the camera, marker_* nodes) plus
// scene.json (camera, lights, look, glowing nodes, gameplay markers), zipped with
// whichever engine targets were picked (src/export/engines.ts).
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { godotFiles, packageReadme, renderScripts, threeViewer, type EngineTarget } from '../export/engines';
import { makeZip, type ZipEntry } from '../util/zip';

export interface ExportInput {
  /** File-friendly base name, e.g. "shop-beach-medium". */
  name: string;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  target: THREE.Vector3;
  renderer: THREE.WebGLRenderer;
  /** The scene's on-screen glow (bloom) settings. */
  bloom: { strength: number; threshold: number };
  /** Backdrop colours behind the scene (top, bottom). */
  backdrop: [string, string];
  /** Anything else worth knowing: view, tier, district, shop name... */
  info: Record<string, unknown>;
  /** More files for the zip (the Studio's spec, asset plan, instructions). */
  extraFiles?: ZipEntry[];
  /** Extra README lines (the Studio adds its files). */
  readme?: string[];
  /** Engines to package for (default: all). */
  targets?: EngineTarget[];
}

export const ALL_TARGETS: EngineTarget[] = ['threejs', 'godot', 'unreal', 'blender'];

const hex = (c: THREE.Color) => `#${c.getHexString()}`;
const v3 = (v: THREE.Vector3) => [+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)];

/** How a renderer should treat a mesh: things that glow, flat-shaded prints and screens, or ordinary surfaces. */
function roleOf(mesh: THREE.Mesh): 'emissive' | 'unlit' | 'surface' {
  const m = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material & { emissive?: THREE.Color; emissiveIntensity?: number };
  if (m instanceof THREE.MeshBasicMaterial) return 'unlit';
  if (m.emissive && (m.emissiveIntensity ?? 0) * Math.max(m.emissive.r, m.emissive.g, m.emissive.b) > 0.25) return 'emissive';
  return 'surface';
}

export async function exportScene(input: ExportInput): Promise<Uint8Array> {
  const { scene, camera, target } = input;
  scene.updateMatrixWorld(true);
  // Hide what only makes sense in the browser: sprites, particles, fake blob shadows.
  const hidden: THREE.Object3D[] = [];
  const lights: Record<string, unknown>[] = [];
  const emissiveNodes: string[] = [];
  const lightNames = new Set<string>();
  const markers: Record<string, unknown>[] = [];
  let n = 0;
  scene.traverse((o) => {
    if ((o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints || o.userData.noExport) {
      if (o.visible) { o.visible = false; hidden.push(o); }
      return;
    }
    if ((o as THREE.Mesh).isMesh) {
      const mesh = o as THREE.Mesh;
      mesh.userData.role = roleOf(mesh);
      // Name every glowing mesh uniquely so engines can find them (keeping the original name).
      if (mesh.userData.baseName === undefined) mesh.userData.baseName = mesh.name;
      if (!mesh.userData.baseName || mesh.userData.role === 'emissive') mesh.name = `${mesh.userData.baseName || mesh.userData.role}_${n++}`;
      if (mesh.userData.role === 'emissive') emissiveNodes.push(mesh.name);
    }
    if (o.name.startsWith('marker_')) {
      const p = new THREE.Vector3();
      o.getWorldPosition(p);
      markers.push({ name: o.name, position: v3(p), ...o.userData });
    }
    if ((o as THREE.Light).isLight && o.visible) {
      const l = o as THREE.Light;
      const p = new THREE.Vector3();
      l.getWorldPosition(p);
      const entry: Record<string, unknown> = { type: l.type, colour: hex(l.color), intensity: l.intensity, position: v3(p) };
      if (l instanceof THREE.PointLight) entry.distance = l.distance;
      if (l instanceof THREE.DirectionalLight) { const t = new THREE.Vector3(); l.target.getWorldPosition(t); entry.target = v3(t); }
      if (l instanceof THREE.HemisphereLight) entry.groundColour = hex(l.groundColor);
      // Unique names, so engines can match each light to its settings.
      if (l.userData.baseName === undefined) l.userData.baseName = l.name || l.type;
      const base = l.userData.baseName as string;
      l.name = lightNames.has(base) ? `${base}_${lights.length}` : base;
      lightNames.add(l.name);
      entry.name = l.name;
      lights.push(entry);
    }
  });
  // The render camera, and a marker where it's looking (so importers needn't convert axes).
  const cam = camera.clone();
  cam.name = 'RenderCam';
  const aim = new THREE.Object3D();
  aim.name = 'RenderTarget';
  aim.position.copy(target);
  scene.add(cam, aim);
  try {
    const glb = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: true, maxTextureSize: 2048 }) as ArrayBuffer;
    const manifest = {
      format: 'vape-wars-scene',
      version: 1,
      exportedAt: new Date().toISOString(),
      units: 'metres, Y up (glTF)',
      ...input.info,
      camera: { position: v3(camera.position), target: v3(target), fovY: camera.fov, aspect: +camera.aspect.toFixed(4), near: camera.near, far: camera.far },
      lights,
      emissiveNodes,
      markers,
      backdrop: input.backdrop,
      look: { toneMapping: 'ACES filmic', exposure: input.renderer.toneMappingExposure, bloomStrength: input.bloom.strength, bloomThreshold: input.bloom.threshold, environment: scene.environmentIntensity },
      roles: {
        emissive: 'mesh extras.role = "emissive": neon, LEDs, bulbs. Boost emission and let bloom/glare pick them up.',
        unlit: 'mesh extras.role = "unlit": printed signs, window views, labels (KHR_materials_unlit). Keep them flat.',
        surface: 'everything else: ordinary PBR.',
      },
    };
    const bytes = new Uint8Array(glb);
    const targets = input.targets ?? ALL_TARGETS;
    const title = String(input.info.title ?? input.name);
    const json = JSON.stringify(manifest, null, 2);
    return makeZip([
      { name: 'scene.glb', data: bytes },
      { name: 'scene.json', data: json },
      // The Unreal and Blender scripts read this name.
      ...(targets.includes('unreal') || targets.includes('blender') ? [{ name: 'scene.render.json', data: json }] : []),
      { name: 'README.txt', data: packageReadme(title, targets, input.readme) },
      ...(targets.includes('threejs') ? [{ name: 'threejs/viewer.html', data: threeViewer(title, bytes, manifest) }] : []),
      ...(targets.includes('godot') ? godotFiles(title, bytes, manifest) : []),
      ...renderScripts(targets),
      ...(input.extraFiles ?? []),
    ]);
  } finally {
    scene.remove(cam, aim);
    for (const o of hidden) o.visible = true;
  }
}
