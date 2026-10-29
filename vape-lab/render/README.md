# Rendering Vape Wars scenes in Blender and Unreal

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
