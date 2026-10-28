import { computeProfile, MAX_SLOTS, STRONG_NOTE_AMOUNT } from '../sim';
import { data, state, subscribe, update } from '../state';
import type { LabScene } from '../view/scene';
import { clear, h } from './dom';
import { RadarChart } from './radar';
import { toast } from './toast';

/** Put a note into a slot (or the first free one). Existing copies move instead of duplicating. */
export function placeNote(noteId: string, slotIndex?: number): void {
  update((p) => {
    const existing = p.notes.findIndex((n) => n.noteId === noteId);
    const amount = existing >= 0 ? p.notes[existing].amount : 30;
    if (existing >= 0) p.notes.splice(existing, 1);
    const idx = slotIndex === undefined ? p.notes.length : Math.min(slotIndex, p.notes.length);
    if (slotIndex !== undefined && p.notes[idx]) p.notes[idx] = { noteId, amount };
    else if (p.notes.length < MAX_SLOTS) p.notes.splice(idx, 0, { noteId, amount });
  }, 'notes');
}

export function mountFormula(root: HTMLElement, scene: LabScene): void {
  const baseRow = h('div.chips', { role: 'radiogroup', 'aria-label': 'Base' });
  const slotsEl = h('div.slots');
  const totalEl = h('div.total');
  const radar = new RadarChart(250);
  const profileEl = h('div.profile-nums');
  const synEl = h('div.active-syn');

  const nameInput = h('input#product-name', {
    type: 'text', maxLength: 24, placeholder: 'Name your product', value: state.product.brand.name,
    oninput: (e: Event) => update((p) => { p.brand.name = (e.target as HTMLInputElement).value; }, 'brand'),
  });
  root.append(
    h('label.name-field', { for: 'product-name' }, h('h3', {}, 'Product name')),
    nameInput,
    h('h3', {}, 'Base'),
    baseRow,
    h('h3', {}, 'Notes ', h('span.muted', {}, '(tap or drag bottles from the shelf, max 4)')),
    slotsEl,
    totalEl,
    h('h3', {}, 'Flavour profile'),
    h('div.radar-wrap', {}, radar.canvas),
    profileEl,
    synEl,
  );

  // --- Drag from 3D shelf -> DOM slots or the device -------------------------------
  const ghost = h('div.drag-ghost');
  const tip = h('div.bottle-tip');
  document.body.append(ghost, tip);

  scene.onBottleHover = (noteId, x, y) => {
    const def = data.notes.find((n) => n.id === noteId);
    tip.style.display = def ? 'block' : 'none';
    if (def) {
      tip.textContent = `${def.name} · ${def.family}`;
      tip.style.left = `${x + 14}px`;
      tip.style.top = `${y + 14}px`;
    }
  };

  scene.onBottlePointerDown = ({ noteId, clientX, clientY }) => {
    const def = data.notes.find((n) => n.id === noteId);
    if (!def) return;
    let moved = false;
    ghost.textContent = def.name;
    ghost.style.setProperty('--c', def.colour);
    const startX = clientX, startY = clientY;
    const move = (e: PointerEvent) => {
      if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) > 6) {
        moved = true;
        ghost.style.display = 'block';
        document.body.classList.add('dragging');
      }
      ghost.style.left = `${e.clientX}px`;
      ghost.style.top = `${e.clientY}px`;
      for (const s of slotsEl.querySelectorAll('.slot')) s.classList.remove('drop-over');
      (document.elementFromPoint(e.clientX, e.clientY)?.closest('.slot'))?.classList.add('drop-over');
    };
    const up = (e: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      ghost.style.display = 'none';
      document.body.classList.remove('dragging');
      for (const s of slotsEl.querySelectorAll('.slot')) s.classList.remove('drop-over');
      if (!moved) {
        // Tap/click = add to the first free slot.
        const inMix = state.product.notes.some((n) => n.noteId === noteId);
        if (!inMix && state.product.notes.length >= MAX_SLOTS) toast('All 4 slots are full. Remove a note first.');
        else if (!inMix) {
          placeNote(noteId);
          toast(`Added ${def.name}`);
        }
        return;
      }
      ghost.style.display = 'none';
      const slot = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('.slot');
      if (slot) placeNote(noteId, Number(slot.dataset.index));
      else if (scene.isOverDevice(e.clientX, e.clientY)) placeNote(noteId);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // --- Rendering ------------------------------------------------------------------
  let lastNoteKey = '';
  const sliders = new Map<number, { input: HTMLInputElement; val: HTMLElement; slot: HTMLElement }>();

  const buildSlots = () => {
    clear(slotsEl);
    sliders.clear();
    const p = state.product;
    for (let i = 0; i < MAX_SLOTS; i++) {
      const n = p.notes[i];
      const def = n && data.notes.find((d) => d.id === n.noteId);
      if (!n || !def) {
        const picker = h('select', {
          'aria-label': `Add note to slot ${i + 1}`,
          onchange: (e: Event) => placeNote((e.target as HTMLSelectElement).value, i),
        }, h('option', { value: '' }, '+ or pick a note…'),
        ...data.notes.filter((d) => !p.notes.some((x) => x.noteId === d.id)).map((d) => h('option', { value: d.id }, d.name)));
        slotsEl.append(h('div.slot.empty', { 'data-index': i }, h('div.slot-drop', {}, 'Drop bottle here'), picker));
        continue;
      }
      const val = h('span.slot-val', {}, String(n.amount));
      const input = h('input', {
        type: 'range', min: 0, max: 100, step: 1, value: String(n.amount), 'aria-label': `${def.name} amount`,
        oninput: (e: Event) => update((d) => { d.notes[i].amount = Number((e.target as HTMLInputElement).value); }, 'amount'),
      });
      const slot = h('div.slot', { 'data-index': i, style: `--c:${def.colour}` },
        h('div.slot-head', {},
          h('span.swatch'),
          h('b', {}, def.name),
          h('span.muted.fam', {}, def.family),
          val,
          h('button.icon', { title: 'Remove', 'aria-label': `Remove ${def.name}`, onclick: () => update((d) => { d.notes.splice(i, 1); }, 'notes') }, '×'),
        ),
        input,
      );
      sliders.set(i, { input, val, slot });
      slotsEl.append(slot);
    }
  };

  const render = () => {
    const p = state.product;
    if (document.activeElement !== nameInput) nameInput.value = p.brand.name;
    // Base chips.
    clear(baseRow);
    for (const b of data.bases) {
      baseRow.append(h('button.chip', {
        class: b.id === p.base ? 'on' : '', role: 'radio', 'aria-checked': String(b.id === p.base),
        style: `--c:${b.liquidColour}`,
        onclick: () => update((d) => { d.base = b.id; }, 'base'),
      }, b.name));
    }

    const noteKey = p.notes.map((n) => n.noteId).join(',');
    if (noteKey !== lastNoteKey) {
      buildSlots();
      lastNoteKey = noteKey;
    }
    const pr = computeProfile(p, data);
    const clashIds = new Set(pr.clashes.flat());
    p.notes.forEach((n, i) => {
      const s = sliders.get(i);
      if (!s) return;
      if (document.activeElement !== s.input) s.input.value = String(n.amount);
      s.val.textContent = String(n.amount);
      s.slot.classList.toggle('strong', n.amount >= STRONG_NOTE_AMOUNT);
      s.slot.classList.toggle('clash', state.mode === 'assisted' && clashIds.has(n.noteId));
    });

    const total = p.notes.reduce((s, n) => s + n.amount, 0);
    totalEl.textContent = `${total} game points · ${pr.strongNotes} strong note${pr.strongNotes === 1 ? '' : 's'}`;
    totalEl.classList.toggle('warn', pr.strongNotes > 3);

    radar.set(pr.profile, state.lastResult?.profile ?? null);
    clear(profileEl);
    for (const [k, v] of Object.entries(pr.profile)) {
      profileEl.append(h('div', {}, h('span.muted', {}, k), h('b', {}, Math.round(v))));
    }

    clear(synEl);
    // Only discovered synergies are shown; undiscovered ones stay hidden until a test.
    for (const id of pr.activeSynergies.filter((s) => state.discovered.includes(s))) {
      synEl.append(h('span.syn-tag', {}, '✦ ', data.synergies.find((s) => s.id === id)?.name ?? id));
    }
  };

  subscribe(render);
  render();
}
