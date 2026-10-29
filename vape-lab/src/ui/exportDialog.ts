// "Export for…": pick the engines, then package the scene for them.
import { ENGINE_LABEL, type EngineTarget } from '../export/engines';
import { saveStudio, studio } from '../studio/state';
import { ALL_TARGETS } from '../view/exportScene';
import { h } from './dom';

export function openExportDialog(title: string, run: (targets: EngineTarget[]) => Promise<void>): void {
  const picks = new Set<EngineTarget>(studio.targets.length ? studio.targets : ALL_TARGETS);
  const go = h('button.primary.big', {}, '📦 Export');
  const close = () => dialog.remove();
  const dialog = h('div.export-dialog', { role: 'dialog', 'aria-label': `Export ${title}`, onclick: (e: Event) => { if (e.target === dialog) close(); } },
    h('div.card', {},
      h('b', {}, `Export: ${title}`),
      h('p.fine', {}, 'One zip with scene.glb and scene.json, plus a folder or script for each engine you pick.'),
      h('div.targets', {}, ...ALL_TARGETS.map((t) => h('label.target', {},
        h('input', { type: 'checkbox', checked: picks.has(t), onchange: (e: Event) => { if ((e.target as HTMLInputElement).checked) picks.add(t); else picks.delete(t); go.disabled = !picks.size; } }),
        h('span', {}, h('b', {}, ENGINE_LABEL[t]))))),
      h('div.row', {}, go, h('button.ghost', { onclick: close }, 'Cancel')),
    ),
  );
  go.addEventListener('click', async () => {
    const targets = ALL_TARGETS.filter((t) => picks.has(t));
    studio.targets = targets;
    saveStudio('approved');
    go.disabled = true;
    go.textContent = 'Packaging…';
    try { await run(targets); } finally { close(); }
  });
  document.body.append(dialog);
}
