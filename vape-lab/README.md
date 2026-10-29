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

## Publish to your website (Cloudflare Pages)

```bash
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... npm run deploy   # builds dist/ and uploads it to the "vape-wars" Pages project
```

The token needs **Account → Cloudflare Pages → Edit**. Set `CF_PAGES_PROJECT` to use another project name. Then, in the Cloudflare dashboard, attach your domain under the Pages project's **Custom domains**. Or skip the token entirely: connect this GitHub repo to a Pages project (build command `npm run build`, output folder `dist`, root `vape-lab`) and every push deploys.

On your own site, everything works except the Studio's Claude chat, which only exists inside Claude. There the chat falls back to the offline sketcher, and exports download normally.

## How to play

1. **Formula** (left panel): pick a base, then drag bottles from the 3D shelf into the 4 slots. You can also click a bottle, drop it on the device, or use the slot dropdown. Proportion sliders run 0-100 game points. The radar chart updates live, and after a test it shows the last tested profile as a dashed outline.
2. **Tune**: five animated dials (intensity, cooling, smoothness, vapour, dependence rating). Each one is a trade-off, and the panel lists the trade-offs that are active right now.
3. **Brand**: name, label colour, packaging style, logo, tier and price. The label texture on the 3D device updates live, and the unit cost and margin are shown next to it.
4. **Test** (or press `T`): plays a test-batch animation, then shows overall appeal, originality, balance, repeat purchase, reputation risk, unit cost, margin, an **In your shop** forecast (five days of the real shop sim at your current location and level) and six customer cards. Each revision is kept in the history and can be restored.
5. **Journal**: hidden synergies are revealed when a test or a customer comment triggers their hint.
6. **Library**: save, load, duplicate and delete formulas (stored in localStorage).
7. **Modes**: *Manual*; *Assisted* (live warnings, clash highlights and synergy nudges); *Auto* (a strategy loop that maximises profit or originality, targets a segment, aims for premium, or improves the existing product).

## The shop

Switch from **Lab** to **Shop** in the top bar.

**Progression.** You start selling from the boot of your car, then move up: Garage → Small store → Medium store → Large store → Premium boutique. Each move costs cash and needs a minimum reputation. Bigger shops have more product slots, more customers and room for more regulars, but higher rent. Rival stores only notice you from the Small store on, and shoplifters start at the Garage. Premium boutique customers favour premium-tier products.

**Starting out.** New games start at the car boot, selling ready-made supplier stock (`data/wholesale.json`): it carries the supplier's 1.6× markup, so margins are thin. The Lab unlocks once you move into the Garage, and from then on you can sell your own formulas too.

**Shop upgrades.** Each shop level unlocks upgrades you buy with cash and keep when you move: a hand-painted sign and card reader (Garage), a comfy sofa, tasting bar and CCTV (Small store), a neon window and extra shelving (Medium), and a lounge corner (Large). Each one changes the sim (more customers, more advice requests, faster loyalty, shoplifter spotting, extra slots, a higher reputation floor) and appears in the 3D shop. They are defined in one catalog, `UPGRADES` in `src/sim/shop.ts`.

**Commissions.** Once the Lab is open, loyal regulars sometimes ask for something bespoke ("It's my partner's birthday on day 8. Something really icy, and it has to have mango in it."). Accept at the counter, then design it in the Lab's **Orders** tab, which checks each part of the brief live against the formula on your bench and shows a 0-100 match: 65% from the brief and 35% from how that customer type rates it. Hand it in before the deadline and they collect it at your next opening. 75+ is a triumph: a tip, a big loyalty boost, a friend who becomes a regular, and the formula saved to your Library as a signature product. Below 50 they're let down, and missing the deadline costs loyalty and reputation. The logic is in `src/sim/commission.ts`.

**One set of numbers.** The Lab's Test tab forecasts how a product would sell in your actual shop by running five days of the real shop sim (same location, level, reputation, upgrades, rivals and market share). Every place in the City shows the same kind of forecast for your whole range. Each product on the shelf shows how every customer type rates it at its current price.

