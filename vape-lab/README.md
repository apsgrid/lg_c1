# Vape Wars: Vape Lab (demo)

A standalone demo of the Make-a-Vape minigame. It uses a fictional game system only: abstract flavour attributes and invented game units. There are no real chemicals, concentrations or mixing ratios anywhere in the code, data or UI.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # sim determinism + architecture rules
npm run build      # typecheck + production build into dist/
```

## How to play

1. **Formula** (left panel): pick a base, then drag bottles from the 3D shelf into the 4 slots. You can also click a bottle, drop it on the device, or use the slot dropdown. Proportion sliders run 0-100 game points. The radar chart updates live, and after a test it shows the last tested profile as a dashed outline.
2. **Tune**: five animated dials (intensity, cooling, smoothness, vapour, dependence rating). Each one is a trade-off, and the panel lists the trade-offs that are active right now.
3. **Brand**: name, label colour, packaging style, logo, tier and price. The label texture on the 3D device updates live, and the unit cost and margin are shown next to it.
4. **Test** (or press `T`): plays a test-batch animation, then shows overall appeal, originality, balance, repeat purchase, reputation risk, unit cost, margin, projected profit and six customer cards. Each revision is kept in the history and can be restored.
5. **Journal**: hidden synergies are revealed when a test or a customer comment triggers their hint.
6. **Library**: save, load, duplicate and delete formulas (stored in localStorage).
7. **Modes**: *Manual*; *Assisted* (live warnings, clash highlights and synergy nudges); *Auto* (a strategy loop that maximises profit or originality, targets a segment, aims for premium, or improves the existing product).

## Layout

```
data/          notes, bases, synergies, customers (JSON)
src/sim/       pure TS: no DOM, no three.js, no Math.random
src/view/      three.js scene + label texture
src/ui/        DOM panels, radar chart, dials, branding, testing, modes
src/store/     localStorage persistence
src/events.ts  plain events (also dispatched as window 'vapelab' CustomEvents)
main.ts
```

The rules are enforced by `tests/architecture.test.ts`:
- `sim/` imports only from `sim/`.
- The sim never uses `Math.random`. It uses a seeded mulberry32, so the same seed and the same inputs always give the same output.
- Product IDs are an FNV-1a hash of the canonical JSON of formula + tuning + seed (branding is excluded).
- Auto mode scores every candidate with the same `runTest()` that Manual mode uses.
- Vape Lab only emits events and never writes to any outside runtime.

To extend the game, edit the JSON in `data/`. Customer scoring is data-driven: each customer has `terms` (`stat`, `weight`, and one of `pivot`, `above` or `below`) plus comment templates keyed to `label+` and `label-`.
