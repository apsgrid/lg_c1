// Engine targets for a scene export: what goes in the zip for three.js, Godot,
// Unreal and Blender. Every target reads the same scene.glb + scene.json.
import blenderPy from '../../render/blender/vape_render.py?raw';
import godotGd from '../../render/godot/vape_scene.gd?raw';
import generatePy from '../../render/text3d/generate.py?raw';
import unrealPy from '../../render/unreal/vape_import.py?raw';
import type { ZipEntry } from '../util/zip';

export type EngineTarget = 'threejs' | 'godot' | 'unreal' | 'blender';
export const ENGINE_LABEL: Record<EngineTarget, string> = {
  threejs: 'three.js viewer', godot: 'Godot 4 project', unreal: 'Unreal render scripts', blender: 'Blender render script',
};

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** A single HTML file that shows the scene with the game's look; works offline except for loading three.js from a CDN. */
export function threeViewer(title: string, glb: Uint8Array, manifest: object): string {
  const esc = title.replace(/[<&"]/g, '');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc} · three.js</title>
<style>html,body{margin:0;height:100%;background:#09080f;overflow:hidden}canvas{display:block}#info{position:fixed;left:12px;bottom:10px;color:#a39fbb;font:12px system-ui,sans-serif}</style>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/"}}</script>
</head><body><div id="info">${esc} · drag to orbit · exported from Vape Wars</div>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
const M = ${JSON.stringify(manifest)};
const GLB = '${base64(glb)}';
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = M.look?.exposure ?? 1;
renderer.shadowMap.enabled = true;
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(M.backdrop?.[0] ?? '#14121c');
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = M.look?.environment ?? 0.35;
if (M.fog > 0.02) scene.fog = new THREE.FogExp2(M.backdrop?.[1] ?? '#09080f', 0.002 + M.fog * 0.03);
const hemi = (M.lights || []).find((l) => l.type === 'HemisphereLight');
if (hemi) scene.add(new THREE.HemisphereLight(hemi.colour, hemi.groundColour, hemi.intensity));
const c = M.camera;
const camera = new THREE.PerspectiveCamera(c.fovY, innerWidth / innerHeight, 0.05, 2000);
camera.position.fromArray(c.position);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.fromArray(c.target);
controls.enableDamping = true;
const bytes = Uint8Array.from(atob(GLB), (ch) => ch.charCodeAt(0));
new GLTFLoader().parse(bytes.buffer, '', (gltf) => {
  gltf.scene.traverse((o) => {
    if (o.isMesh) { o.castShadow = o.receiveShadow = true; }
    if (o.isDirectionalLight || o.isSpotLight) o.castShadow = true;
  });
  scene.add(gltf.scene);
});
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), M.look?.bloomStrength ?? 0.5, 0.5, M.look?.bloomThreshold ?? 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());
function resize() { renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize);
resize();
renderer.setAnimationLoop(() => { controls.update(); composer.render(); });
</script></body></html>
`;
}

export function godotFiles(title: string, glb: Uint8Array, manifest: object): ZipEntry[] {
  const name = title.replace(/"/g, "'");
  return [
    { name: 'godot/project.godot', data: `; Engine configuration file.
; Exported from Vape Wars. Open this folder in Godot 4.3 or later (Import → project.godot).

config_version=5

[application]

config/name="Vape Wars: ${name}"
run/main_scene="res://main.tscn"
config/features=PackedStringArray("4.3", "Forward Plus")

[rendering]

anti_aliasing/quality/msaa_3d=2
lights_and_shadows/directional_shadow/soft_shadow_filter_quality=3
` },
    { name: 'godot/main.tscn', data: `[gd_scene load_steps=3 format=3]

[ext_resource type="Script" path="res://vape_scene.gd" id="1_setup"]
[ext_resource type="PackedScene" path="res://scene.glb" id="2_scene"]

[node name="Main" type="Node3D"]
script = ExtResource("1_setup")

[node name="Scene" parent="." instance=ExtResource("2_scene")]
` },
    { name: 'godot/vape_scene.gd', data: godotGd },
    { name: 'godot/scene.glb', data: glb },
    { name: 'godot/scene.json', data: JSON.stringify(manifest, null, 2) },
    { name: 'godot/README.md', data: `# ${name} (Godot 4)

1. Open Godot 4.3 or later → **Import** → pick \`project.godot\` in this folder. Godot imports \`scene.glb\` the first time (a few seconds).
2. Press **F5** (or Play). \`main.tscn\` loads the scene and \`vape_scene.gd\` sets up the camera you framed in the game, the environment (backdrop, ambient light, ACES, glow, fog), the lights and the neon.
3. Tune on the **Main** node in the Inspector: *Light Scale*, *Glow Boost*, *Use SDFGI*.

Nodes named \`marker_*\` are gameplay markers (street targets, city locations, shop spots) for scripts to use.
To keep the scene editable, open \`scene.glb\` → *New Inherited Scene*, or right-click the Scene node → *Editable Children*.
` },
  ];
}

export function renderScripts(targets: EngineTarget[]): ZipEntry[] {
  const out: ZipEntry[] = [];
  if (targets.includes('unreal')) out.push({ name: 'scripts/vape_import.py', data: unrealPy }, { name: 'scripts/generate.py', data: generatePy });
  if (targets.includes('blender')) out.push({ name: 'scripts/vape_render.py', data: blenderPy });
  return out;
}

export function packageReadme(title: string, targets: EngineTarget[], extra: string[] = []): string {
  const lines = [`Vape Wars scene: ${title}`, '', 'scene.glb       the scene (meshes, materials, textures, lights, RenderCam, marker_* nodes)', 'scene.json      camera, lights, look, glowing nodes, markers (every engine reads this)'];
  if (targets.includes('threejs')) lines.push('threejs/        viewer.html: double-click to open the scene in a browser');
  if (targets.includes('godot')) lines.push('godot/          a Godot 4 project: open project.godot, press Play');
  if (targets.includes('unreal')) lines.push('scripts/vape_import.py   Unreal editor script (see render/README.md in the repo)', 'scripts/generate.py      text-to-3D models for Studio shots');
  if (targets.includes('blender')) lines.push('scripts/vape_render.py   Blender: blender --background --python scripts/vape_render.py -- .');
  return [...lines, ...extra].join('\n');
}
