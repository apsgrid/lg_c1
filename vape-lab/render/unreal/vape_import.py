"""Bring a Vape Wars scene export into Unreal Engine 5 (editor Python) and set up a render.

Needs the "Python Editor Script Plugin" (and, for glTF, the Interchange glTF importer,
which UE 5.1+ uses by default). Untested in this repo's CI: it can't run Unreal. Every
step logs what it did, and anything that fails falls back or says what to do by hand.

From the editor's Output Log (Cmd: "Python"), or Tools > Execute Python Script:
    py "C:/path/to/vape_import.py" "C:/Users/you/Downloads/shop-beach-medium.zip"
From an MCP tool that runs Python in the editor:
    exec(open(r"C:/path/to/vape_import.py").read())
    main(r"C:/Users/you/Downloads/shop-beach-medium.zip", render=True)

What it does:
  1. New level /Game/VapeWars/Maps/<name>, glTF imported into it (meshes, materials,
     textures, lights, RenderCam/RenderTarget markers) under /Game/VapeWars/<name>.
  2. Lights set from the export's manifest in physical units (candela, lux), and the
     glowing materials (neon, LEDs) boosted.
  3. A cine camera at RenderCam looking at RenderTarget, a post-process volume with
     manual exposure (EV100 0, so values read like the browser's), bloom, Lumen.
  4. Studio shots (zips from the game's Studio, with assets.json): swaps each placeholder
     prop for a real one. "library" props use the best-matching StaticMesh already in
     your project (add it from Fab first, see LIBRARY_SHOPPING_LIST.md); "text3d" props
     use generated/<id>.glb made by render/text3d/generate.py. Missing ones stay as the
     stylised placeholder and are listed in the summary.
  5. Optionally renders: Movie Render Queue (a still, or a slow push-in clip) from the
     shot's render settings, falling back to a high-res screenshot.
"""
import json
import math
import os
import sys
import tempfile
import zipfile

import unreal

LOG = []


def log(msg):
    LOG.append(msg)
    unreal.log(f"[vape] {msg}")


def warn(msg):
    LOG.append("WARNING: " + msg)
    unreal.log_warning(f"[vape] {msg}")


# --- Loading -----------------------------------------------------------------------------

def load_export(path):
    """Return (folder, glb, manifest). A zip is unpacked into a folder beside it (kept, so
    generated/ models and edits live next to the shot)."""
    path = os.path.abspath(os.path.expanduser(path))
    if zipfile.is_zipfile(path):
        folder = os.path.splitext(path)[0]
        try:
            os.makedirs(folder, exist_ok=True)
        except OSError:
            folder = tempfile.mkdtemp(prefix="vapewars_")
        with zipfile.ZipFile(path) as zf:
            for member in zf.namelist():
                if not os.path.exists(os.path.join(folder, member)):
                    zf.extract(member, folder)
        path = folder
    folder = path if os.path.isdir(path) else os.path.dirname(path)
    glb = os.path.join(folder, "scene.glb") if os.path.isdir(path) else path
    man = os.path.join(folder, "scene.render.json")
    manifest = {}
    if os.path.exists(man):
        with open(man, encoding="utf-8") as f:
            manifest = json.load(f)
    if not os.path.exists(glb):
        raise FileNotFoundError(f"No scene.glb at {path}")
    return folder, glb, manifest


def colour(h):
    h = h.lstrip("#")
    return unreal.LinearColor(*(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)), 1.0)


def safe_name(s):
    return "".join(c if c.isalnum() else "_" for c in s).strip("_") or "Scene"


def actors():
    return unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()


def find_actor(label):
    for a in actors():
        if a.get_actor_label() == label or a.get_actor_label().startswith(label + "_") or a.get_name().startswith(label):
            return a
    return None


# --- Steps ----------------------------------------------------------------------------------

def new_level(name):
    path = f"/Game/VapeWars/Maps/{name}"
    try:
        les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
        if unreal.EditorAssetLibrary.does_asset_exist(path):
            les.load_level(path)
            for a in actors():
                if a.get_actor_label().startswith("Vape"):
                    a.destroy_actor()
            log(f"Reusing level {path}")
        else:
            les.new_level(path)
            log(f"New level {path}")
    except Exception as e:
        warn(f"Couldn't make a level ({e}); importing into the current one.")
    return path


