import './src/styles.css';
import { canMakeOwn, cityLoc, sellLocId, tierOf } from './src/sim';
import { notifyShop, onShop, shopState } from './src/shopState';
import { data, state, subscribe } from './src/state';
import { h } from './src/ui/dom';
import { mountBranding } from './src/ui/branding';
import { mountFormula } from './src/ui/formula';
import { mountJournal } from './src/ui/journal';
import { mountLibrary } from './src/ui/library';
import { mountAssist, mountAuto, mountModeSwitch } from './src/ui/modes';
import { mountCityMap, mountCityOverview, mountCityPanel, mountCityRivals, onPlaceTapped } from './src/ui/city';
import { showEnding } from './src/ui/ending';
import { mountCounter, mountLedger, mountRegulars, mountShelf, openShop } from './src/ui/shop';
import { mountTesting, runTestBatch } from './src/ui/testing';
import { mountOrders } from './src/ui/orders';
import { mountTuning } from './src/ui/tuning';
import { LabScene } from './src/view/scene';
import { ShopScene } from './src/view/shopScene';
import { themeFor } from './src/view/districtTheme';
import { exportScene, type ExportInput } from './src/view/exportScene';
import { offerDownload } from './src/ui/download';
import { toast } from './src/ui/toast';

type ViewId = 'lab' | 'shop' | 'city';
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

