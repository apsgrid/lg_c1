extends Node3D
## Vape Wars: the run, playable in Godot 4.3+.
##
## The street (scene.glb) and its layout (run.json) come from the game's export. This
## script is the run's rules: drive down the street, throw sideways at the targets
## (a rival's shopfronts on a firebomb run, regulars' doorsteps on the Night Round),
## leave the neighbours' windows alone, and dodge the traffic and the dog.
## Units are metres: X along the street, Z across it (buildings at -Z), Y up.
##
## Keys: Left/Right (or A/D) steer, Up/Down (or W/S) speed, Space or F (or click) throws,
## R restarts once the run is over.

const GRAVITY := 45.0
const THROW_SIDE := -21.0
const THROW_UP := 12.75
const THROW_HEIGHT := 1.95
const SPEED_BASE := 13.0
const SPEED_FAST := 19.5
const SPEED_SLOW := 7.5
const STEER := 11.25
const CAR_HALF_LEN := 1.95
const CAR_HALF_WID := 1.05
const MAX_DENTS := 3

var run: Dictionary = {}
var mode := "firebomb"
var length := 200.0
var lane := 3.45
var facade_z := -8.25
var target_y := 4.65

var car: Node3D
var headlights: Node3D
var headlight_offset := Vector3.ZERO
var cam: Camera3D
var car_x := 2.0
var car_z := -0.75
var speed := 0.0
var dents := 0
var invuln := 0.0
var ammo := 8
var hits := 0
var wrong := 0
var phase := "intro"
var phase_t := 3.0

var targets: Array = []
var buildings: Array = []
var windows: Array = []
var obstacles: Array = []
var flying: Array = []

var hud: Label
var banner: Label
var pop_label: Label
var pop_t := 0.0


func _ready() -> void:
	var file := FileAccess.open("res://run.json", FileAccess.READ)
	if file == null:
		push_error("Vape Wars run: res://run.json is missing")
		return
	var parsed = JSON.parse_string(file.get_as_text())
	if typeof(parsed) != TYPE_DICTIONARY:
		push_error("Vape Wars run: res://run.json isn't valid JSON")
		return
	run = parsed
	mode = String(run.get("mode", "firebomb"))
	length = float(run.get("length", 200.0))
	lane = float(run.get("lane", 3.45))
	facade_z = float(run.get("facadeZ", -8.25))
	target_y = float(run.get("targetY", 4.65))
	ammo = int(run.get("ammo", 8))
	var start: Array = run.get("start", [2.0, -0.75])
	car_x = float(start[0])
	car_z = float(start[1])
	for t in run.get("targets", []):
		targets.append({"x0": float(t["x0"]), "x1": float(t["x1"]), "name": String(t.get("name", "")), "hit": false})
	for b in run.get("buildings", []):
		buildings.append({"x0": float(b["x0"]), "x1": float(b["x1"]), "h": float(b["h"])})
	for w in run.get("windows", []):
		windows.append({"x0": float(w["x0"]), "x1": float(w["x1"]), "y0": float(w["y0"]), "y1": float(w["y1"]), "broken": false})
	for o in run.get("obstacles", []):
		var node := find_child(String(o.get("node", "")), true, false) as Node3D
		obstacles.append({
			"kind": String(o["kind"]), "x": float(o["x"]), "z": float(o["z"]),
			"hl": float(o["hl"]), "hw": float(o["hw"]), "vx": float(o.get("vx", 0.0)), "vz": float(o.get("vz", 0.0)),
			"node": node, "done": false, "chase": 0.0, "chased": false,
		})
	car = find_child("your_car", true, false) as Node3D
	if car == null:
		car = _mesh(BoxMesh.new(), Color(0.23, 0.43, 0.94))
		(car as MeshInstance3D).mesh.set("size", Vector3(4.0, 1.2, 1.8))
		add_child(car)
	headlights = find_child("Headlights", true, false) as Node3D
	if headlights != null:
		headlight_offset = headlights.global_position - car.global_position
	cam = Camera3D.new()
	cam.fov = 55.0
	cam.far = 1500.0
	add_child(cam)
	cam.current = true
	_make_hud()
	_place_car()


# --- Each frame -----------------------------------------------------------------------------