def import_gltf(glb, dest):
    """Import the glTF as a scene (actors placed in the level). Falls back to assets only."""
    before = {a.get_name() for a in actors()}
    try:
        mgr = unreal.InterchangeManager.get_interchange_manager_scripted()
        src = unreal.InterchangeManager.create_source_data(glb)
        params = unreal.ImportAssetParameters()
        params.is_automated = True
        mgr.import_scene(dest, src, params)
        spawned = [a for a in actors() if a.get_name() not in before]
        if spawned:
            log(f"Imported the scene: {len(spawned)} actors under {dest}")
            return spawned
        warn("Interchange imported nothing into the level.")
    except Exception as e:
        warn(f"Interchange scene import failed ({e}).")
    try:
        task = unreal.AssetImportTask()
        task.filename = glb
        task.destination_path = dest
        task.automated = True
        task.replace_existing = True
        task.save = True
        unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
        warn(f"Imported the meshes and materials as assets in {dest}, but they aren't placed in the level. "
             "Use File > Import Into Level with scene.glb to place them, then run this again with import_mode='skip'.")
    except Exception as e:
        warn(f"Asset import failed too ({e}).")
    return []


def setup_lights(manifest, light_scale):
    by_name = {l.get("name"): l for l in manifest.get("lights", [])}
    n = 0
    for a in actors():
        src = by_name.get(a.get_actor_label()) or by_name.get(a.get_actor_label().split("_")[0])
        if not src:
            continue
        try:
            if isinstance(a, unreal.PointLight):
                c = a.point_light_component
                c.set_editor_property("intensity_units", unreal.LightUnits.CANDELAS)
                c.set_editor_property("intensity", src["intensity"] * light_scale)
                c.set_editor_property("source_radius", 8.0)
            elif isinstance(a, unreal.DirectionalLight):
                c = a.light_component
                c.set_editor_property("intensity", src["intensity"] * light_scale)
            else:
                continue
            c.set_light_color(colour(src["colour"]))
            n += 1
        except Exception as e:
            warn(f"Light {a.get_actor_label()}: {e}")
    log(f"Set {n} lights from the manifest (physical units)")


def boost_emissive(dest, glow):
    """Turn up emissive strength on the imported glTF material instances (neon, LEDs, bulbs)."""
    n = 0
    for path in unreal.EditorAssetLibrary.list_assets(dest, recursive=True):
        asset = unreal.EditorAssetLibrary.load_asset(path)
        if not isinstance(asset, unreal.MaterialInstanceConstant):
            continue
        try:
            names = unreal.MaterialEditingLibrary.get_scalar_parameter_names(asset)
        except Exception:
            continue
        for p in names:
            if "emissive" in str(p).lower() and "strength" in str(p).lower():
                v = unreal.MaterialEditingLibrary.get_material_instance_scalar_parameter_value(asset, p)
                if v > 0:
                    unreal.MaterialEditingLibrary.set_material_instance_scalar_parameter_value(asset, p, v * glow)
                    n += 1
    log(f"Boosted emission on {n} materials (x{glow})")


def ambient(manifest):
    hemi = next((l for l in manifest.get("lights", []) if l.get("type") == "HemisphereLight"), None)
    sub = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    try:
        sky = sub.spawn_actor_from_class(unreal.SkyLight, unreal.Vector(0, 0, 400))
        sky.set_actor_label("VapeSkyLight")
        c = sky.light_component
        c.set_editor_property("real_time_capture", True)
        c.set_editor_property("lower_hemisphere_is_black", False)
        if hemi:
            c.set_editor_property("lower_hemisphere_color", colour(hemi.get("groundColour", "#2a1f2e")))
            c.set_light_color(colour(hemi["colour"]))
            c.set_editor_property("intensity", hemi["intensity"] / math.pi + 0.35)
        fog = sub.spawn_actor_from_class(unreal.ExponentialHeightFog, unreal.Vector(0, 0, 0))
        fog.set_actor_label("VapeBackdropFog")
        fc = fog.component
        fc.set_editor_property("fog_density", 0.002)
        fc.set_editor_property("fog_inscattering_luminance", colour(manifest.get("backdrop", ["#14121c"])[0]))
        log("Added a sky light and a faint backdrop-coloured fog for ambient light")
    except Exception as e:
        warn(f"Ambient light: {e}")


