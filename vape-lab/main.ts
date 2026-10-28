import './src/styles.css';
import { canMakeOwn } from './src/sim';
import { notifyShop, onShop, shopState } from './src/shopState';
import { data, state, subscribe } from './src/state';
import { h } from './src/ui/dom';
import { mountBranding } from './src/ui/branding';
import { mountFormula } from './src/ui/formula';
import { mountJournal } from './src/ui/journal';
import { mountLibrary } from './src/ui/library';
import { mountAssist, mountAuto, mountModeSwitch } from './src/ui/modes';
import { mountCounter, mountLedger, mountRegulars, mountRivals, mountShelf, openShop } from './src/ui/shop';
import { mountTesting, runTestBatch } from './src/ui/testing';
import { mountTuning } from './src/ui/tuning';
import { LabScene } from './src/view/scene';
import { ShopScene } from './src/view/shopScene';

type ViewId = 'lab' | 'shop';
const phone = window.matchMedia('(max-width: 860px)');
const app = document.getElementById('app')!;

// --- Top bar -------------------------------------------------------------------------
const viewSeg = h('div.seg.view-seg', { role: 'radiogroup', 'aria-label': 'View' });
const labTools = h('div.view-tools.lab-el');
const shopTools = h('div.view-tools.shop-el');
const top = h('header.topbar', {},
  h('div.brand-mark', {}, h('span.logo-dot'), h('b', {}, 'Vape Wars'), h('span.muted.sub', {}, ' · demo')),
  viewSeg, labTools, shopTools,
);
app.append(top);

interface Tab { id: string; label: string; mount: (el: HTMLElement) => void }

/** One view = a 3D stage, a left panel, and a tabbed right panel. On phones the left panel is the first tab. */
function makeView(view: ViewId, leftLabel: string, tabs: Tab[]) {
  const cls = `${view}-el`;
  const stage = h('div.stage', { class: cls });
  const left = h('aside.panel.left', { class: cls });
  const right = h('aside.panel.right', { class: cls });
  const tabBar = h('nav.tabs', { class: cls, role: 'tablist', 'aria-label': `${view} panels` });
  app.append(stage, left, tabBar, right);
  const all: Tab[] = [{ id: 'left', label: leftLabel, mount: () => undefined }, ...tabs];
  const bodies = new Map<string, HTMLElement>();
  const buttons = new Map<string, HTMLButtonElement>();
  let current = '';
  const key = `vapelab.v1.tab.${view}`;
  const select = (id: string) => {
    if (id === 'left' && !phone.matches) id = tabs[0].id;
    current = id;
    if (app.dataset.view === view) app.classList.toggle('show-left', id === 'left');
    for (const [k, el] of bodies) el.hidden = k !== id;
    for (const [k, b] of buttons) {
      b.classList.toggle('on', k === id);
      b.setAttribute('aria-selected', String(k === id));
    }
    try { localStorage.setItem(key, id); } catch { /* ignore */ }
  };
  const mountTabs = () => {
    for (const t of all) {
      const btn = h('button.tab', { role: 'tab', onclick: () => select(t.id) }, t.label);
      const body = h('section.tab-body', { role: 'tabpanel' });
      t.mount(body);
      tabBar.append(btn);
      right.append(body);
      bodies.set(t.id, body);
      buttons.set(t.id, btn);
    }
    let initial = phone.matches ? 'left' : tabs[0].id;
    try { initial = localStorage.getItem(key) || initial; } catch { /* ignore */ }
    select(bodies.has(initial) ? initial : tabs[0].id);
  };
  return { stage, left, right, buttons, select, mountTabs, current: () => current };
}

// --- Lab view -------------------------------------------------------------------------
const lab = makeView('lab', 'Mix', [
  { id: 'tune', label: 'Tune', mount: (el) => mountTuning(el) },
  { id: 'brand', label: 'Brand', mount: (el) => mountBranding(el) },
  { id: 'test', label: 'Test', mount: (el) => mountTesting(el, labScene) },
  { id: 'journal', label: 'Journal', mount: (el) => mountJournal(el) },
  { id: 'library', label: 'Library', mount: (el) => mountLibrary(el) },
  { id: 'auto', label: 'Auto', mount: (el) => mountAuto(el) },
]);
const labScene = new LabScene(lab.stage, data);
mountFormula(lab.left, labScene);
mountAssist(lab.left);
lab.mountTabs();
const modeHost = h('div.mode-host');
labTools.append(modeHost, h('button.primary.test-top', { onclick: () => void runTestBatch(), title: 'Shortcut: T' }, 'Test batch'));
mountModeSwitch(modeHost, () => lab.select('auto'));

