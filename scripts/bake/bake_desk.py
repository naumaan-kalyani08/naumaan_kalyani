"""
Bake the desk scene's lighting in Blender (Cycles) → lightmaps for the site.

Input : desk.glb  (props + closed laptop, exported from the site with
        ?exportDesk → window.__exportDesk(); three.js units, Y-up)
Output: desk-{dark,light}.png, wall-{dark,light}.png  (sRGB-encoded light,
        value = linear irradiance / RANGE; see LIGHTMAP_RANGE in deskSetup.js)

Run:  blender -b -P scripts/bake/bake_desk.py -- <desk.glb> <out dir> [samples]

The regions (world units, three.js axes) must match BAKE in deskSetup.js:
  desk : x ∈ [-7.5, 7.5], z ∈ [-4.2, 3]     (y = just above the felt mat)
  wall : x ∈ [-7.5, 7.5], y ∈ [0, 6]         (z = -4.2)
"""

import math
import sys

import bpy
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
GLB, OUT = argv[0], argv[1]
SAMPLES = int(argv[2]) if len(argv) > 2 else 256

RANGE = 2.0  # stored value = irradiance × exposure / RANGE
DESK = dict(x0=-7.5, x1=7.5, z0=-4.2, z1=3.0, y=0.013, w=1536, h=736)
WALL = dict(x0=-7.5, x1=7.5, y0=0.0, y1=6.0, z=-4.2, w=1280, h=512)


def B(x, y, z):
    """three.js (Y-up) → Blender (Z-up), as the glTF importer converts."""
    return Vector((x, -z, y))


def norm3(v):
    v = Vector(v)
    return v / v.length


# ------------------------------------------------------------------ scene

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = False
scene.cycles.sample_clamp_direct = 6.0
scene.cycles.sample_clamp_indirect = 1.5  # no fireflies
scene.cycles.max_bounces = 4
try:  # use a GPU when there is one
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for kind in ("OPTIX", "CUDA", "HIP", "ONEAPI", "METAL"):
        try:
            prefs.compute_device_type = kind
            prefs.get_devices()
            if any(d.type != "CPU" for d in prefs.devices):
                for d in prefs.devices:
                    d.use = True
                scene.cycles.device = "GPU"
                break
        except Exception:
            continue
except Exception:
    pass
print("bake device:", scene.cycles.device)

bpy.ops.import_scene.gltf(filepath=GLB)


def diffuse_material(name, color, roughness=0.6):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


# Props bounce a neutral mid tone (their own colours are live in the site).
prop_mat = diffuse_material("props", (0.55, 0.55, 0.55))
for obj in scene.objects:
    if obj.type == "MESH":
        obj.data.materials.clear()
        obj.data.materials.append(prop_mat)