def camera(manifest):
    sub = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    src, aim = find_actor("RenderCam"), find_actor("RenderTarget")
    if src and aim:
        loc, target = src.get_actor_location(), aim.get_actor_location()
    else:
        # Fallback: convert glTF (metres, Y up, right-handed) to UE (cm, Z up, left-handed).
        warn("RenderCam/RenderTarget not found in the level; placing the camera from the manifest (check the framing).")
        c = manifest.get("camera", {})
        conv = lambda p: unreal.Vector(p[2] * 100, p[0] * 100, p[1] * 100)
        loc, target = conv(c.get("position", [0, 2, 6])), conv(c.get("target", [0, 1, 0]))
    rot = unreal.MathLibrary.find_look_at_rotation(loc, target)
    cam = sub.spawn_actor_from_class(unreal.CineCameraActor, loc, rot)
    cam.set_actor_label("VapeRenderCam")
    comp = cam.get_cine_camera_component()
    fb = comp.get_editor_property("filmback")
    fb.set_editor_property("sensor_width", 36.0)
    fb.set_editor_property("sensor_height", 20.25)
    comp.set_editor_property("filmback", fb)
    fov = manifest.get("camera", {}).get("fovY", 45)
    comp.set_editor_property("current_focal_length", (20.25 / 2) / math.tan(math.radians(fov) / 2))
    fs = comp.get_editor_property("focus_settings")
    fs.set_editor_property("focus_method", unreal.CameraFocusMethod.MANUAL)
    fs.set_editor_property("manual_focus_distance", (target - loc).length())
    comp.set_editor_property("focus_settings", fs)
    comp.set_editor_property("current_aperture", 4.0)
    log("Cine camera placed at RenderCam, focused on RenderTarget")
    return cam


def post_process(manifest, exposure):
    sub = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    look = manifest.get("look", {})
    try:
        ppv = sub.spawn_actor_from_class(unreal.PostProcessVolume, unreal.Vector(0, 0, 0))
        ppv.set_actor_label("VapePostProcess")
        ppv.set_editor_property("unbound", True)
        s = ppv.get_editor_property("settings")
        for prop, value in (
            ("auto_exposure_method", unreal.AutoExposureMethod.AEM_MANUAL),
            ("auto_exposure_apply_physical_camera_exposure", False),
            ("auto_exposure_bias", exposure),
            ("bloom_intensity", 0.6 + look.get("bloomStrength", 0.5)),
            ("bloom_threshold", -1.0),
            ("dynamic_global_illumination_method", unreal.DynamicGlobalIlluminationMethod.LUMEN),
            ("reflection_method", unreal.ReflectionMethod.LUMEN),
            ("vignette_intensity", 0.35),
        ):
            try:
                s.set_editor_property("override_" + prop, True)
                s.set_editor_property(prop, value)
            except Exception as e:
                warn(f"Post-process {prop}: {e}")
        ppv.set_editor_property("settings", s)
        log("Post-process: manual exposure, bloom, Lumen GI and reflections")
    except Exception as e:
        warn(f"Post-process volume: {e}")


def screenshot(cam, name, res):
    w, h = (int(v) for v in res.lower().split("x"))
    try:
        unreal.AutomationLibrary.take_high_res_screenshot(w, h, f"{name}.png", camera=cam)
        log(f"Requested a {w}x{h} screenshot ({name}.png) in Saved/Screenshots. For a final-quality render use Movie Render Queue with VapeRenderCam.")
    except Exception as e:
        warn(f"Screenshot: {e}. Pilot VapeRenderCam in the viewport and use High Resolution Screenshot or Movie Render Queue.")


# --- Studio asset swaps ---------------------------------------------------------------------------

STOP = {"a", "an", "the", "of", "with", "and", "for", "set", "pack", "prop", "model"}


def words(text):
    return [w for w in "".join(c.lower() if c.isalnum() else " " for c in text).split() if w not in STOP]


def find_library_mesh(query, roots):
    """Best StaticMesh in the project whose name/path shares the most words with the query."""
    reg = unreal.AssetRegistryHelpers.get_asset_registry()
    want = set(words(query))
    best, best_score = None, 0
    for root in roots:
        try:
            assets = reg.get_assets_by_path(root, recursive=True)
        except Exception:
            continue
        for ad in assets:
            try:
                cls = str(ad.asset_class_path.asset_name)
            except Exception:
                cls = str(getattr(ad, "asset_class", ""))
            if cls != "StaticMesh":
                continue
            path = str(ad.package_name)
            if "/VapeWars/" in path:
                continue
            have = set(words(path))
            score = len(want & have) + (0.5 if ("Fab" in path or "Megascans" in path) else 0)
            if score > best_score:
                best, best_score = ad, score
    if best is None or best_score < 1:
        return None
    return unreal.EditorAssetLibrary.load_asset(str(best.package_name))