**Serving.** Press **Open up** and customers come in one at a time. Most browse and buy on their own; some stop at the counter:
- **Advice:** "Got anything really icy?" Pick a product. A good match earns reputation and loyalty and may win a regular; a poor one loses the sale.
- **ID checks:** a customer looks young. Ask for ID, or serve them. Serving a minor adds heat, and some are Trading Standards test purchases (a 250 cr fine).
- **Returns:** a faulty unit comes back. Refund it, swap it for a new one, or refuse (keeps the cash, hurts reputation and loyalty).
- **Nosy questions:** "What exactly goes into this one?" Genuine fans love hearing about it, but it might be a rival's secret shopper taking notes.
- **Shoplifters:** something goes missing and you choose who to stop out of three customers. Stopping the right one recovers the stock; stopping the wrong one loses reputation. CCTV narrows it to two suspects, and a security guard points out the thief.

**Trade-offs at the counter.** Every choice takes time, shown on its button, and the queue meter fills while you're busy. Once it's long, people give up and leave. So the careful answer always costs something:
- Asking for ID takes time, and some adults take offence and walk out (an ID scanner fixes both). Serving a minor is still never worth it.
- Explaining a recipe wins fans but takes a while and teaches rivals. Fans ask too, so a nosy question isn't proof of a spy.
- Chasing a shoplifter leaves the counter empty. CCTV narrows it to two suspects, a guard to one.
- Recommendations sell better but are slower than letting people browse.

Watchful staff and the second till upgrade keep the queue moving.

**Skip** hands the rest of the day to your staff, who make the cautious choice each time.

**Disposables.** Set a product's format in the Lab's Brand tab. Disposables cost half as much to make, so margins are high, but far more of them are faulty (20% at budget tier, 12% at standard, 6% at premium) and come back as returns over the next couple of days.

**Other tabs:** Regulars (loyalty and favourites) and Ledger (cash and daily profit). Everything about rivals lives in the City's Rivals tab.

The day sim lives in `src/sim/shop.ts`. It is pure and seeded: `beginDay` lines up the visitors, `step` serves the next one or returns an encounter, `resolve` applies your choice, and `endDay` closes up. `simulateDay` plays a whole day with a choice policy and is used by the tests.

## The city

Switch to **City** in the top bar for a top-down map of 11 locations: a school, the CBD, a nightclub strip, a church, a university, the beach, an industrial estate, a market square, the suburbs (home), a shopping centre and a hospital (`data/city.json`). Each has a slightly different customer mix, footfall (±15%), share of young-looking customers, police presence and rent. The effects are deliberately small, so where you go matters without deciding everything.

- **Your places.** Home is your garage, and it holds your stock until you buy a **stash house** (400 cr) somewhere else. You choose where to **park your car**: at the car boot it's your shop, and after that it's the van that carries stock to wherever you sell. From the Small store on you choose, and can **move**, your **store**.
- **Restocking.** Stock travels from your garage or stash, via your car, to where you sell. Short trips arrive the next morning; long ones take 2 or 3 days.
- **Heat** (0-100) is police attention. It rises with selling from a car, serving kids, drive-bys, protests and refused refunds, and cools by 4 a day. The hotter you are and the more heavily policed the area, the likelier a **bust**: stock seized, a fine, and closed for the day (a car search loses everything in the car). Moving your store cuts heat by 60%.
- **Serving kids.** Skipping the ID check near the school lets kids buy, and word spreads so more of them turn up. Every sale adds heat and some are Trading Standards test purchases (250 cr fine). It's a gamble that loses over time: in testing, serving every kid at the school gates for 30 days ended about 2,500 cr in debt with five busts, against about 600 cr up for checking ID.
- **Every district looks different** inside your shop: its own walls, floor, neon colours and a window onto the street outside (towers in the CBD, the sea at the beach, club signs on the Neon Mile). At the car boot, the district is the backdrop.
- **Rival stores** sit on the map. Once you have a store they may send protesters (fewer customers that day) or firebomb it overnight (closed for repairs; a security guard makes it much rarer). Open rival stores nearby take a small slice of your trade.
- **Night Round.** After closing, loyal regulars (loyalty 35+) text in orders for their usual. From the Counter tab or the City overview you drive a Paperboy-style round through the district you sell from: their porch lights are on, with their name and house number by the door, and you lob a parcel onto each doorstep as you pass. Each delivery is paid and builds loyalty, a perfect round earns a tip and a little reputation, missed orders cost loyalty, and breaking other people's windows costs reputation and adds heat. It's one job a night: a round or a drive-by (`src/sim/night.ts`).
- **Every street looks like its district**: palms and the sea at the beach, planters among the towers, neon on the Neon Mile, market stalls, fences on the industrial estate. Busier-policed districts have more police cars and faster traffic. The landing marker only shows for your first two runs of each kind.
- **Drive-bys (Firebomb Run).** From the City you can do a Paperboy-style run down a rival's street at night: steer with ◀ ▶ (or the arrow keys, with ↑ ↓ for speed) and lob bottles sideways at their shopfronts, the ones with their coloured signs. Each one you light shuts them for a day (up to 3) and burns some of their notes on your recipes; light all four for a clean sweep that burns every note they have. Hitting the neighbours' windows adds heat. Dodge bins, cones, roadworks and oncoming cars: three dents and the run is over. Grab crates for more bottles, and watch out for the dog, which steals them. The run adds a lot of heat, the police may pull you over (fine, closed tomorrow), and the rival's grudge makes revenge more likely. One job a night (`src/ui/driveby.ts`).