func _process(delta: float) -> void:
	if run.is_empty():
		return
	if phase == "intro":
		phase_t -= delta
		banner.text = "%s\n\n%s\n\n%s" % [_title(), _help(), str(int(ceil(phase_t))) if phase_t > 0.5 else "GO!"]
		if phase_t <= 0.0:
			phase = "go"
			banner.visible = false
	elif phase == "over":
		if Input.is_key_pressed(KEY_R):
			get_tree().reload_current_scene()
	var driving := phase == "go"
	var target_speed := 0.0
	if driving:
		target_speed = SPEED_BASE
		if Input.is_key_pressed(KEY_UP) or Input.is_key_pressed(KEY_W):
			target_speed = SPEED_FAST
		elif Input.is_key_pressed(KEY_DOWN) or Input.is_key_pressed(KEY_S):
			target_speed = SPEED_SLOW
		var steer := 0.0
		if Input.is_key_pressed(KEY_LEFT) or Input.is_key_pressed(KEY_A):
			steer -= 1.0
		if Input.is_key_pressed(KEY_RIGHT) or Input.is_key_pressed(KEY_D):
			steer += 1.0
		car_z = clampf(car_z + steer * STEER * delta, -lane, lane)
	speed += (target_speed - speed) * minf(1.0, delta * (1.6 if driving else 3.0))
	car_x += speed * delta
	invuln = maxf(0.0, invuln - delta)
	_place_car()
	_update_obstacles(delta, driving)
	_update_flying(delta)
	_update_hud(delta)
	if driving and car_x >= length - 8.0:
		var all_done := hits >= targets.size()
		_finish("Every parcel home!" if mode == "delivery" and all_done else ("Clean sweep!" if all_done else "Made it out!"))


func _unhandled_input(event: InputEvent) -> void:
	var throw := false
	if event is InputEventKey:
		var k := event as InputEventKey
		throw = k.pressed and not k.echo and (k.keycode == KEY_SPACE or k.keycode == KEY_F)
	elif event is InputEventMouseButton:
		throw = (event as InputEventMouseButton).pressed
	elif event is InputEventScreenTouch:
		throw = (event as InputEventScreenTouch).pressed
	if throw:
		_throw()


func _place_car() -> void:
	var at := Vector3(car_x, 0.0, car_z)
	car.global_position = at
	car.visible = invuln <= 0.0 or int(invuln * 10.0) % 2 == 0
	if headlights != null:
		headlights.global_position = at + headlight_offset
	cam.global_position = at + Vector3(-11.0, 7.0, 8.0)
	cam.look_at(at + Vector3(10.0, 1.0, -3.0), Vector3.UP)


# --- Throwing ----------------------------------------------------------------------------------

func _throw() -> void:
	if phase != "go":
		return
	if ammo <= 0:
		_pop("Out of %s!" % ("parcels" if mode == "delivery" else "bottles"))
		return
	ammo -= 1
	var node: Node3D
	if mode == "delivery":
		node = _mesh(BoxMesh.new(), Color(0.75, 0.54, 0.29))
		(node as MeshInstance3D).mesh.set("size", Vector3(0.45, 0.3, 0.35))
	else:
		node = _mesh(CylinderMesh.new(), Color(0.35, 0.77, 0.42))
		var bottle := (node as MeshInstance3D).mesh
		bottle.set("top_radius", 0.08)
		bottle.set("bottom_radius", 0.1)
		bottle.set("height", 0.4)
		var flame := _mesh(SphereMesh.new(), Color(1.0, 0.6, 0.1), 4.0)
		flame.mesh.set("radius", 0.09)
		flame.mesh.set("height", 0.18)
		flame.position = Vector3(0.0, 0.28, 0.0)
		node.add_child(flame)
	add_child(node)
	var p := Vector3(car_x, THROW_HEIGHT, car_z - 0.9)
	node.global_position = p
	flying.append({"node": node, "pos": p, "vel": Vector3(speed, THROW_UP, THROW_SIDE)})