def import_generated(folder, prop_id, dest):
    gen = os.path.join(folder, "generated")
    for ext in (".glb", ".gltf", ".fbx", ".obj"):
        f = os.path.join(gen, prop_id + ext)
        if os.path.exists(f):
            task = unreal.AssetImportTask()
            task.filename = f
            task.destination_path = f"{dest}/Generated/{prop_id}"
            task.automated = True
            task.replace_existing = True
            task.save = True
            unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
            for path in unreal.EditorAssetLibrary.list_assets(task.destination_path, recursive=True):
                a = unreal.EditorAssetLibrary.load_asset(path)
                if isinstance(a, unreal.StaticMesh):
                    return a
    return None


def place_like(mesh, placeholder):
    """Spawn mesh where the placeholder stands, scaled to its size, standing on the same floor."""
    sub = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    origin, extent = placeholder.get_actor_bounds(False)
    actor = sub.spawn_actor_from_object(mesh, origin, placeholder.get_actor_rotation())
    m_origin, m_extent = actor.get_actor_bounds(False)
    big = max(m_extent.x, m_extent.y, m_extent.z, 0.01)
    scale = max(extent.x, extent.y, extent.z) / big
    actor.set_actor_scale3d(unreal.Vector(scale, scale, scale))
    m_origin, m_extent = actor.get_actor_bounds(False)
    loc = actor.get_actor_location()
    actor.set_actor_location(unreal.Vector(
        loc.x + (origin.x - m_origin.x), loc.y + (origin.y - m_origin.y),
        loc.z + ((origin.z - extent.z) - (m_origin.z - m_extent.z))), False, False)
    for a in [placeholder] + list(placeholder.get_attached_actors()):
        try:
            a.set_actor_hidden_in_game(True)
            a.set_is_temporarily_hidden_in_editor(True)
        except Exception:
            pass
    return actor


def swap_assets(folder, dest, library_roots):
    plan_path = os.path.join(folder, "assets.json")
    if not os.path.exists(plan_path):
        return
    with open(plan_path, encoding="utf-8") as f:
        plan = json.load(f)
    missing = []
    for item in plan.get("props", []):
        route = item.get("route")
        if route == "procedural":
            continue
        placeholder = find_actor(item.get("node", "prop_" + item["id"]))
        if placeholder is None:
            warn(f"{item['name']}: no placeholder actor {item.get('node')} in the level")
            continue
        mesh = find_library_mesh(item.get("query") or item["name"], library_roots) if route == "library" else import_generated(folder, item["id"], dest)
        if mesh is None:
            missing.append(item)
            continue
        try:
            actor = place_like(mesh, placeholder)
            actor.set_actor_label(f"Vape_{item['id']}")
            log(f"{item['name']}: swapped in {mesh.get_path_name()}")
        except Exception as e:
            warn(f"{item['name']}: couldn't place {mesh.get_path_name()} ({e})")
    for item in missing:
        if item.get("route") == "library":
            warn(f"{item['name']}: nothing in the project matches '{item.get('query')}'. Add one from Fab ({item.get('fabUrl')}) and run again with import_mode='skip'.")
        else:
            warn(f"{item['name']}: no generated/{item['id']}.glb yet. Run render/text3d/generate.py on this folder, then run again with import_mode='skip'.")


