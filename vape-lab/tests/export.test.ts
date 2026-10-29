import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/sim';
import { buildStreet, buildTraffic } from '../src/street/layout';
import { defaultSpec, normalizeSpec, sketchSpec } from '../src/studio/spec';
import { godotFiles, packageReadme, threeViewer } from '../src/export/engines';
import { themeFor } from '../src/view/districtTheme';

describe('scenes beyond the shop', () => {
  it('specs carry the scene and street options, with safe defaults', () => {
    const s = normalizeSpec({ scene: 'street', street: { mode: 'delivery', aftermath: true } });
    expect(s.scene).toBe('street');
    expect(s.street).toEqual({ mode: 'delivery', rival: 'cloud_kings', aftermath: true });
    expect(normalizeSpec({ scene: 'moon' }).scene).toBe('shop');
    const old = normalizeSpec({ title: 'Old save' }, { ...defaultSpec(), scene: undefined as never, street: undefined as never });
    expect(old.scene).toBe('shop');
  });

  it('the offline sketcher picks streets, the city and aftermaths', () => {
    expect(sketchSpec('firebomb run on puff palace, fronts on fire', defaultSpec()).spec).toMatchObject({ scene: 'street', street: { mode: 'firebomb', rival: 'puff_palace', aftermath: true } });
    expect(sketchSpec('night round deliveries in the suburbs', defaultSpec()).spec).toMatchObject({ scene: 'street', district: 'suburbs', street: { mode: 'delivery' } });
    expect(sketchSpec('aerial shot of the whole city skyline at dusk', defaultSpec()).spec).toMatchObject({ scene: 'city', time: 'dusk' });
  });

  it('a seeded street lays out the same every time, with every target', () => {
    const lay = () => buildStreet({ mode: 'firebomb', rivalName: 'Cloud Kings', rivalColour: '#ff5a5a' }, 'towers', themeFor('cbd'), mulberry32(42));
    const a = lay(), b = lay();
    expect(a).toEqual(b);
    expect(a.lots.filter((l) => l.kind === 'rival')).toHaveLength(4);
    expect(buildTraffic(a.end, 0.5, mulberry32(1))).toEqual(buildTraffic(a.end, 0.5, mulberry32(1)));
  });
});

describe('engine targets', () => {
  const glb = new Uint8Array([103, 108, 84, 70, 2, 0, 0, 0]);
  const manifest = { title: 'Test', camera: { position: [1, 2, 3], target: [0, 0, 0], fovY: 50 }, lights: [], emissiveNodes: ['emissive_1'], markers: [] };

  it('the zip is the Godot project, loading scene.glb with the setup script', () => {
    const files = Object.fromEntries(godotFiles('Test "shot"').map((f) => [f.name, f.data]));
    expect(Object.keys(files).sort()).toEqual(['README_GODOT.md', 'main.tscn', 'project.godot', 'vape_scene.gd']);
    expect(files['project.godot']).toContain('run/main_scene="res://main.tscn"');
    expect(files['project.godot']).not.toContain('"shot"');
    expect(files['main.tscn']).toContain('path="res://scene.glb"');
    expect(files['main.tscn']).toContain('path="res://vape_scene.gd"');
    expect(files['vape_scene.gd']).toContain('extends Node3D');
  });

  it('a street export adds the playable run as the main scene', () => {
    const files = Object.fromEntries(godotFiles('Street', { mode: 'firebomb', targets: [] }).map((f) => [f.name, f.data]));
    expect(files['project.godot']).toContain('run/main_scene="res://run.tscn"');
    expect(files['run.tscn']).toContain('make_camera = false');
    expect(files['run.tscn']).toContain('parent="Setup" instance=ExtResource("3_scene")');
    expect(files['run.gd']).toContain('func _land_on_front');
    expect(JSON.parse(files['run.json'] as string).mode).toBe('firebomb');
  });

  it('three.js gets a self-contained viewer with the scene embedded', () => {
    const html = threeViewer('Test', glb, manifest);
    expect(html).toContain('three@0.169.0');
    expect(html).toContain(btoa(String.fromCharCode(...glb)));
    expect(html).toContain('"fovY":50');
  });

  it('the readme lists what each picked target adds', () => {
    expect(packageReadme('X', ['godot'])).toContain('project.godot');
    expect(packageReadme('X', ['godot'])).not.toContain('threejs/');
  });
});