func _update_flying(delta: float) -> void:
	var keep: Array = []
	for f in flying:
		var p: Vector3 = f["pos"]
		var v: Vector3 = f["vel"]
		var before_z := p.z
		v.y -= GRAVITY * delta
		p += v * delta
		f["pos"] = p
		f["vel"] = v
		var node: Node3D = f["node"]
		node.global_position = p
		node.rotate_x(delta * 9.0)
		var gone := false
		if before_z > facade_z and p.z <= facade_z:
			gone = _land_on_front(p)
		if not gone and p.y <= 0.0:
			gone = true
			if p.z > facade_z:
				_pop("Short!")
		if gone:
			node.queue_free()
		else:
			keep.append(f)
	flying = keep


## Returns true when the throw stops at the building fronts.
func _land_on_front(p: Vector3) -> bool:
	for t in targets:
		if p.x >= t["x0"] and p.x <= t["x1"] and p.y < target_y:
			if t["hit"]:
				_pop("Already done")
			else:
				t["hit"] = true
				hits += 1
				_mark_target(t, p)
			return true
	for w in windows:
		if not w["broken"] and p.x >= w["x0"] and p.x <= w["x1"] and p.y >= w["y0"] and p.y <= w["y1"]:
			w["broken"] = true
			wrong += 1
			_pop("Wrong %s! +heat" % ("house" if mode == "delivery" else "shop"))
			return true
	for b in buildings:
		if p.x >= b["x0"] and p.x <= b["x1"] and p.y < b["h"]:
			return true
	return false


func _mark_target(t: Dictionary, p: Vector3) -> void:
	if mode == "delivery":
		_pop("Delivered! %s" % t["name"])
		var parcel := _mesh(BoxMesh.new(), Color(0.75, 0.54, 0.29))
		parcel.mesh.set("size", Vector3(0.45, 0.3, 0.35))
		add_child(parcel)
		parcel.global_position = Vector3(p.x, 0.15, facade_z + 0.6)
		_light(Vector3(p.x, 1.5, facade_z + 1.0), Color(0.24, 0.86, 0.52), 2.0)
	else:
		var words := ["WHOOMPH!", "KA-BOOM!", "FWOOSH!", "CLEAN SWEEP!"]
		_pop(words[mini(hits - 1, words.size() - 1)])
		var mid := (float(t["x0"]) + float(t["x1"])) / 2.0
		var width := float(t["x1"]) - float(t["x0"])
		for k in range(7):
			var cone := _mesh(CylinderMesh.new(), Color(1.0, 0.82 - 0.2 * float(k % 3), 0.2), 3.0)
			var h := 1.4 + randf() * 1.6
			cone.mesh.set("top_radius", 0.0)
			cone.mesh.set("bottom_radius", 0.35 + randf() * 0.2)
			cone.mesh.set("height", h)
			add_child(cone)
			cone.global_position = Vector3(mid - width * 0.3 + width * 0.6 * float(k) / 6.0, h / 2.0 + 0.6, facade_z + 0.3)
		_light(Vector3(mid, 1.8, facade_z + 1.4), Color(1.0, 0.48, 0.1), 6.0)


# --- Traffic, the dog, crates ---------------------------------------------------------------------

func _update_obstacles(delta: float, driving: bool) -> void:
	for o in obstacles:
		if o["done"]:
			continue
		var kind: String = o["kind"]
		var ahead: float = float(o["x"]) - car_x
		if kind == "oncoming" and ahead < 52.0:
			o["x"] = float(o["x"]) + float(o["vx"]) * delta
		elif kind == "cat" and ahead < 19.5:
			o["z"] = float(o["z"]) + float(o["vz"]) * delta
		elif kind == "dog":
			if not o["chased"] and driving and ahead < 11.0 and ahead > -1.5:
				o["chased"] = true
				o["chase"] = 3.2
				_pop("WOOF!")
			if float(o["chase"]) > 0.0:
				o["chase"] = float(o["chase"]) - delta
				o["x"] = float(o["x"]) + maxf(0.0, speed * 1.02 + (car_x + 0.75 - float(o["x"])) * 1.5) * delta
				o["z"] = move_toward(float(o["z"]), car_z + 1.8, 8.25 * delta)
				if float(o["chase"]) <= 0.0:
					o["z"] = 40.0
		var node: Node3D = o["node"]
		if node != null:
			node.global_position = Vector3(float(o["x"]), node.global_position.y, float(o["z"]))
		if ahead < -15.0 or not driving:
			continue
		if absf(float(o["x"]) - car_x) >= float(o["hl"]) + CAR_HALF_LEN or absf(float(o["z"]) - car_z) >= float(o["hw"]) + CAR_HALF_WID:
			continue
		if kind == "crate":
			o["done"] = true
			var more := 2 if mode == "delivery" else 3
			ammo += more
			_pop("+%d %s" % [more, "parcels" if mode == "delivery" else "bottles"])
			_hide(node)
		elif kind == "dog":
			o["done"] = true
			ammo = maxi(0, ammo - 1)
			_pop("The dog nicked a %s!" % ("parcel" if mode == "delivery" else "bottle"))
			_hide(node)
		elif kind == "cat":
			o["done"] = true
			_pop("MEOW!")
			_hide(node)
		elif invuln <= 0.0:
			_crash("HONK! CRUNCH!" if kind == "oncoming" else ("Oi! Watch it!" if kind == "police" else "CLONK!"))
			if kind == "cone" or kind == "bin":
				o["done"] = true
				if node != null:
					node.rotate_z(1.3)


