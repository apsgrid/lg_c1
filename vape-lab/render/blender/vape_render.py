"""Render a Vape Wars scene export in Blender (tested on 5.2; written to also run on 4.x).

Takes the zip from the game's "Export for Blender / UE" button (or an unzipped
folder with scene.glb + scene.render.json), builds a render scene and renders it.

Command line:
    blender --background --python vape_render.py -- path/to/shop-beach-medium.zip
        [--out render.png] [--engine CYCLES|EEVEE] [--samples 128] [--res 1920x1080]
        [--light-scale 1.0] [--glow 3.0] [--gpu] [--no-render] [--save-blend scene.blend]

From Blender's Text Editor or an MCP "run Python" tool:
    exec(open("path/to/vape_render.py").read())
    main("path/to/shop-beach-medium.zip", out="render.png", engine="EEVEE")

How three.js values map to Blender (both scenes are "physical"):
    point light  candela I      ->  watts      4*pi*I
    sun          lux-ish I      ->  strength   I
    hemisphere   irradiance I   ->  world strength  I / pi (plus a little for the
                                    browser's soft reflection environment)
    emission     colour * intensity is the same radiance in both; "glow" boosts the
                 meshes the game marked as emissive (neon, LEDs, bulbs).
"""
import argparse
import json
import math
import os
import sys
import tempfile
import zipfile

import bpy

# Set this to render from the Text Editor without arguments.
DEFAULT_SCENE = ""

WORLD_EXTRA = 0.35   # stands in for the browser's soft studio reflections


# --- Loading -----------------------------------------------------------------------------

def load_export(path):
    """Return (glb_path, manifest) from a zip, a folder, or a .glb next to its .render.json."""
    path = os.path.abspath(os.path.expanduser(path))
    if zipfile.is_zipfile(path):
        folder = tempfile.mkdtemp(prefix="vapewars_")
        with zipfile.ZipFile(path) as zf:
            zf.extractall(folder)
        path = folder
    if os.path.isdir(path):
        glb = os.path.join(path, "scene.glb")
        man = os.path.join(path, "scene.render.json")
    else:
        glb = path
        man = os.path.splitext(path)[0] + ".render.json"
    if not os.path.exists(glb):
        raise FileNotFoundError(f"No scene.glb found at {path}")
    manifest = {}
    if os.path.exists(man):
        with open(man, encoding="utf-8") as f:
            manifest = json.load(f)
    return glb, manifest


def hex_rgb(h):
    """'#rrggbb' (sRGB) -> linear RGB tuple."""
    h = h.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


# --- Scene setup ---------------------------------------------------------------------------

def enum_has(prop_owner, prop, value):
    try:
        return value in prop_owner.bl_rna.properties[prop].enum_items.keys()
    except Exception:
        return False


def pick_engine(scene, engine):
    if engine.upper().startswith("EEVEE"):
        for name in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
            if enum_has(scene.render, "engine", name):
                return name
    return "CYCLES"


def setup_world(scene, manifest):
    hemi = next((l for l in manifest.get("lights", []) if l.get("type") == "HemisphereLight"), None)
    sky = hex_rgb(hemi["colour"]) if hemi else (0.6, 0.6, 0.8)
    ground = hex_rgb(hemi.get("groundColour", "#2a1f2e")) if hemi else (0.05, 0.04, 0.05)
    strength = (hemi["intensity"] / math.pi if hemi else 0.3) + WORLD_EXTRA
    ambient = tuple(0.6 * s + 0.4 * g for s, g in zip(sky, ground))
    backdrop = hex_rgb(manifest.get("backdrop", ["#14121c"])[0])

    world = bpy.data.worlds.new("VapeWarsWorld")
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    light_bg = nt.nodes.new("ShaderNodeBackground")
    light_bg.inputs["Color"].default_value = (*ambient, 1)
    light_bg.inputs["Strength"].default_value = strength
    cam_bg = nt.nodes.new("ShaderNodeBackground")
    cam_bg.inputs["Color"].default_value = (*backdrop, 1)
    cam_bg.inputs["Strength"].default_value = 0.18
    path = nt.nodes.new("ShaderNodeLightPath")
    mix = nt.nodes.new("ShaderNodeMixShader")
    # The camera sees the dark district-tinted backdrop; everything else is lit by the ambient sky.
    nt.links.new(path.outputs["Is Camera Ray"], mix.inputs[0])
    nt.links.new(light_bg.outputs[0], mix.inputs[1])
    nt.links.new(cam_bg.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])


