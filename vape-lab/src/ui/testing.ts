import { runTest, type TestResult } from '../sim';
import { data, recordResult, replaceProduct, setBusy, state, subscribe, update } from '../state';
import { storage } from '../store/storage';
import type { LabScene } from '../view/scene';
import { bar, clear, h, scoreColour } from './dom';
import { toast } from './toast';

let sceneRef: LabScene | null = null;

/** Full test flow: animation, then the pure sim result, discovery reveal and history. */
export async function runTestBatch(): Promise<TestResult | null> {
  if (state.busy) return null;
  if (!state.product.notes.some((n) => n.amount > 0)) {
    toast('Add at least one note before testing.');
    return null;
  }
  setBusy(true);
  try {
    await sceneRef?.playTest(state.product.tuning.vapour);
    const result = runTest(state.product, data, state.discovered);
    const fresh = recordResult(result);
    if (fresh.length) {
      sceneRef?.playSynergyReveal();
      for (const id of fresh) {
        const syn = data.synergies.find((s) => s.id === id);
        if (syn) toast(`✦ Synergy discovered: ${syn.name}`, 'gold');
      }
    }
    return result;
  } finally {
    setBusy(false);
  }
}

function stat(label: string, value: string, sub?: string, colour?: string, prev?: number, cur?: number): HTMLElement {
  let delta: HTMLElement | null = null;
  if (prev !== undefined && cur !== undefined) {
    const d = cur - prev;
    if (Math.abs(d) >= 0.5) delta = h('span.delta', { class: d > 0 ? 'good' : 'bad' }, `${d > 0 ? '▲' : '▼'}${Math.abs(d).toFixed(1)}`);
  }
  return h('div.stat', {}, h('span.muted', {}, label), h('b', { style: colour ? `color:${colour}` : '' }, value, delta), sub ? h('span.fine', {}, sub) : null);
}

export function mountTesting(root: HTMLElement, scene: LabScene): void {
  sceneRef = scene;
  const runBtn = h('button.primary.big', { onclick: () => void runTestBatch() }, 'Run test batch');
  const reroll = h('button.ghost', {
    title: 'New batch seed: same formula, different panel day',
    onclick: () => update((p) => { p.seed = (Math.imul(p.seed ^ 0x5bd1e995, 2654435761) >>> 0) % 1e9; }, 'seed'),
  }, '🎲 New batch seed');
  const results = h('div.results');
  const history = h('div.history');

  root.append(
    h('div.row', {}, runBtn, reroll),
    h('p.fine', {}, 'Same formula + same batch seed always gives the same panel. Revise and retest to climb.'),
    results,
    h('h4', {}, 'Revision history'),
    history,
  );

  const render = (reason?: string) => {
    runBtn.disabled = state.busy;
    runBtn.textContent = state.busy ? 'Testing…' : state.lastResult ? 'Retest' : 'Run test batch';
    if (reason === 'busy') return;

    clear(results);
    const r = state.lastResult;
    const prev = state.previousResult ?? undefined;
    if (!r) {
      results.append(h('div.empty-state', {}, 'No test yet. Build a formula, then run a test batch to hear from the panel.'));
    } else {
      const stale = r.productId !== state.product.id;
      if (stale) results.append(h('div.notice', {}, 'Formula changed since this test. Retest to update.'));
      if (r.newlyDiscovered.length) {
        for (const id of r.newlyDiscovered) {
          const syn = data.synergies.find((s) => s.id === id);
          if (syn) results.append(h('div.discovery', {}, h('b', {}, `✦ New synergy: ${syn.name}`), h('div', {}, syn.hint)));
        }
      }
      results.append(h('div.stats', {},
        stat('Overall appeal', r.appeal.toFixed(0), undefined, scoreColour(r.appeal), prev?.appeal, r.appeal),
        stat('Originality', r.originality.toFixed(0), undefined, undefined, prev?.originality, r.originality),
        stat('Balance', r.balance.toFixed(0), undefined, undefined, prev?.balance, r.balance),
        stat('Repeat purchase', r.repeatPurchase.toFixed(0), undefined, undefined, prev?.repeatPurchase, r.repeatPurchase),
        stat('Reputation risk', r.reputationRisk.toFixed(0), 'from dependence/intensity', r.reputationRisk > 40 ? 'var(--bad)' : undefined),
        stat('Unit cost', `${r.unitCost.total.toFixed(2)}`, 'credits (fictional)'),
        stat('Margin', `${r.margin.toFixed(2)}`, 'credits / unit', r.margin > 0 ? 'var(--good)' : 'var(--bad)'),
        stat('Weekly profit', r.projectedProfit.toFixed(0), 'projected credits', undefined, prev?.projectedProfit, r.projectedProfit),
      ));
      const cards = h('div.cards');
      r.reactions.forEach((rx, i) => {
        const c = data.customers.find((x) => x.id === rx.customerId);
        if (!c) return;
        const top = rx.drivers.filter((d) => Math.abs(d.delta) >= 2).slice(0, 3);
        cards.append(h('div.card', { class: rx.hintSynergy ? 'has-hint' : '', style: `animation-delay:${i * 90}ms` },
          h('div.card-head', {}, h('span.avatar', {}, c.avatar), h('div', {}, h('b', {}, c.name), h('div.fine', {}, c.blurb)), h('span.score', { style: `color:${scoreColour(rx.score)}` }, Math.round(rx.score))),
          bar(rx.score),
          h('p.quote', {}, `“${rx.comment}”`),
          h('div.drivers', {}, ...top.map((d) => h('span.driver', { class: d.delta > 0 ? 'good' : 'bad' }, `${d.label.replace('_', ' ')} ${d.delta > 0 ? '+' : ''}${Math.round(d.delta)}`))),
        ));
      });
      results.append(cards);
    }

    clear(history);
    const entries = storage.loadHistory().filter((e) => e.lineage === state.lineage).reverse();
    if (!entries.length) history.append(h('p.muted', {}, 'Tests of this formula will be listed here.'));
    entries.forEach((e, idx) => {
      const older = entries[idx + 1];
      const d = older ? e.appeal - older.appeal : 0;
      history.append(h('div.hist-row', { class: e.product.id === state.product.id ? 'current' : '' },
        h('b', {}, `v${e.version}`),
        h('span', {}, `appeal ${e.appeal.toFixed(0)}`, older ? h('span.delta', { class: d >= 0 ? 'good' : 'bad' }, ` ${d >= 0 ? '▲' : '▼'}${Math.abs(d).toFixed(1)}`) : null),
        h('span.muted', {}, `profit ${e.projectedProfit.toFixed(0)}`),
        h('code.fine', {}, e.product.id),
        h('button.ghost.small', { onclick: () => replaceProduct(e.product, { lineage: state.lineage }) }, 'Restore'),
      ));
    });
  };
  subscribe(render);
  render();
}
