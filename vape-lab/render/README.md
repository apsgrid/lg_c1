# Exporting Vape Wars to three.js, Godot, Unreal and Blender

Every part of the game can be exported as a 3D scene:

| Scene | Where |
| --- | --- |
| Lab bench, shop (any level, any district) | **📦 Export 3D** on the Lab and Shop views |
| The city (districts, turf, rival stores, your places) | **🎬 3D city in Studio** on the City view, or Studio → Shot → Scene: *The city* |
| A run's street: the Paperboy-style firebomb run or the Night Round, before or after | Studio → Shot → Scene: *A run's street* |
| Any shot you describe (shop interiors and shopfronts with props and people) | Studio chat |

Pick the engines when you export. You get one zip:

```
scene.glb          the scene: meshes, PBR materials, textures, lights, RenderCam, marker_* nodes
scene.json         camera, lights (incl. ambient), look, glowing nodes, gameplay markers
threejs/viewer.html   double-click: the scene with the game's look (loads three.js from a CDN)
godot/             a Godot 4 project: open project.godot (Godot 4.3+), press Play
scripts/           vape_import.py (Unreal), generate.py (text-to-3D), vape_render.py (Blender)
```

**Godot.** `main.tscn` instances `scene.glb`, and `vape_scene.gd` reads `scene.json` to set up the
camera you framed, a WorldEnvironment (backdrop, ambient, ACES, glow, SSAO, fog), the lights
and the neon. Tune *Light Scale*, *Glow Boost* and *Use SDFGI* on the Main node. Glowing meshes
and lights are matched by name. Not yet run in Godot (the container can't run it), so the first
open may need a tweak, which Claude on your PC can do.

**Towards a playable port.** Every scene carries `marker_*` nodes, also listed in
`scene.json` → `markers`: street targets (rival fronts, order houses), street start and end,
city locations, and spots in shots. The game rules live in `src/sim/` as pure data in and data
out, with the same JSON saves, so a Godot or Unreal front end can read a save and these scenes
and drive them. That's the next step when you want it.


## The Studio (describe it, test it, approve it)

Open **🎬 Studio** in the game's top bar.

1. **Chat** (left): describe the visual. Claude writes a *shot spec* (setting, district, time,
   weather, palette, lights, camera, people, props) and the 3D preview test-runs it straight
   away. Keep tweaking in plain words; every answer is a version you can go back to. Outside
   Claude (a plain browser) an offline sketcher picks out districts, weather, colours, time,
   camera words and props instead.
2. **Shot**: the same spec as controls (sliders, colours, camera). Drag the preview to frame it
   by hand and press **Use the current view**.
3. **Assets**: pick each prop's final model: **Built-in** (the stylised preview model),
   **Fab library** (a real Fab/Megascans asset, found by its search words) or **Text-to-3D**
   (a bespoke model generated from its prompt).
4. **Approve**: resolution, quality and still or push-in, then **Approve for Unreal**. You get
   `studio-<title>.zip` with the scene, the spec, `assets.json`, a Fab shopping list, the
   text-to-3D prompts, `UNREAL_PROMPT.md` and the scripts. Give `UNREAL_PROMPT.md` to Claude on
   your Unreal PC. It runs `scripts/generate.py` (Meshy or Tripo with your API key, or manual),
   checks your project for the Fab assets, then runs `scripts/vape_import.py`. That builds the
   level, swaps every placeholder `prop_<id>` for its library or generated model (scaled to fit,
   standing on the same spot), lights it and renders through Movie Render Queue.

`render/examples/blender-studio-shopfront.png` is a Studio shot rendered by the Blender script
with no hand tweaks.

## Exporting from the Lab and Shop

The browser game is the sandbox: try layouts, districts, upgrades and products there.
When a scene looks right, press **🎬 Export for Blender / UE** (top right of the Lab or
Shop 3D view). You get a zip:

| File | What's in it |
| --- | --- |
| `scene.glb` | Meshes, PBR materials, canvas textures (signs, labels, posters, window views), point and sun lights, `RenderCam` (the camera as you framed it) and `RenderTarget` (where it looks). Each mesh has a glTF extra `role`: `emissive` (neon, LEDs, bulbs), `unlit` (printed signs, window views) or `surface`. |
| `scene.render.json` | Camera (position, target, vertical FOV), every light (including the ambient hemisphere light glTF can't carry), backdrop colours, exposure and glow settings, and the shop details (level, district, theme colours). |
| `README.txt` | A reminder of the above. |

Browser-only things are left out: text pop-ups, particles and the fake blob shadows
under people. Customers are exported in whatever pose they're in. They aren't animated.

## Blender (4.0 or later, including 5.x)

`render/blender/vape_render.py` imports the zip, lights it in physical units, makes the
neon glow, sets up the camera, AgX colour and a bloom glare, saves a `.blend` next to the
zip and renders a PNG.

```bash
blender --background --python render/blender/vape_render.py -- ~/Downloads/shop-beach-medium.zip
# options: --engine EEVEE  --samples 256  --res 3840x2160  --gpu  --glow 4  --light-scale 1.5  --no-render
```

Or from inside Blender (Scripting tab, or any tool that runs Python in Blender):

```python
exec(open(r"C:/path/to/vape-lab/render/blender/vape_render.py").read())
main(r"C:/Users/you/Downloads/shop-beach-medium.zip", engine="EEVEE", render=False)
```

In a running Blender it builds a new scene, so your open file is kept.

Tested here on Blender 5.2 (Cycles and Eevee) with a Shop and a Lab export. The Blender 4.x
branches (old compositor, Eevee Next, glare node properties) are written but haven't been
run, because the test container couldn't launch a 4.x binary.

## Unreal Engine 5

Enable the **Python Editor Script Plugin**. UE 5.1 and later import glTF with Interchange by
default. Then, in the Output Log with the command box set to `Python`:

```
py "C:/path/to/vape-lab/render/unreal/vape_import.py" "C:/Users/you/Downloads/shop-beach-medium.zip" --render
```

It makes the level `/Game/VapeWars/Maps/<name>`, imports the scene into it and sets the
lights from the manifest in candela and lux. It then boosts the glowing materials and adds a
sky light with faint backdrop fog. Last, it places a cine camera (`VapeRenderCam`) and a
post-process volume with manual exposure, bloom and Lumen. With `--render` it also takes a
high-res screenshot into `Saved/Screenshots`. For final frames, use Movie Render Queue
with `VapeRenderCam`.

**This script has not been run against Unreal yet** (the repo's tests can't run the
editor). It logs every step and prints a summary, and anything it can't do it reports with
the manual fallback. Expect the first run on your engine version to need a tweak or two.
That's the job for Claude with your Unreal MCP (below).

## Driving it with Claude and MCP on your PC

With Claude running on the PC that has Blender and Unreal, plus a Blender MCP add-on and an
Unreal MCP plugin that can run Python, prompts like these work:

- "Export is at `~/Downloads/shop-beach-medium.zip`. Using Blender MCP, run
  `render/blender/vape_render.py`'s `main()` on it with Eevee and `render=False`. Then make the
  neon a bit stronger and try a lower camera angle."
- "Using the Unreal MCP, run `render/unreal/vape_import.py` on that zip, read the `[vape]`
  summary in the log, and fix anything that failed for this engine version."
- "Render the Blender scene in Cycles at 4K with the GPU and save it next to the zip."

Tuning knobs: `glow` (emissive boost), `light_scale` (all lights), Blender `--samples`,
and Unreal `exposure` (EV bias, 0 is roughly the browser's brightness).

Example Cycles renders straight from exports (32 samples, 960×540, no hand tweaks):
`render/examples/blender-shop-beach.png`, `render/examples/blender-lab.png`.