def render_mrq(level_path, cam, name, out_dir, res, quality, motion):
    """Movie Render Queue: a level sequence with the camera (still or slow push-in), rendered to PNG."""
    w, h = (int(v) for v in res.lower().split("x"))
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    seq_path = "/Game/VapeWars/Sequences"
    seq_name = f"SEQ_{name}"
    if unreal.EditorAssetLibrary.does_asset_exist(f"{seq_path}/{seq_name}"):
        unreal.EditorAssetLibrary.delete_asset(f"{seq_path}/{seq_name}")
    seq = tools.create_asset(seq_name, seq_path, unreal.LevelSequence, unreal.LevelSequenceFactoryNew())
    fps = 24
    frames = 1 if motion == "still" else fps * 5
    seq.set_display_rate(unreal.FrameRate(fps, 1))
    seq.set_playback_start(0)
    seq.set_playback_end(frames)
    binding = seq.add_possessable(cam)
    cut_track = seq.add_track(unreal.MovieSceneCameraCutTrack)
    cut = cut_track.add_section()
    cut.set_range(0, frames)
    try:
        cut.set_camera_binding_id(seq.get_binding_id(binding))
    except Exception:
        cut.set_camera_binding_id(unreal.MovieSceneSequenceExtensions.get_portable_binding_id(seq, seq, binding))
    if motion == "push-in":
        tr = binding.add_track(unreal.MovieScene3DTransformTrack)
        sec = tr.add_section()
        sec.set_range(0, frames)
        loc, rot = cam.get_actor_location(), cam.get_actor_rotation()
        fwd = rot.get_forward_vector()
        start, end = loc - fwd * 60, loc + fwd * 60
        ch = sec.get_all_channels()
        for i, (a, b) in enumerate(((start.x, end.x), (start.y, end.y), (start.z, end.z))):
            ch[i].add_key(unreal.FrameNumber(0), a)
            ch[i].add_key(unreal.FrameNumber(frames), b)
        for i, v in enumerate((rot.roll, rot.pitch, rot.yaw)):
            ch[3 + i].add_key(unreal.FrameNumber(0), v)
    unreal.EditorAssetLibrary.save_loaded_asset(seq)

    subsystem = unreal.get_editor_subsystem(unreal.MoviePipelineQueueSubsystem)
    queue = subsystem.get_queue()
    queue.delete_all_jobs()
    job = queue.allocate_new_job(unreal.MoviePipelineExecutorJob)
    job.job_name = name
    job.sequence = unreal.SoftObjectPath(seq.get_path_name())
    job.map = unreal.SoftObjectPath(level_path)
    cfg = job.get_configuration()
    out = cfg.find_or_add_setting_by_class(unreal.MoviePipelineOutputSetting)
    out.output_resolution = unreal.IntPoint(w, h)
    out.output_directory = unreal.DirectoryPath(out_dir)
    out.file_name_format = "{sequence_name}.{frame_number}"
    cfg.find_or_add_setting_by_class(unreal.MoviePipelineDeferredPassBase)
    cfg.find_or_add_setting_by_class(unreal.MoviePipelineImageSequenceOutput_PNG)
    aa = cfg.find_or_add_setting_by_class(unreal.MoviePipelineAntiAliasingSetting)
    spatial, temporal = {"draft": (1, 1), "high": (4, 8), "final": (8, 16)}.get(quality, (4, 8))
    aa.spatial_sample_count = spatial
    aa.temporal_sample_count = temporal
    aa.override_anti_aliasing = True
    aa.anti_aliasing_method = unreal.AntiAliasingMethod.AAM_NONE
    if quality != "draft":
        aa.engine_warm_up_count = 32
    subsystem.render_queue_with_executor(unreal.MoviePipelinePIEExecutor)
    log(f"Movie Render Queue started: {w}x{h}, {quality}, {motion}. Frames go to {out_dir}")


# --- Entry points ------------------------------------------------------------------------------

def main(scene_path, render=False, light_scale=1.0, glow=3.0, exposure=0.0, res=None, import_mode="scene",
         library_roots=("/Game",), quality=None, motion=None):
    """import_mode="skip" re-runs everything except the import (after adding Fab assets or generated models)."""
    LOG.clear()
    folder, glb, manifest = load_export(scene_path)
    name = safe_name(os.path.splitext(os.path.basename(scene_path.rstrip("/\\")))[0])
    dest = f"/Game/VapeWars/{name}"
    opts = manifest.get("render", {})
    res = res or opts.get("resolution", "1920x1080")
    quality = quality or opts.get("quality", "high")
    motion = motion or opts.get("motion", "still")
    level_path = new_level(name) if import_mode != "skip" else f"/Game/VapeWars/Maps/{name}"
    if import_mode != "skip":
        import_gltf(glb, dest)
    else:
        for a in actors():
            if a.get_actor_label().startswith(("VapeRenderCam", "VapeSkyLight", "VapeBackdropFog", "VapePostProcess", "Vape_")):
                a.destroy_actor()
    swap_assets(folder, dest, list(library_roots))
    setup_lights(manifest, light_scale)
    boost_emissive(dest, glow)
    ambient(manifest)
    cam = camera(manifest)
    post_process(manifest, exposure)
    try:
        unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).pilot_level_actor(cam)
    except Exception:
        pass
    try:
        unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).save_current_level()
    except Exception as e:
        warn(f"Save level: {e}")
    if render:
        try:
            out_dir = os.path.join(unreal.Paths.project_saved_dir(), "MovieRenders", name)
            render_mrq(level_path, cam, name, out_dir, res, quality, motion)
        except Exception as e:
            warn(f"Movie Render Queue ({e}); taking a high-res screenshot instead.")
            screenshot(cam, name, res)
    unreal.log("[vape] Summary:\n  " + "\n  ".join(LOG))
    return LOG


if __name__ == "__main__" and len(sys.argv) > 1:
    main(sys.argv[1], render="--render" in sys.argv, import_mode="skip" if "--skip-import" in sys.argv else "scene")
