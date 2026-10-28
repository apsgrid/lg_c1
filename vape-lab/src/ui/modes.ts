import type { Mode } from '../events';
import { advise, runAuto, STRATEGIES, type AutoStep, type Product, type Strategy } from '../sim';
import { data, replaceProduct, setBusy, setMode, state, subscribe } from '../state';
import { clear, h } from './dom';
import { runTestBatch } from './testing';
import { toast } from './toast';

const MODES: { id: Mode; label: string; title: string }[] = [
  { id: 'manual', label: 'Manual', title: 'Pure lab: no hints' },
  { id: 'assisted', label: 'Assisted', title: 'Live suggestions and compatibility warnings' },
  { id: 'auto', label: 'Auto', title: 'Let a strategy loop design for you' },
];

export function mountModeSwitch(root: HTMLElement, onAuto: () => void): void {
  const group = h('div.seg', { role: 'radiogroup', 'aria-label': 'Mode' });
  root.append(group);
  const render = () => {
    clear(group);
    for (const m of MODES) {
      group.append(h('button', {
        class: m.id === state.mode ? 'on' : '', role: 'radio', 'aria-checked': String(m.id === state.mode), title: m.title,
        onclick: () => { setMode(m.id); if (m.id === 'auto') onAuto(); },
      }, m.label));
    }
  };
  subscribe((r) => { if (r === 'mode') render(); });
  render();
}

/** Assisted mode panel: warnings + suggestions, computed live from the same sim. */
export function mountAssist(root: HTMLElement): void {
  const box = h('div.assist');
  root.append(box);
  let timer = 0;
  const render = () => {
    box.hidden = state.mode !== 'assisted';
    if (box.hidden) return;
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      const a = advise(state.product, data, state.discovered);
      clear(box);
      box.append(h('h3', {}, 'Lab assistant'));
      if (!a.warnings.length && !a.suggestions.length) box.append(h('p.muted', {}, 'Looking good. Run a test batch.'));
      for (const w of a.warnings) box.append(h('div.warn-line', {}, '⚠ ', w));
      for (const s of a.suggestions) box.append(h('div.tip-line', {}, '💡 ', s));
    }, 60);
  };
  subscribe(render);
  render();
}

export function mountAuto(root: HTMLElement): void {
  let strategy: Strategy = 'profit';
  let target = data.customers[0].id;
  let iterations = 150;
  let running = false;
  let cancel = false;
  let before: Product | null = null;

  const strategySel = h('select', {
    'aria-label': 'Strategy',
    onchange: (e: Event) => { strategy = (e.target as HTMLSelectElement).value as Strategy; renderControls(); },
  }, ...STRATEGIES.map((s) => h('option', { value: s.id }, s.label)));
  const targetSel = h('select', {
    'aria-label': 'Target segment',
    onchange: (e: Event) => { target = (e.target as HTMLSelectElement).value; },
  }, ...data.customers.map((c) => h('option', { value: c.id }, `${c.avatar} ${c.name}`)));
  const targetRow = h('label', {}, 'Target customer', targetSel);
  const itersVal = h('b', {}, String(iterations));
  const iters = h('input', {
    type: 'range', min: 20, max: 400, step: 10, value: String(iterations), 'aria-label': 'Iterations',
    oninput: (e: Event) => { iterations = Number((e.target as HTMLInputElement).value); itersVal.textContent = String(iterations); },
  });
  const blurb = h('p.hint');
  const runBtn = h('button.primary.big', { onclick: () => void (running ? (cancel = true) : go()) }, 'Run strategy');
  const revertBtn = h('button.ghost', { onclick: () => { if (before) replaceProduct(before, { lineage: state.lineage }); before = null; renderControls(); } }, 'Revert to before');
  const log = h('div.autolog');
  const progress = h('div.bar', {}, h('div.bar-fill', { style: 'width:0%;background:var(--accent)' }));

  root.append(
    h('p.fine', {}, 'Auto mode drives exactly the same sim as Manual: each candidate is scored with the same test batch.'),
    h('label', {}, 'Strategy', strategySel),
    blurb,
    targetRow,
    h('label', {}, h('span', {}, 'Iterations ', itersVal), iters),
    h('div.row', {}, runBtn, revertBtn),
    progress,
    log,
  );

  function renderControls(): void {
    blurb.textContent = STRATEGIES.find((s) => s.id === strategy)?.blurb ?? '';
    targetRow.hidden = strategy !== 'segment';
    runBtn.textContent = running ? 'Stop' : 'Run strategy';
    revertBtn.hidden = !before || running;
    strategySel.disabled = targetSel.disabled = iters.disabled = running;
  }

  async function go(): Promise<void> {
    if (state.busy) return;
    if (strategy === 'improve' && !state.product.notes.length) {
      toast('Improve needs an existing formula. Add some notes first.');
      return;
    }
    before = JSON.parse(JSON.stringify(state.product)) as Product;
    const seed = (state.product.seed ^ Date.now()) >>> 0;
    const { steps, best } = runAuto(state.product, data, state.discovered, { strategy, target, iterations, seed });
    running = true;
    cancel = false;
    setBusy(true);
    renderControls();
    clear(log);
    const fill = progress.firstElementChild as HTMLElement;
    let bestSoFar = -Infinity;
    // Replay the search so the player can watch it think.
    const stride = Math.max(1, Math.floor(steps.length / 60));
    for (let i = 0; i < steps.length && !cancel; i++) {
      const s = steps[i];
      if (s.score > bestSoFar) {
        bestSoFar = s.score;
        logStep(s, true);
        replaceProduct(s.product, { lineage: state.lineage });
      } else if (i % stride === 0) logStep(s, false);
      fill.style.width = `${((i + 1) / steps.length) * 100}%`;
      if (i % stride === 0) await new Promise((r) => setTimeout(r, 25));
    }
    replaceProduct(best.product, { lineage: state.lineage });
    running = false;
    setBusy(false);
    renderControls();
    await runTestBatch();
    toast(`Strategy finished: best score ${best.score.toFixed(1)}`);
  }

  function logStep(s: AutoStep, isBest: boolean): void {
    log.prepend(h('div.log-row', { class: isBest ? 'best' : s.accepted ? '' : 'rejected' },
      h('span.fine', {}, `#${s.iteration}`),
      h('span', {}, s.change),
      h('span', {}, `appeal ${s.result.appeal.toFixed(0)}`),
      h('b', {}, s.score.toFixed(1)),
    ));
    while (log.childElementCount > 80) log.lastElementChild?.remove();
  }

  renderControls();
}
