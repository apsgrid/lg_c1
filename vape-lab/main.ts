import './src/styles.css';
import { data, state, subscribe } from './src/state';
import { h } from './src/ui/dom';
import { mountBranding } from './src/ui/branding';
import { mountFormula } from './src/ui/formula';
import { mountJournal } from './src/ui/journal';
import { mountLibrary } from './src/ui/library';
import { mountAssist, mountAuto, mountModeSwitch } from './src/ui/modes';
import { mountTesting, runTestBatch } from './src/ui/testing';
import { mountTuning } from './src/ui/tuning';
import { LabScene } from './src/view/scene';

const app = document.getElementById('app')!;
const stage = h('div.stage');
const left = h('aside.panel.left');
const right = h('aside.panel.right');
const top = h('header.topbar', {},
  h('div.brand-mark', {}, h('span.logo-dot'), h('b', {}, 'Vape Lab'), h('span.muted', {}, ' · Vape Wars demo')),
);
const modeHost = h('div.mode-host');
top.append(modeHost, h('button.primary.test-top', { onclick: () => void runTestBatch(), title: 'Shortcut: T' }, 'Test batch'));
app.append(top, stage, left, right);

const scene = new LabScene(stage, data);

// Left: formula + live radar + assisted advice.
mountFormula(left, scene);
mountAssist(left);

// Right: tabbed panels.
const TABS = [
  { id: 'tune', label: 'Tune', mount: (el: HTMLElement) => mountTuning(el) },
  { id: 'brand', label: 'Brand', mount: (el: HTMLElement) => mountBranding(el) },
  { id: 'test', label: 'Test', mount: (el: HTMLElement) => mountTesting(el, scene) },
  { id: 'journal', label: 'Journal', mount: (el: HTMLElement) => mountJournal(el) },
  { id: 'library', label: 'Library', mount: (el: HTMLElement) => mountLibrary(el) },
  { id: 'auto', label: 'Auto', mount: (el: HTMLElement) => mountAuto(el) },
] as const;
type TabId = (typeof TABS)[number]['id'];

const tabBar = h('nav.tabs', { role: 'tablist' });
const bodies = new Map<TabId, HTMLElement>();
const buttons = new Map<TabId, HTMLButtonElement>();
right.append(tabBar);
for (const t of TABS) {
  const btn = h('button.tab', { role: 'tab', onclick: () => select(t.id) }, t.label);
  const body = h('section.tab-body', { role: 'tabpanel' });
  t.mount(body);
  tabBar.append(btn);
  right.append(body);
  bodies.set(t.id, body);
  buttons.set(t.id, btn);
}

function select(id: TabId): void {
  for (const [k, el] of bodies) el.hidden = k !== id;
  for (const [k, b] of buttons) {
    b.classList.toggle('on', k === id);
    b.setAttribute('aria-selected', String(k === id));
  }
  try { localStorage.setItem('vapelab.v1.tab', id); } catch { /* ignore */ }
}
let initial: TabId = 'tune';
try { initial = (localStorage.getItem('vapelab.v1.tab') as TabId) || 'tune'; } catch { /* ignore */ }
select(bodies.has(initial) ? initial : 'tune');

mountModeSwitch(modeHost, () => select('auto'));

// Journal tab gets a badge when something new is found.
subscribe((reason) => {
  if (reason === 'result' && state.lastResult?.newlyDiscovered.length) buttons.get('journal')?.classList.add('badge');
  if (reason === 'result') select('test');
});
buttons.get('journal')?.addEventListener('click', () => buttons.get('journal')?.classList.remove('badge'));

// Keep the 3D model in sync with the working product.
scene.setProduct(state.product);
subscribe(() => scene.setProduct(state.product));

window.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (e.key === 't' || e.key === 'T') void runTestBatch();
});