def plane(name, corners, size):
    """A quad receiver: corners (BL, BR, TR, TL) in Blender coords; UVs 0..1."""
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(corners, [], [(0, 1, 2, 3)])
    mesh.update()
    uv = mesh.uv_layers.new(name="bake")
    for loop, (u, v) in zip(mesh.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        uv.data[loop.index].uv = (u, v)
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    mat = diffuse_material(name, (0.8, 0.8, 0.8), 0.7)
    obj.data.materials.append(mat)
    img = bpy.data.images.new(name, width=size[0], height=size[1], float_buffer=True)
    node = mat.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = img
    mat.node_tree.nodes.active = node
    return obj, img


# Desk receiver: v = 0 at the front edge (z1), v = 1 at the wall (z0).
d = DESK
desk, desk_img = plane(
    "desk",
    [B(d["x0"], d["y"], d["z1"]), B(d["x1"], d["y"], d["z1"]), B(d["x1"], d["y"], d["z0"]), B(d["x0"], d["y"], d["z0"])],
    (d["w"], d["h"]),
)
# The rest of the desk top (bounce + occlusion, not baked).
outer = bpy.data.meshes.new("desk_outer")
outer.from_pydata([B(-14, 0, 6), B(14, 0, 6), B(14, 0, -4.2), B(-14, 0, -4.2)], [], [(0, 1, 2, 3)])
outer_obj = bpy.data.objects.new("desk_outer", outer)
outer_obj.data.materials.append(diffuse_material("desk_outer", (0.45, 0.32, 0.22), 0.7))
scene.collection.objects.link(outer_obj)

w = WALL
wall, wall_img = plane(
    "wall",
    [B(w["x0"], w["y0"], w["z"]), B(w["x1"], w["y0"], w["z"]), B(w["x1"], w["y1"], w["z"]), B(w["x0"], w["y1"], w["z"])],
    (w["w"], w["h"]),
)
wall_outer = bpy.data.meshes.new("wall_outer")
wall_outer.from_pydata([B(-14, 0, -4.21), B(14, 0, -4.21), B(14, 12, -4.21), B(-14, 12, -4.21)], [], [(0, 1, 2, 3)])
wall_outer_obj = bpy.data.objects.new("wall_outer", wall_outer)
wall_outer_obj.data.materials.append(diffuse_material("wall_outer", (0.6, 0.6, 0.62), 0.8))
scene.collection.objects.link(wall_outer_obj)

# ------------------------------------------------------------------ lights

lights = []


def light(kind, name, at, energy, color, aim=None, size=None, size_y=None, radius=None, angle=None):
    data = bpy.data.lights.new(name, kind)
    data.energy = energy
    data.color = color
    if kind == "AREA":
        data.shape = "RECTANGLE"
        data.size = size
        data.size_y = size_y if size_y else size
    if radius is not None:
        data.shadow_soft_size = radius
    if angle is not None:
        data.angle = angle
    obj = bpy.data.objects.new(name, data)
    obj.location = at
    if aim is not None:
        obj.rotation_mode = "QUATERNION"
        obj.rotation_quaternion = Vector((0, 0, -1)).rotation_difference(norm3(aim))
    scene.collection.objects.link(obj)
    lights.append(obj)
    return obj


def world(color, strength):
    wd = bpy.data.worlds.new("world")
    wd.use_nodes = True
    bg = wd.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (*color, 1)
    bg.inputs["Strength"].default_value = strength
    scene.world = wd


def clear_lights():
    for obj in lights:
        bpy.data.objects.remove(obj, do_unlink=True)
    lights.clear()


# Lamp geometry (mirrors deskSetup.js).
# The scanned lamp's bulb, world space (mirrors `bulbAt` in deskSetup.js).
bulb = Vector((-2.37, 1.84, -1.63))  # the code-made lamp's bulb, inside its shade

# Monitor (mirrors deskSetup.js `mon`).
mon = dict(x=3.5, z=-2.75, ry=-0.36, w=4.3, h=2.45, y=0.62)
mon_normal = Vector((math.sin(mon["ry"]), 0, math.cos(mon["ry"])))
mon_center = Vector((mon["x"], mon["y"] + mon["h"] / 2, mon["z"])) + mon_normal * 0.06


def setup_night():
    world((0.02, 0.025, 0.06), 0.15)
    # warm bulb inside the shade (the shade itself cuts the cone)
    light("POINT", "lamp", B(*bulb), 35, (1.0, 0.72, 0.45), radius=0.07)
    # the monitor's screen
    light(
        "AREA", "monitor", B(*mon_center), 70, (0.5, 0.6, 1.0),
        aim=B(*mon_normal) - B(0, 0, 0), size=mon["w"] - 0.2, size_y=mon["h"] - 0.3,
    )
    # moonlight through the window (left on the wall)
    light("AREA", "moon", B(-5.55, 3.5, -4.1), 60, (0.55, 0.65, 1.0), aim=B(0.3, -0.35, 1) - B(0, 0, 0), size=3.6, size_y=4.3)
    # the neon "nk" sign
    light("AREA", "neon", B(-0.9, 1.48, -4.12), 25, (0.6, 0.58, 1.0), aim=B(0, 0, 1) - B(0, 0, 0), size=1.4, size_y=0.6)


def setup_day():
    world((0.85, 0.9, 1.0), 0.4)
    # sun, consistent with the site's key light (from front-left, above)
    sun_from = B(-3, 5, 4) - B(0, 0, 0)
    light("SUN", "sun", B(0, 0, 10), 5.5, (1.0, 0.95, 0.86), aim=-sun_from, angle=math.radians(6))
    # soft daylight bouncing in from the window
    light("AREA", "window", B(-5.55, 3.5, -4.1), 260, (0.95, 0.97, 1.0), aim=B(0.3, -0.35, 1) - B(0, 0, 0), size=3.6, size_y=4.3)


# ------------------------------------------------------------------ bake

def bake(obj, img):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, margin=4, use_clear=True)
    px = np.array(img.pixels[:], dtype=np.float32).reshape(img.size[1], img.size[0], 4)[..., :3]
    return px


def blur(px, r=2):
    out = px.copy()
    for axis in (0, 1):
        acc = np.zeros_like(out)
        for k in range(-r, r + 1):
            acc += np.roll(out, k, axis=axis)
        out = acc / (2 * r + 1)
    return out


def save(px, name, exposure):
    x = px * exposure
    # soft highlight roll-off above 1 (like a camera), never past RANGE
    over = np.maximum(x - 1, 0)
    x = np.minimum(x, 1) + over / (1 + over) * (RANGE - 1)
    val = np.clip(x / RANGE, 0, 1)
    enc = np.where(val <= 0.0031308, val * 12.92, 1.055 * np.power(val, 1 / 2.4) - 0.055)  # sRGB
    h, wdt = enc.shape[:2]
    rgba = np.concatenate([enc, np.ones((h, wdt, 1), np.float32)], axis=2)
    img = bpy.data.images.new(name, width=wdt, height=h, alpha=False)
    img.pixels[:] = rgba.ravel()
    img.filepath_raw = f"{OUT}/{name}.png"
    img.file_format = "PNG"
    img.save()
    print("saved", name, "exposure", exposure)


def region_median(px, x0, x1, z0, z1):
    """Median luminance of a desk sub-rect (three.js x/z)."""
    d = DESK
    h, wdt = px.shape[:2]
    c0 = int((x0 - d["x0"]) / (d["x1"] - d["x0"]) * wdt)
    c1 = int((x1 - d["x0"]) / (d["x1"] - d["x0"]) * wdt)
    r0 = int((d["z1"] - z1) / (d["z1"] - d["z0"]) * h)
    r1 = int((d["z1"] - z0) / (d["z1"] - d["z0"]) * h)
    lum = px[r0:r1, c0:c1] @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    return float(np.median(lum))


for theme, setup, target in (("dark", setup_night, 0.7), ("light", setup_day, 1.0)):
    clear_lights()
    setup()
    desk_px = blur(bake(desk, desk_img), 3)
    # Exposure: the work area in front of the laptop lands at `target`.
    exposure = target / max(1e-6, region_median(desk_px, -2.5, 2.5, 0.5, 2.5))
    save(desk_px, f"desk-{theme}", exposure)
    wall_px = blur(bake(wall, wall_img), 5)
    # The wall texture already carries its colour/wash: its lightmap is
    # relative shading (median → 1).
    lum = wall_px @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    save(wall_px, f"wall-{theme}", 1.0 / max(1e-6, float(np.median(lum))))

print("BAKE DONE")
