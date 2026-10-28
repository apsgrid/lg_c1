# Vape Wars: Vape Lab (demo)

A standalone demo of the Make-a-Vape minigame. It uses a fictional game system only: abstract flavour attributes and invented game units. There are no real chemicals, concentrations or mixing ratios anywhere in the code, data or UI.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # sim determinism + architecture rules
npm run build      # typecheck + production build into dist/
npm run build:single  # one self-contained dist/vape-lab.html (used for the phone link)
```

## How to play

1. **Formula** (left panel): pick a base, then drag bottles from the 3D shelf into the 4 slots. You can also click a bottle, drop it on the device, or use the slot dropdown. Proportion sliders run 0-100 game points. The radar chart updates live, and after a test it shows the last tested profile as a dashed outline.
2. **Tune**: five animated dials (intensity, cooling, smoothness, vapour, dependence rating). Each one is a trade-off, and the panel lists the trade-offs that are active right now.
3. **Brand**: name, label colour, packaging style, logo, tier and price. The label texture on the 3D device updates live, and the unit cost and margin are shown next to it.
4. **Test** (or press `T`): plays a test-batch animation, then shows overall appeal, originality, balance, repeat purchase, reputation risk, unit cost, margin, projected profit and six customer cards. Each revision is kept in the history and can be restored.
5. **Journal**: hidden synergies are revealed when a test or a customer comment triggers their hint.
6. **Library**: save, load, duplicate and delete formulas (stored in localStorage).
7. **Modes**: *Manual*; *Assisted* (live warnings, clash highlights and synergy nudges); *Auto* (a strategy loop that maximises profit or originality, targets a segment, aims for premium, or improves the existing product).

## The shop

Switch from **Lab** to **Shop** in the top bar.

**Progression.** You start selling from the boot of your car, then move up: Garage → Small store → Medium store → Large store → Premium boutique. Each move costs cash and needs a minimum reputation. Bigger shops have more product slots, more customers and room for more regulars, but higher rent. Rival stores only notice you from the Small store on, and shoplifters start at the Garage. Premium boutique customers favour premium-tier products.

**Starting out.** New games start at the car boot, selling ready-made supplier stock (`data/wholesale.json`): it carries the supplier's 1.6× markup, so margins are thin. The Lab unlocks once you move into the Garage, and from then on you can sell your own formulas too.

**Shop upgrades.** Each shop level unlocks upgrades you buy with cash and keep when you move: a hand-painted sign and card reader (Garage), a comfy sofa, tasting bar and CCTV (Small store), a neon window and extra shelving (Medium), and a lounge corner (Large). Each one changes the sim (more customers, more advice requests, faster loyalty, shoplifter spotting, extra slots, a higher reputation floor) and appears in the 3D shop. They are defined in one catalog, `UPGRADES` in `src/sim/shop.ts`.

**Commissions.** Once the Lab is open, loyal regulars sometimes ask for something bespoke ("It's my partner's birthday on day 8. Something really icy, and it has to have mango in it."). Accept at the counter, then design it in the Lab's **Orders** tab, which checks each part of the brief live against the formula on your bench and shows a 0-100 match: 65% from the brief and 35% from how that customer type rates it. Hand it in before the deadline and they collect it at your next opening. 75+ is a triumph: a tip, a big loyalty boost, a friend who becomes a regular, and the formula saved to your Library as a signature product. Below 50 they're let down, and missing the deadline costs loyalty and reputation. The logic is in `src/sim/commission.ts`.

**One set of numbers.** The Lab's Test tab forecasts how a product would sell in your actual shop by running five days of the real shop sim (same level, reputation and upgrades). Each product on the shelf shows how every customer type rates it at its current price.

**Serving.** Press **Open up** and customers come in one at a time. Most browse and buy on their own; some stop at the counter:
- **Advice:** "Got anything really icy?" Pick a product. A good match earns reputation and loyalty and may win a regular; a poor one loses the sale.
- **ID checks:** a customer looks young. Ask for ID, or serve them. Selling to a minor costs a fine and a big reputation hit.
- **Returns:** a faulty unit comes back. Refund it, swap it for a new one, or refuse (keeps the cash, hurts reputation and loyalty).
- **Nosy questions:** "What exactly goes into this one?" Genuine fans love hearing about it, but it might be a rival's secret shopper taking notes.
- **Shoplifters:** something goes missing and you choose who to stop out of three customers. Stopping the right one recovers the stock; stopping the wrong one loses reputation. A security guard points out the thief.

**Skip** hands the rest of the day to your staff, who make the cautious choice each time.

**Disposables.** Set a product's format in the Lab's Brand tab. Disposables cost half as much to make, so margins are high, but far more of them are faulty (20% at budget tier, 12% at standard, 6% at premium) and come back as returns over the next couple of days.

**Other tabs:** Regulars (loyalty and favourites), Rivals (knock-offs and what security thinks rivals know), Ledger (cash and daily profit).

The day sim lives in `src/sim/shop.ts`. It is pure and seeded: `beginDay` lines up the visitors, `step` serves the next one or returns an encounter, `resolve` applies your choice, and `endDay` closes up. `simulateDay` plays a whole day with a choice policy and is used by the tests.

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
