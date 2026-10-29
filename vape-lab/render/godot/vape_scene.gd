extends Node3D
## Vape Wars scene setup for Godot 4.3+.
##
## Reads scene.json (exported next to scene.glb by the game's Export) and sets up:
## the camera as framed in the game, a WorldEnvironment (backdrop colour, ambient light,
## ACES tone mapping, glow, SSAO, optional fog and SDFGI), light colours and strengths,
## and stronger glow on the meshes the game marked as emissive (neon, LEDs, bulbs).
##
## Markers: empty nodes named marker_* (shop counter, street targets, city locations...)
## are kept in the scene for gameplay scripts to find later.

## Scales every light (the game's lights are in physical units; Godot's are relative).
@export var light_scale: float = 1.0
## Multiplies emission on the glowing meshes.
@export var glow_boost: float = 2.0
## Global illumination: nicer bounce light, slower.
@export var use_sdfgi: bool = false
## Add the camera framed in the game (off when a gameplay script brings its own).
@export var make_camera: bool = true

var manifest: Dictionary = {}


func _ready() -> void:
	var file := FileAccess.open("res://scene.json", FileAccess.READ)
	if file == null:
		push_warning("Vape Wars: res://scene.json is missing")
		return
	var parsed = JSON.parse_string(file.get_as_text())
	if typeof(parsed) != TYPE_DICTIONARY:
		push_warning("Vape Wars: res://scene.json isn't valid JSON")
		return
	manifest = parsed
	_environment()
	if make_camera:
		_camera()
	_lights()
	_glow()
	print("Vape Wars: set up '%s' (%s)" % [manifest.get("title", "scene"), manifest.get("view", "")])


func _col(hex: String) -> Color:
	return Color.html(hex)


func _vec(a: Array) -> Vector3:
	return Vector3(float(a[0]), float(a[1]), float(a[2]))


func _light_of_type(t: String) -> Dictionary:
	for l in manifest.get("lights", []):
		if l.get("type", "") == t:
			return l
	return {}


func _environment() -> void:
	var env := Environment.new()
	var backdrop: Array = manifest.get("backdrop", ["#14121c", "#09080f"])
	env.background_mode = Environment.BG_COLOR
	env.background_color = _col(backdrop[0])
	var hemi := _light_of_type("HemisphereLight")
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	if hemi.is_empty():
		env.ambient_light_color = Color(0.5, 0.5, 0.6)
		env.ambient_light_energy = 0.4 * light_scale
	else:
		env.ambient_light_color = _col(hemi.get("colour", "#8080a0")).lerp(_col(hemi.get("groundColour", "#202020")), 0.3)
		env.ambient_light_energy = float(hemi.get("intensity", 0.6)) * 0.6 * light_scale
	var look: Dictionary = manifest.get("look", {})
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.tonemap_exposure = float(look.get("exposure", 1.0))
	env.glow_enabled = true
	env.glow_intensity = 0.8 + float(look.get("bloomStrength", 0.5))
	env.glow_bloom = 0.12
	env.glow_hdr_threshold = float(look.get("bloomThreshold", 0.85))
	env.glow_blend_mode = Environment.GLOW_BLEND_MODE_SCREEN
	env.ssao_enabled = true
	env.sdfgi_enabled = use_sdfgi
	var fog := float(manifest.get("fog", 0.0))
	if fog > 0.0:
		env.fog_enabled = true
		env.fog_density = 0.003 + fog * 0.04
		env.fog_light_color = _col(backdrop[0]).lerp(Color(0.55, 0.55, 0.65), 0.3)
	var world := WorldEnvironment.new()
	world.name = "VapeEnvironment"
	world.environment = env
	add_child(world)


func _camera() -> void:
	var c: Dictionary = manifest.get("camera", {})
	if c.is_empty():
		return
	var cam := Camera3D.new()
	cam.name = "VapeCamera"
	add_child(cam)
	cam.global_position = _vec(c["position"])
	cam.look_at(_vec(c["target"]), Vector3.UP)
	cam.fov = float(c.get("fovY", 50.0))
	cam.near = 0.05
	cam.far = 2000.0
	cam.current = true


func _lights() -> void:
	for l in manifest.get("lights", []):
		var found := find_child(String(l.get("name", "")), true, false)
		if found == null or not (found is Light3D):
			continue
		var light := found as Light3D
		var strength := float(l.get("intensity", 1.0))
		light.light_color = _col(l.get("colour", "#ffffff"))
		if light is DirectionalLight3D:
			light.light_energy = strength * 0.5 * light_scale
			light.shadow_enabled = true
		elif light is OmniLight3D:
			light.light_energy = strength * 0.08 * light_scale
			light.set("omni_range", maxf(float(l.get("distance", 10.0)), 4.0) * 1.3)
		elif light is SpotLight3D:
			light.light_energy = strength * 0.08 * light_scale
			light.shadow_enabled = true


func _glow() -> void:
	for node_name in manifest.get("emissiveNodes", []):
		var found := find_child(String(node_name), true, false)
		if not (found is MeshInstance3D):
			continue
		var mesh_instance := found as MeshInstance3D
		if mesh_instance.mesh == null:
			continue
		for surface in range(mesh_instance.mesh.get_surface_count()):
			var material := mesh_instance.get_active_material(surface)
			if material is StandardMaterial3D:
				var copy := (material as StandardMaterial3D).duplicate() as StandardMaterial3D
				copy.emission_enabled = true
				copy.emission_energy_multiplier *= glow_boost
				mesh_instance.set_surface_override_material(surface, copy)
