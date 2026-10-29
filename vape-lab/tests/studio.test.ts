import { describe, expect, it } from 'vitest';
import { assetPlan, shoppingList, text3dPrompts, unrealPrompt } from '../src/studio/package';
import { defaultSpec, normalizeSpec, sketchSpec } from '../src/studio/spec';

describe('shot spec', () => {
  it('normalizes junk into a valid spec and keeps what is valid', () => {
    const s = normalizeSpec({
      title: 'Test', setting: 'moon', district: 'beach', weather: { rain: 7, fog: -1 }, palette: { accent: '#ABCDEF', wall: 'red' },
      camera: { shot: 'low', lens: 500, custom: { position: [1, 2, 3], target: [0, 1, 0] } },
      props: [
        { id: 'a', kind: 'plant', spot: 'door', asset: { route: 'library' } },
        { id: 'a', kind: 'nope', spot: 'nowhere', asset: { route: 'text3d' } },
        { kind: 'custom', parts: [] },
        { kind: 'custom', parts: [{ shape: 'box', size: [1, 1, 1], at: [0, 0.5, 0], colour: '#ff0000' }] },
      ],
    });
    expect(s.setting).toBe('interior');
    expect(s.district).toBe('beach');
    expect(s.weather).toEqual({ rain: 1, fog: 0 });
    expect(s.palette.accent).toBe('#abcdef');
    expect(s.palette.wall).toBe(defaultSpec().palette.wall);
    expect(s.camera.lens).toBe(135);
    expect(s.camera.custom?.position).toEqual([1, 2, 3]);
    expect(s.props).toHaveLength(3);
    expect(new Set(s.props.map((p) => p.id)).size).toBe(3);
    expect(s.props[0].asset.query).toBeTruthy();
    expect(s.props[1].kind).toBe('crate_stack');
    expect(s.props[1].spot).toBe('centre');
    expect(s.props[1].asset.prompt).toBeTruthy();
    expect(s.props[2].kind).toBe('custom');
  });

  it('sketches a spec from plain words when Claude is unavailable', () => {
    const { spec, changes } = sketchSpec('Rainy late night shopfront on the neon mile, purple and teal, moody, low angle, add an arcade', defaultSpec());
    expect(spec.setting).toBe('shopfront');
    expect(spec.district).toBe('neon_mile');
    expect(spec.weather.rain).toBeGreaterThan(0.5);
    expect(spec.time).toBe('late');
    expect(spec.palette.accent).toBe('#9a5cff');
    expect(spec.camera.shot).toBe('low');
    expect(changes.length).toBeGreaterThan(4);
  });
});

describe('approval package', () => {
  it('plans every prop with its route, size and the right extras', () => {
    const spec = defaultSpec();
    const plan = assetPlan(spec, [{ id: 'plant1', position: [1, 0, 2], size: [0.6, 1.2, 0.6], rotationY: 0 }]);
    expect(plan).toHaveLength(spec.props.length);
    const lib = plan.find((p) => p.route === 'library')!;
    expect(lib.fabUrl).toContain('fab.com/search?q=');
    expect(lib.size).toEqual([0.6, 1.2, 0.6]);
    const gen = plan.find((p) => p.route === 'text3d')!;
    expect(gen.generatedFile).toBe(`generated/${gen.id}.glb`);
    expect(shoppingList(plan)).toContain(lib.query!);
    expect(text3dPrompts(plan)).toContain(gen.prompt!);
    const prompt = unrealPrompt(spec, plan, { resolution: '3840x2160', quality: 'final', motion: 'push-in' }, 'x.zip');
    expect(prompt).toContain('3840x2160');
    expect(prompt).toContain('vape_import.py');
  });
});