func _crash(text: String) -> void:
	dents += 1
	invuln = 1.4
	speed *= 0.35
	_pop(text)
	if dents >= MAX_DENTS:
		_finish("The car's had enough")


func _finish(headline: String) -> void:
	if phase == "over":
		return
	phase = "over"
	var what := "doorsteps" if mode == "delivery" else "rival fronts"
	var wrong_what := "broken windows" if mode == "delivery" else "wrong buildings"
	banner.text = "%s\n\n%d / %d %s · %d %s · %d dents\n\nPress R to drive it again" % [headline, hits, targets.size(), what, wrong, wrong_what, dents]
	banner.visible = true
	print("Vape Wars run over: %s (%d/%d %s, %d %s, %d dents)" % [headline, hits, targets.size(), what, wrong, wrong_what, dents])


# --- HUD and helpers -------------------------------------------------------------------------------

func _title() -> String:
	return String(run.get("title", "The run")).to_upper()


func _help() -> String:
	if mode == "delivery":
		return "Lob a parcel onto each lit doorstep (name by the door).\nDon't break anyone else's windows. The dog nicks parcels."
	return "Lob bottles at the rival's shopfronts (their coloured signs).\nLeave the neighbours alone: wrong windows = heat."


func _make_hud() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	hud = _label(22)
	hud.position = Vector2(16, 12)
	layer.add_child(hud)
	pop_label = _label(30)
	pop_label.set_anchors_preset(Control.PRESET_CENTER_TOP)
	pop_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	pop_label.position = Vector2(-300, 70)
	pop_label.size = Vector2(600, 50)
	layer.add_child(pop_label)
	banner = _label(28)
	banner.set_anchors_preset(Control.PRESET_FULL_RECT)
	banner.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	banner.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	layer.add_child(banner)


func _label(size: int) -> Label:
	var l := Label.new()
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", Color(1, 1, 1))
	l.add_theme_color_override("font_outline_color", Color(0.06, 0.05, 0.1))
	l.add_theme_constant_override("outline_size", 8)
	return l


func _update_hud(delta: float) -> void:
	var ammo_word := "parcels" if mode == "delivery" else "bottles"
	var goal := "delivered" if mode == "delivery" else "fronts lit"
	hud.text = "%s: %d    %s: %d / %d    dents: %d / %d    %d%%" % [ammo_word, ammo, goal, hits, targets.size(), dents, MAX_DENTS, int(clampf(car_x / length, 0.0, 1.0) * 100.0)]
	pop_t -= delta
	pop_label.visible = pop_t > 0.0


func _pop(text: String) -> void:
	pop_label.text = text
	pop_t = 1.3


func _mesh(mesh: Mesh, colour: Color, glow := 0.0) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	var m := StandardMaterial3D.new()
	m.albedo_color = colour
	if glow > 0.0:
		m.emission_enabled = true
		m.emission = colour
		m.emission_energy_multiplier = glow
	mi.material_override = m
	return mi


func _light(at: Vector3, colour: Color, energy: float) -> void:
	var l := OmniLight3D.new()
	l.light_color = colour
	l.light_energy = energy
	l.omni_range = 9.0
	add_child(l)
	l.global_position = at


func _hide(node: Node3D) -> void:
	if node != null:
		node.visible = false
