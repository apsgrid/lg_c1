import { emit } from '../events';
import { newProduct, productId } from '../sim';
import { data, newLineage, replaceProduct, state, subscribe } from '../state';
import { storage, type SavedFormula } from '../store/storage';
import { clear, h } from './dom';
import { toast } from './toast';

export function mountLibrary(root: HTMLElement): void {
  const list = h('div.library');
  root.append(
    h('div.row', {},
      h('button.primary', { onclick: save }, '💾 Save current'),
      h('button.ghost', { onclick: () => { replaceProduct({ ...newProduct(Math.floor(Math.random() * 1e9)) }, { newLineage: true }); toast('New blank formula'); } }, '＋ New formula'),
    ),
    list,
    h('details.danger', {},
      h('summary', {}, 'Reset'),
      h('p.fine', {}, 'Clears saved formulas, discovered synergies and test history from this browser.'),
      h('button.ghost', { onclick: () => { if (confirm('Reset all Vape Lab data?')) { storage.resetAll(); location.reload(); } } }, 'Reset all lab data'),
    ),
  );

  function save(): void {
    const all = storage.loadFormulas();
    const existing = all.find((f) => f.lineage === state.lineage);
    const entry: SavedFormula = {
      slotId: existing?.slotId ?? `F${Date.now().toString(36)}`,
      lineage: state.lineage,
      savedAt: Date.now(),
      product: state.product,
      lastAppeal: state.lastResult?.productId === state.product.id ? state.lastResult.appeal : existing?.lastAppeal,
    };
    storage.saveFormulas(existing ? all.map((f) => (f.slotId === entry.slotId ? entry : f)) : [entry, ...all]);
    emit({ type: 'formula:saved', product: state.product });
    toast(`Saved “${state.product.brand.name || 'Untitled'}”`);
    render();
  }

  function render(): void {
    clear(list);
    const all = storage.loadFormulas();
    if (!all.length) list.append(h('p.muted', {}, 'No saved formulas yet.'));
    for (const f of all) {
      const p = f.product;
      const chips = p.notes.map((n) => {
        const d = data.notes.find((x) => x.id === n.noteId);
        return h('span.dot', { style: `background:${d?.colour ?? '#888'}`, title: `${d?.name} ${n.amount}` });
      });
      list.append(h('div.lib-row', { class: f.lineage === state.lineage ? 'current' : '' },
        h('span.lib-swatch', { style: `background:${p.brand.labelColour}` }),
        h('div.lib-main', {},
          h('b', {}, p.brand.name || 'Untitled'),
          h('div.fine', {}, `${data.bases.find((b) => b.id === p.base)?.name ?? p.base} · ${p.brand.tier} · ${p.brand.price} cr${f.lastAppeal !== undefined ? ` · appeal ${Math.round(f.lastAppeal)}` : ''}`),
          h('div.dots', {}, ...chips),
        ),
        h('div.lib-actions', {},
          h('button.ghost.small', { onclick: () => { replaceProduct(p, { lineage: f.lineage }); toast(`Loaded “${p.brand.name}”`); } }, 'Load'),
          h('button.ghost.small', {
            onclick: () => {
              const copy = { ...JSON.parse(JSON.stringify(p)), brand: { ...p.brand, name: `${p.brand.name} II`.slice(0, 24) } };
              copy.id = productId(copy);
              const lineage = newLineage();
              storage.saveFormulas([{ slotId: `F${Date.now().toString(36)}`, lineage, savedAt: Date.now(), product: copy }, ...storage.loadFormulas()]);
              render();
            },
          }, 'Duplicate'),
          h('button.ghost.small.bad', {
            onclick: () => { storage.saveFormulas(storage.loadFormulas().filter((x) => x.slotId !== f.slotId)); render(); },
          }, 'Delete'),
        ),
      ));
    }
  }
  subscribe((reason) => { if (reason === 'replace') render(); });
  render();
}