def setup_lights(scene, manifest, light_scale):
    by_name = {l.get("name"): l for l in manifest.get("lights", [])}
    for obj in scene.objects:
        if obj.type != "LIGHT":
            continue
        src = by_name.get(obj.name) or by_name.get(obj.name.split(".")[0])
        if not src:
            continue
        light = obj.data
        light.color = hex_rgb(src["colour"])
        if light.type == "POINT":
            light.energy = 4 * math.pi * src["intensity"] * light_scale
            light.shadow_soft_size = 0.15
        elif light.type == "SUN":
            light.energy = src["intensity"] * light_scale
            light.angle = math.radians(3)
        elif light.type == "SPOT":
            light.energy = 4 * math.pi * src["intensity"] * light_scale


def boost_glow(scene, glow):
    """Make the meshes the game marked as emissive glow harder (neon, LEDs, bulbs)."""
    done = set()
    for obj in scene.objects:
        if obj.type != "MESH" or obj.get("role") != "emissive":
            continue
        for slot in obj.material_slots:
            mat = slot.material
            if not mat or mat.name in done or not mat.use_nodes:
                continue
            done.add(mat.name)
            for node in mat.node_tree.nodes:
                if node.type == "BSDF_PRINCIPLED" and "Emission Strength" in node.inputs:
                    node.inputs["Emission Strength"].default_value *= glow


def setup_camera(scene, manifest):
    cams = [o for o in scene.objects if o.type == "CAMERA"]
    cam = next((o for o in cams if o.name.startswith("RenderCam")), cams[0] if cams else None)
    if cam is None:
        raise RuntimeError("The export has no camera")
    scene.camera = cam
    fov = manifest.get("camera", {}).get("fovY")
    if fov:
        cam.data.sensor_fit = "VERTICAL"
        cam.data.angle_y = math.radians(fov)
    cam.data.clip_start = 0.05
    cam.data.clip_end = 200
    return cam


def setup_render(scene, engine, samples, res, gpu):
    scene.render.engine = pick_engine(scene, engine)
    w, h = (int(v) for v in res.lower().split("x"))
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.resolution_percentage = 100
    vs = scene.view_settings
    for transform in ("AgX", "Filmic"):
        if enum_has(vs, "view_transform", transform):
            vs.view_transform = transform
            break
    for look in ("AgX - Punchy", "AgX - Medium High Contrast", "Medium High Contrast"):
        if enum_has(vs, "look", look):
            vs.look = look
            break
    if scene.render.engine == "CYCLES":
        scene.cycles.samples = samples
        scene.cycles.use_denoising = True
        if gpu:
            try:
                prefs = bpy.context.preferences.addons["cycles"].preferences
                for kind in ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI"):
                    try:
                        prefs.compute_device_type = kind
                        prefs.get_devices()
                        if any(d.type == kind for d in prefs.devices):
                            for d in prefs.devices:
                                d.use = True
                            scene.cycles.device = "GPU"
                            print(f"[vape] Rendering on GPU ({kind})")
                            break
                    except Exception:
                        continue
            except Exception as e:
                print(f"[vape] GPU setup skipped: {e}")
    else:
        try:
            scene.eevee.taa_render_samples = samples
        except Exception:
            pass
        for attr, val in (("use_gtao", True), ("use_raytracing", True), ("use_bloom", True)):
            if hasattr(scene.eevee, attr):
                setattr(scene.eevee, attr, val)


