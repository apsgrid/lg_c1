import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/** Phones and low-core machines get a lighter bloom. */
const LIGHT = typeof navigator !== 'undefined' && ((navigator.hardwareConcurrency ?? 8) <= 4 || /Mobi|Android|iPhone/i.test(navigator.userAgent));

/**
 * Shared look for both scenes: soft studio reflections (a generated room
 * environment, no image files) and a bloom pass so neon, LEDs and screens glow.
 */
export class Post {
  readonly composer: EffectComposer;
  private bloom: UnrealBloomPass;

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, opts: { bloom?: number; envIntensity?: number; threshold?: number } = {}) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = opts.envIntensity ?? 0.35;
    pmrem.dispose();

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), opts.bloom ?? 0.55, 0.5, opts.threshold ?? 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  setSize(w: number, h: number): void {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    // Bloom at half (or quarter on phones) resolution: it's blurry anyway.
    const k = LIGHT ? 0.25 : 0.5;
    this.bloom.resolution.set(Math.max(1, w * k), Math.max(1, h * k));
  }

  render(): void {
    this.composer.render();
  }
}

let blobTex: THREE.Texture | null = null;
/** A soft round shadow texture for blob shadows under people and props. */
export function blobShadowTexture(): THREE.Texture {
  if (blobTex) return blobTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.25)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  blobTex = new THREE.CanvasTexture(c);
  blobTex.userData.shared = true;
  return blobTex;
}