/** `more` tabs sit behind a "More" button on phones so the tab bar stays readable. */
interface Tab { id: string; label: string; mount: (el: HTMLElement) => void; more?: boolean }

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
    const sec = all.find((t) => t.id === id && t.more);
    moreBtn.classList.toggle('on', !!sec);
    moreBtn.textContent = sec ? `${sec.label} ▴` : 'More ▴';
    moreMenu.hidden = true;
    try { localStorage.setItem(key, id); } catch { /* ignore */ }
  };
  // Phones: secondary tabs live in a small menu above the tab bar.
  const moreBtn = h('button.tab.more-btn', { 'aria-haspopup': 'true', onclick: () => { moreMenu.hidden = !moreMenu.hidden; } }, 'More ▴');
  const moreMenu = h('div.more-menu', { role: 'menu', hidden: true });
  const syncMoreBadge = () => moreBtn.classList.toggle('badge', [...buttons.entries()].some(([k, b]) => all.find((t) => t.id === k)?.more && b.classList.contains('badge')));
  const mountTabs = () => {
    for (const t of all) {
      const btn = h('button.tab', { role: 'tab', class: t.more ? 'secondary' : '', onclick: () => select(t.id) }, t.label);
      const body = h('section.tab-body', { role: 'tabpanel' });
      t.mount(body);
      tabBar.append(btn);
      right.append(body);
      bodies.set(t.id, body);
      buttons.set(t.id, btn);
      if (t.more) {
        moreMenu.append(h('button', { role: 'menuitem', onclick: () => { select(t.id); btn.classList.remove('badge'); syncMoreBadge(); } }, t.label));
        new MutationObserver(syncMoreBadge).observe(btn, { attributes: true, attributeFilter: ['class'] });
      }
    }
    if (all.some((t) => t.more)) tabBar.append(moreBtn, moreMenu);
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
  { id: 'orders', label: 'Orders', mount: (el) => mountOrders(el, () => lab.buttons.get('orders')?.classList.add('badge')) },
  { id: 'journal', label: 'Journal', mount: (el) => mountJournal(el), more: true },
  { id: 'library', label: 'Library', mount: (el) => mountLibrary(el), more: true },
  { id: 'auto', label: 'Auto', mount: (el) => mountAuto(el), more: true },
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
lab.buttons.get('orders')?.addEventListener('click', () => lab.buttons.get('orders')?.classList.remove('badge'));
labScene.setProduct(state.product);
subscribe(() => labScene.setProduct(state.product));

// --- Shop view ------------------------------------------------------------------------
const shop = makeView('shop', 'Shelf', [
  { id: 'counter', label: 'Counter', mount: (el) => mountCounter(el) },
  { id: 'regulars', label: 'Regulars', mount: (el) => mountRegulars(el) },
  { id: 'ledger', label: 'Ledger', mount: (el) => mountLedger(el) },
]);
const shopScene = new ShopScene(shop.stage, data);
mountShelf(shop.left, shopScene);
shop.mountTabs();
const openTop = h('button.primary.open-top', { onclick: () => void openShop() });
const cashChip = h('span.cash-chip');
const heatChip = h('span.heat-chip', { title: 'Heat: police attention. See the City view.' });
shopTools.append(heatChip, cashChip, openTop);
const renderShopTop = () => {
  const s = shopState.shop;
  openTop.textContent = shopState.playing ? 'Skip day' : `Open day ${s.day}`;
  cashChip.textContent = `${Math.round(s.cash)} cr`;
  cashChip.classList.toggle('bad', s.cash < 0);
  heatChip.textContent = `🔥 ${Math.round(s.heat)}`;
  heatChip.className = `heat-chip ${s.heat >= 70 ? 'bad' : s.heat >= 45 ? 'warn' : ''}`;
};
onShop((reason) => {
  renderShopTop();
  app.classList.toggle('encounter-open', !!shopState.encounter);
  if (reason === 'playing' || reason === 'encounter') shop.select('counter');
  if (reason === 'day') {
    shop.select('counter');
    const events = shopState.lastReport?.events ?? [];
    if (events.some((e) => e.kind === 'knockoff' || e.kind === 'turf')) {
      city.buttons.get('rivals')?.classList.add('badge');
      viewSeg.querySelector('[data-view="city"]')?.classList.add('badge');
    }
    const end = events.find((e) => e.kind === 'win' || e.kind === 'bankrupt');
    if (end) showEnding(end.kind as 'win' | 'bankrupt', end.text);
  }
});
renderShopTop();
shopScene.setShop(shopState.shop);

// --- City view --------------------------------------------------------------------------
const city = makeView('city', 'Place', [
  { id: 'overview', label: 'Overview', mount: (el) => mountCityOverview(el) },
  { id: 'rivals', label: 'Rivals', mount: (el) => mountCityRivals(el) },
]);
city.buttons.get('rivals')?.addEventListener('click', () => city.buttons.get('rivals')?.classList.remove('badge'));
mountCityMap(city.stage);
mountCityPanel(city.left);
city.mountTabs();
onPlaceTapped(() => { if (phone.matches) city.select('left'); });

// --- Export for Blender / Unreal ----------------------------------------------------------
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scene';
function exportButton(stage: HTMLElement, build: () => ExportInput): void {
  const btn = h('button.export-btn', { title: 'Download this 3D scene (.glb + render settings, zipped) for Blender or Unreal' }, '🎬 Export for Blender / UE');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Exporting…';
    try {
      const input = build();
      const zip = await exportScene(input);
      const r = await offerDownload(`${input.name}.zip`, zip);
      if (r === 'saved') toast(`Saved ${input.name}.zip: unzip it, or hand it straight to the Blender/Unreal scripts in render/.`, 'gold');
      else if (r === 'failed') toast('Could not save the export here.');
    } catch (e) {
      console.error(e);
      toast('Export failed. See the console for details.');
    } finally {
      btn.disabled = false;
      btn.textContent = '🎬 Export for Blender / UE';
    }
  });
  stage.append(btn);
}
exportButton(shop.stage, () => {
  const s = shopState.shop;
  const tier = tierOf(s);
  const locId = tier.id === 'garage' ? s.home : sellLocId(s);
  const theme = themeFor(locId);
  return {
    name: `shop-${locId}-${tier.id}`,
    scene: shopScene.scene, camera: shopScene.camera, target: shopScene.controls.target, renderer: shopScene.renderer,
    bloom: { strength: 0.5, threshold: 0.82 },
    backdrop: [tier.id === 'garage' ? '#3a3040' : theme.sky, '#09080f'],
    info: { view: 'shop', shopName: s.name, tier: tier.id, district: locId, districtName: cityLoc(data, locId)?.name, day: s.day, theme },
  };
});
exportButton(lab.stage, () => ({
  name: `lab-${slug(state.product.brand.name)}`,
  scene: labScene.scene, camera: labScene.camera, target: labScene.controls.target, renderer: labScene.renderer,
  bloom: { strength: 0.3, threshold: 0.92 },
  backdrop: ['#14121c', '#14121c'],
  info: { view: 'lab', product: state.product.brand.name, labelColour: state.product.brand.labelColour },
}));

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
  const active = v === 'lab' ? lab : v === 'shop' ? shop : city;
  active.select(active.current());
  for (const b of viewSeg.children) {
    const on = (b as HTMLElement).dataset.view === v;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  }
  if (v === 'city') viewSeg.querySelector('[data-view="city"]')?.classList.remove('badge');
  if (v === 'shop') {
    shopScene.setShop(shopState.shop);
    notifyShop('view');
  }
  try { localStorage.setItem('vapelab.v1.view', v); } catch { /* ignore */ }
}
for (const [id, label] of [['lab', 'Lab'], ['shop', 'Shop'], ['city', 'City']] as const) {
  viewSeg.append(h('button', { role: 'radio', 'data-view': id, onclick: () => setView(id) }, label));
}
// New players start at the car boot; returning players land where they left off.
let startView: ViewId = canMakeOwn(shopState.shop) ? 'lab' : 'shop';
try { startView = (localStorage.getItem('vapelab.v1.view') as ViewId) || startView; } catch { /* ignore */ }
setView(['lab', 'shop', 'city'].includes(startView) ? startView : 'shop');
renderLabLock();
phone.addEventListener('change', () => setView(app.dataset.view as ViewId));

window.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if ((e.key === 't' || e.key === 'T') && app.dataset.view === 'lab') void runTestBatch();
  if ((e.key === 'o' || e.key === 'O') && app.dataset.view === 'shop') void openShop();
});
