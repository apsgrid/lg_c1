// Export what's on screen for a high-end render in Blender or Unreal: a .glb of
// the scene (meshes, PBR materials, canvas textures, lights, the camera) plus a
// render manifest (camera, lighting, backdrop and glow settings) zipped together.
// The scripts in render/ read the zip and build the render scene.
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
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
  /** Replaces the default README.txt. */
  readme?: string;
}

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
  let n = 0;
  scene.traverse((o) => {
    if ((o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints || o.userData.noExport) {
      if (o.visible) { o.visible = false; hidden.push(o); }
      return;
    }
    if ((o as THREE.Mesh).isMesh) {
      const mesh = o as THREE.Mesh;
      mesh.userData.role = roleOf(mesh);
      if (!mesh.name) mesh.name = `${mesh.userData.role}_${n++}`;
    }
    if ((o as THREE.Light).isLight && o.visible) {
      const l = o as THREE.Light;
      const p = new THREE.Vector3();
      l.getWorldPosition(p);
      const entry: Record<string, unknown> = { type: l.type, colour: hex(l.color), intensity: l.intensity, position: v3(p) };
      if (l instanceof THREE.PointLight) entry.distance = l.distance;
      if (l instanceof THREE.DirectionalLight) { const t = new THREE.Vector3(); l.target.getWorldPosition(t); entry.target = v3(t); }
      if (l instanceof THREE.HemisphereLight) entry.groundColour = hex(l.groundColor);
      if (!l.name) l.name = `${l.type}_${lights.length}`;
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
      backdrop: input.backdrop,
      look: { toneMapping: 'ACES filmic', exposure: input.renderer.toneMappingExposure, bloomStrength: input.bloom.strength, bloomThreshold: input.bloom.threshold },
      roles: {
        emissive: 'mesh extras.role = "emissive": neon, LEDs, bulbs. Boost emission and let bloom/glare pick them up.',
        unlit: 'mesh extras.role = "unlit": printed signs, window views, labels (KHR_materials_unlit). Keep them flat.',
        surface: 'everything else: ordinary PBR.',
      },
    };
    const readme = [
      `Vape Wars scene export: ${input.name}`,
      '',
      'scene.glb          meshes, materials, textures, lights, RenderCam + RenderTarget',
      'scene.render.json  camera, lights, backdrop and glow settings for the render scripts',
      '',
      'Blender: blender --background --python render/blender/vape_render.py -- <this zip>',
      'Unreal:  run render/unreal/vape_import.py from the editor (see render/README.md)',
    ].join('\n');
    return makeZip([
      { name: 'scene.glb', data: new Uint8Array(glb) },
      { name: 'scene.render.json', data: JSON.stringify(manifest, null, 2) },
      { name: 'README.txt', data: input.readme ?? readme },
      ...(input.extraFiles ?? []),
    ]);
  } finally {
    scene.remove(cam, aim);
    for (const o of hidden) o.visible = true;
  }
}