subscribe((reason) => {
  if (reason === 'result' && state.lastResult?.newlyDiscovered.length) lab.buttons.get('journal')?.classList.add('badge');
  if (reason === 'result') lab.select('test');
});
lab.buttons.get('journal')?.addEventListener('click', () => lab.buttons.get('journal')?.classList.remove('badge'));
labScene.setProduct(state.product);
subscribe(() => labScene.setProduct(state.product));

// --- Shop view ------------------------------------------------------------------------
const shop = makeView('shop', 'Shelf', [
  { id: 'counter', label: 'Counter', mount: (el) => mountCounter(el) },
  { id: 'regulars', label: 'Regulars', mount: (el) => mountRegulars(el) },
  { id: 'rivals', label: 'Rivals', mount: (el) => mountRivals(el) },
  { id: 'ledger', label: 'Ledger', mount: (el) => mountLedger(el) },
]);
const shopScene = new ShopScene(shop.stage, data);
mountShelf(shop.left, shopScene);
shop.mountTabs();
const openTop = h('button.primary.open-top', { onclick: () => void openShop() });
const cashChip = h('span.cash-chip');
shopTools.append(cashChip, openTop);
const renderShopTop = () => {
  const s = shopState.shop;
  openTop.textContent = shopState.playing ? 'Skip day' : `Open day ${s.day}`;
  cashChip.textContent = `${Math.round(s.cash)} cr`;
  cashChip.classList.toggle('bad', s.cash < 0);
};
onShop((reason) => {
  renderShopTop();
  app.classList.toggle('encounter-open', !!shopState.encounter);
  if (reason === 'playing' || reason === 'encounter') shop.select('counter');
  if (reason === 'day') {
    shop.select('counter');
    if (shopState.lastReport?.events.some((e) => e.kind === 'knockoff')) shop.buttons.get('rivals')?.classList.add('badge');
  }
});
shop.buttons.get('rivals')?.addEventListener('click', () => shop.buttons.get('rivals')?.classList.remove('badge'));
renderShopTop();
shopScene.setShop(shopState.shop);

// --- Lab lock: you mix your own flavours once you've moved into the garage ------------
const labLock = h('div.lab-lock.lab-el', {},
  h('div.lock-card', {},
    h('div.lock-icon', { 'aria-hidden': 'true' }, '🔒'),
    h('h2', {}, 'The Lab opens in your garage'),
    h('p', {}, 'Right now you\'re selling ready-made supplier stock from the boot of your car. Build your reputation and savings, move into a garage, and you can start mixing your own flavours here.'),
    h('button.primary.big', { onclick: () => setView('shop') }, 'Back to the car'),
  ),
);
app.append(labLock);
const renderLabLock = () => {
  const locked = !canMakeOwn(shopState.shop);
  labLock.hidden = !locked;
  app.classList.toggle('lab-locked', locked);
  const b = viewSeg.querySelector<HTMLElement>('[data-view="lab"]');
  if (b) b.textContent = locked ? 'Lab 🔒' : 'Lab';
};
onShop(renderLabLock);

// --- View switching -------------------------------------------------------------------
function setView(v: ViewId): void {
  app.dataset.view = v;
  labScene.setActive(v === 'lab');
  shopScene.setActive(v === 'shop');
  const active = v === 'lab' ? lab : shop;
  active.select(active.current());
  for (const b of viewSeg.children) {
    const on = (b as HTMLElement).dataset.view === v;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  }
  if (v === 'shop') {
    shopScene.setShop(shopState.shop);
    notifyShop('view');
  }
  try { localStorage.setItem('vapelab.v1.view', v); } catch { /* ignore */ }
}
for (const [id, label] of [['lab', 'Lab'], ['shop', 'Shop']] as const) {
  viewSeg.append(h('button', { role: 'radio', 'data-view': id, onclick: () => setView(id) }, label));
}
// New players start at the car boot; returning players land where they left off.
let startView: ViewId = canMakeOwn(shopState.shop) ? 'lab' : 'shop';
try { startView = (localStorage.getItem('vapelab.v1.view') as ViewId) || startView; } catch { /* ignore */ }
setView(startView === 'shop' ? 'shop' : 'lab');
renderLabLock();
phone.addEventListener('change', () => setView(app.dataset.view as ViewId));

window.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if ((e.key === 't' || e.key === 'T') && app.dataset.view === 'lab') void runTestBatch();
  if ((e.key === 'o' || e.key === 'O') && app.dataset.view === 'shop') void openShop();
});
