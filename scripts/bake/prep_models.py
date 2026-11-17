"""Prepare the Poly Haven desk models (CC0) for the web.

blender -b -P scripts/bake/prep_models.py -- <models dir> <out dir>

  desk_lamp_arm_01 → desk-lamp.glb   (recoloured matte black, decimated)
  potted_plant_02  → desk-plant.glb  (decimated)

Each model is re-centred: bottom-centre at the origin, metres (the site
scales them). Prints the lamp's bulb position for the site's light setup.
"""

import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
SRC, OUT = argv[0], argv[1]

MODELS = {
    "desk_lamp_arm_01": dict(out="desk-lamp.glb", ratio=0.4, diffuse="desk_lamp_arm_01_black_1k.jpg", tex=512),
    "potted_plant_02": dict(out="desk-plant.glb", ratio=0.27, tex=1024),
}


def bounds(objs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    return lo, hi


for name, cfg in MODELS.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    folder = os.path.join(SRC, name)
    bpy.ops.import_scene.gltf(filepath=os.path.join(folder, f"{name}_1k.gltf"))
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    before = sum(len(o.data.polygons) for o in meshes)

    # Recolour: point the base-colour image at the darkened file.
    if cfg.get("diffuse"):
        for img in bpy.data.images:
            if img.name.endswith("_diff"):
                print("recolour:", img.name)
                img.filepath = os.path.join(folder, "textures", cfg["diffuse"])
                img.reload()

    # Cap texture size (packed so the scaled pixels are what gets exported).
    for img in list(bpy.data.images):
        if img.size[0] > cfg["tex"]:
            img.scale(cfg["tex"], cfg["tex"])
            img.pack()

    # Decimate (collapse) — keeps UVs.
    for o in meshes:
        mod = o.modifiers.new("dec", "DECIMATE")
        mod.ratio = cfg["ratio"]
        mod.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier="dec")
    after = sum(len(o.data.polygons) for o in meshes)

    # Bottom-centre to the origin.
    lo, hi = bounds(meshes)
    offset = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    for o in meshes:
        if o.parent is None:
            o.location -= offset
    bpy.context.view_layer.update()
    lo, hi = bounds(meshes)
    print(f"{name}: faces {before} -> {after}, size {tuple(round(v, 3) for v in (hi - lo))}")

    # Lamp: where the bulb is (vertices of the "light" material), Blender coords.
    if name == "desk_lamp_arm_01":
        for o in meshes:
            idx = [i for i, m in enumerate(o.data.materials) if m and m.name.endswith("_light")]
            if not idx:
                continue
            pts = [o.matrix_world @ o.data.vertices[v].co for p in o.data.polygons if p.material_index in idx for v in p.vertices]
            if pts:
                c = sum(pts, Vector()) / len(pts)
                plo = Vector(map(min, *[tuple(p) for p in pts])) if len(pts) > 1 else c
                print("BULB (three.js x,y,z, metres):", round(c.x, 4), round(c.z, 4), round(-c.y, 4))

    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT, cfg["out"]),
        export_format="GLB",
        export_image_format="WEBP",
        export_image_quality=80,
        export_tangents=False,
        export_draco_mesh_compression_enable=False,
    )
print("PREP DONE")