def setup_glare(scene, strength, threshold):
    """A bloom-style glare in the compositor, like the game's glow (Blender 4.x and 5.x)."""
    try:
        if hasattr(scene, "compositing_node_group"):          # Blender 5.0+
            tree = bpy.data.node_groups.new("VapeWarsComp", "CompositorNodeTree")
            scene.compositing_node_group = tree
            rl = tree.nodes.new("CompositorNodeRLayers")
            out = tree.nodes.new("NodeGroupOutput")
            tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        else:                                                  # Blender 4.x
            scene.use_nodes = True
            tree = scene.node_tree
            tree.nodes.clear()
            rl = tree.nodes.new("CompositorNodeRLayers")
            out = tree.nodes.new("CompositorNodeComposite")
        glare = tree.nodes.new("CompositorNodeGlare")
        if "Type" in glare.inputs:                             # Blender 5.x: settings are inputs
            for kind in ("Bloom", "Fog Glow"):
                try:
                    glare.inputs["Type"].default_value = kind
                    break
                except Exception:
                    continue
            for name, value in (("Threshold", threshold), ("Strength", strength), ("Size", 0.6), ("Quality", "High")):
                try:
                    glare.inputs[name].default_value = value
                except Exception:
                    pass
        else:                                                  # Blender 4.x: node properties
            for kind in ("BLOOM", "FOG_GLOW"):
                try:
                    glare.glare_type = kind
                    break
                except Exception:
                    continue
            for name, value in (("threshold", threshold), ("size", 7), ("mix", -0.6 + 0.6 * min(strength, 1.6)), ("quality", "HIGH")):
                try:
                    setattr(glare, name, value)
                except Exception:
                    pass
        tree.links.new(rl.outputs["Image"], glare.inputs[0])
        tree.links.new(glare.outputs[0], out.inputs[0])
    except Exception as e:
        print(f"[vape] Glare skipped ({e}); the render is fine without it.")


# --- Entry points ------------------------------------------------------------------------------

def main(scene_path, out=None, engine="CYCLES", samples=128, res="1920x1080", light_scale=1.0, glow=3.0,
         gpu=False, render=True, save_blend=None):
    glb, manifest = load_export(scene_path)
    if bpy.app.background:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        scene = bpy.context.scene
    else:
        # In a running Blender, build a fresh scene instead of wiping your file.
        scene = bpy.data.scenes.new(f"VapeWars {manifest.get('view', 'scene')}")
        bpy.context.window.scene = scene
    bpy.ops.import_scene.gltf(filepath=glb)
    setup_world(scene, manifest)
    setup_lights(scene, manifest, light_scale)
    boost_glow(scene, glow)
    setup_camera(scene, manifest)
    setup_render(scene, engine, samples, res, gpu)
    look = manifest.get("look", {})
    setup_glare(scene, max(0.3, look.get("bloomStrength", 0.5) * 1.6), max(0.6, look.get("bloomThreshold", 0.8)))
    base = os.path.splitext(os.path.abspath(os.path.expanduser(scene_path)))[0]
    blend = save_blend or base + ".blend"
    try:
        bpy.ops.wm.save_as_mainfile(filepath=blend)
        print(f"[vape] Saved {blend}")
    except Exception as e:
        print(f"[vape] Could not save the .blend: {e}")
    if render:
        scene.render.filepath = out or base + ".png"
        scene.render.image_settings.file_format = "PNG"
        bpy.ops.render.render(write_still=True)
        print(f"[vape] Rendered {scene.render.filepath}")
    return scene


def cli():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser(description="Render a Vape Wars scene export")
    p.add_argument("scene", help="the exported .zip, an unzipped folder, or scene.glb")
    p.add_argument("--out")
    p.add_argument("--engine", default="CYCLES", choices=["CYCLES", "EEVEE"])
    p.add_argument("--samples", type=int, default=128)
    p.add_argument("--res", default="1920x1080")
    p.add_argument("--light-scale", type=float, default=1.0)
    p.add_argument("--glow", type=float, default=3.0)
    p.add_argument("--gpu", action="store_true")
    p.add_argument("--no-render", action="store_true")
    p.add_argument("--save-blend")
    a = p.parse_args(argv)
    main(a.scene, out=a.out, engine=a.engine, samples=a.samples, res=a.res, light_scale=a.light_scale,
         glow=a.glow, gpu=a.gpu, render=not a.no_render, save_blend=a.save_blend)


if __name__ == "__main__":
    if "--" in sys.argv:
        cli()
    elif DEFAULT_SCENE:
        main(DEFAULT_SCENE)
