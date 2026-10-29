// Studio state: the current shot spec, its versions, the chat, and approved shots.
// Kept in localStorage per browser.
import { defaultSpec, normalizeSpec, type ShotSpec } from './spec';
import type { EngineTarget } from '../export/engines';
import type { RenderOptions } from './package';

export interface ChatTurn { role: 'user' | 'assistant'; content: string; version?: number; note?: string }
export interface Version { n: number; spec: ShotSpec; note: string; at: string }
export interface Approved { title: string; at: string; zip: string; spec: ShotSpec; options: RenderOptions }

const KEY = 'vapelab.v1.studio';

interface Saved { spec: ShotSpec; versions: Version[]; chat: ChatTurn[]; approved: Approved[]; options: RenderOptions; targets: EngineTarget[] }

function load(): Saved {
  const fresh = defaultSpec();
  const base: Saved = { spec: fresh, versions: [{ n: 1, spec: fresh, note: 'Starting shot', at: new Date().toISOString() }], chat: [], approved: [], options: { resolution: '1920x1080', quality: 'high', motion: 'still' }, targets: ['threejs', 'godot', 'unreal'] };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const s = JSON.parse(raw) as Partial<Saved>;
    return {
      spec: normalizeSpec(s.spec),
      versions: (s.versions ?? base.versions).map((v) => ({ ...v, spec: normalizeSpec(v.spec) })),
      chat: s.chat ?? [],
      approved: s.approved ?? [],
      options: { ...base.options, ...(s.options ?? {}) },
      targets: Array.isArray(s.targets) ? s.targets : base.targets,
    };
  } catch {
    return base;
  }
}

export const studio = load();
const subs = new Set<(reason: string) => void>();
export function onStudio(fn: (reason: string) => void): void { subs.add(fn); }

export function saveStudio(reason: string): void {
  try {
    // Keep the save small: the last 40 chat turns and 30 versions.
    studio.chat = studio.chat.slice(-40);
    studio.versions = studio.versions.slice(-30);
    studio.approved = studio.approved.slice(-20);
    localStorage.setItem(KEY, JSON.stringify(studio));
  } catch { /* storage full or blocked: keep going in memory */ }
  for (const fn of subs) fn(reason);
}

/** A new version of the shot (from the chat, or a loaded spec). */
export function commitSpec(spec: ShotSpec, note: string): Version {
  const n = (studio.versions.at(-1)?.n ?? 0) + 1;
  const v = { n, spec, note, at: new Date().toISOString() };
  studio.spec = spec;
  studio.versions.push(v);
  saveStudio('spec');
  return v;
}

/** A small hand edit: changes the current shot without making a new version. */
export function editSpec(fn: (s: ShotSpec) => void): void {
  const s: ShotSpec = JSON.parse(JSON.stringify(studio.spec));
  fn(s);
  studio.spec = normalizeSpec(s, studio.spec);
  saveStudio('edit');
}