## The turf war

Every district has a market share split between you, the three rival chains and independent corner shops, shown as a coloured ring on the map. Shares drift each day toward each side's strength: how present they are (a store there counts fully, a store nearby counts a bit) times how good they are. Your quality comes from reputation, how well your range suits the local customers, and price (`src/sim/turf.ts`).

- **Share matters.** Your share where you sell scales how many customers come in.
- **Rivals fight back.** Once you have a store, the chains open branches where they're winning (often right where you're doing well), close branches that struggle, start **price wars** where you're beating them (keep your average price under 12 cr to shrug them off), and build a grudge as you take their customers. Grudges make protests and firebombs more likely.
- **Your chain.** From the Large store you can open up to 4 branches (1,500 cr each). They fight for their own districts and sell from their own deliveries, so they don't empty your main store.
- **Winning draws the police.** Every district you lead adds a little heat each day, and big leads bring 🚨 **crackdowns**: extra patrols for 5 days and a raid risk even if you've kept your heat down.
- **Run the city.** Lead 6 of the 11 districts (the biggest share, and at least 30%) to win. Go more than 1,000 cr into debt and the business goes under. Either way you can play on or start a new run.

## Export to three.js, Godot, Unreal and Blender

Every 3D scene (Lab, shop, the 3D city, the firebomb and Night Round streets, Studio shots) exports as `scene.glb` + `scene.json`, with a three.js viewer, a ready-to-open Godot 4 project, and Unreal and Blender scripts. See `render/README.md`. The 3D city is `src/view/cityScene3d.ts`; the 3D street is `src/view/streetScene.ts`, built from the same layout as the runs (`src/street/layout.ts`); engine targets are `src/export/engines.ts` and `render/godot/vape_scene.gd`.

### Renders

**Studio.** The **🎬 Studio** view is for designing shots by talking: describe the visual, Claude turns it into a shot spec, the three.js preview test-runs it, and you choose where each prop's final model comes from (built-in, a Fab/Megascans asset, or a text-to-3D generation). **Approve for Unreal** packages everything, with instructions for Claude on your Unreal PC. Code: `src/studio/` (spec, prompt, package, state), `src/view/studioScene.ts`, `src/view/props.ts`, `src/ui/studio.ts`, `render/text3d/generate.py`.


Use the browser game to try ideas, then press **🎬 Export for Blender / UE** on the Lab or Shop 3D view. It saves a zip with the scene as `.glb` (meshes, materials, textures, lights, the camera) and a render manifest. `render/blender/vape_render.py` and `render/unreal/vape_import.py` turn that into a lit, glowing render scene. See `render/README.md`.

## Layout

```
data/          notes, bases, synergies, customers (JSON)
src/sim/       pure TS: no DOM, no three.js, no Math.random
src/view/      three.js scenes, label texture, scene export (.glb + manifest)
render/        Blender and Unreal scripts that build a render from an export
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
