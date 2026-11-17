"""Render a quick turntable-style preview of each downloaded model.

blender -b -P scripts/bake/preview_models.py -- <models dir> <out dir>
"""

import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
SRC, OUT = argv[0], argv[1]

for name in sorted(os.listdir(SRC)):
    folder = os.path.join(SRC, name)
    gltf = next((f for f in os.listdir(folder) if f.endswith(".gltf")), None) if os.path.isdir(folder) else None
    if not gltf:
        continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    scene.view_settings.view_transform = "AgX"
    bpy.ops.import_scene.gltf(filepath=os.path.join(folder, gltf))
    meshes = [o for o in scene.objects if o.type == "MESH"]
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in meshes:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    center = (lo + hi) / 2
    size = max(hi - lo)
    # floor
    bpy.ops.mesh.primitive_plane_add(size=size * 6, location=(center.x, center.y, lo.z))
    # camera
    cam_data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    d = size * 2.2
    cam.location = center + Vector((d * 0.6, -d * 0.8, d * 0.45))
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    # lights: key + sky
    key = bpy.data.objects.new("key", bpy.data.lights.new("key", "AREA"))
    key.data.energy = 300 * size * size
    key.data.size = size
    key.location = center + Vector((-size * 1.5, -size * 1.2, size * 2))
    key.rotation_euler = (center - key.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(key)
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.6
    scene.world = world
    scene.render.filepath = os.path.join(OUT, f"{name}.png")
    bpy.ops.render.render(write_still=True)
    print("rendered", name, "size", round(size, 3))
