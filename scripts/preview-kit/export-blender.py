"""Headless, read-only-source Stage derivative. Run via Blender; see README.md.

No rendering, source saves, texture baking, addons from the scene or external services.
The output contains the user's actual evaluated meshes, reduced and consolidated, not
reconstructed cylinders. Browser materials/live RGB are deliberately supplied at runtime.
"""
import argparse
import hashlib
import json
import math
import pathlib
import re
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

SOURCE_HASH = '8715c5423ff8efe96966d7a448f617888034fd1f149c7ac2d7ee84a84b22acbc'
SOURCE_NAME = 'docs/cad/drum-kit/.cache/blender/realism/raised-rim-v1.blend'
# Tape-centre dimensions, not outer shell sizes. From the frozen CAD LED layout.
PROFILES = {
    'kick': {'id': 'kick', 'radiusMm': 256.75, 'hoopSpacingMm': 94.0, 'count': 196},
    'snare': {'id': 'snare', 'radiusMm': 139.25, 'hoopSpacingMm': 182.0 / 3, 'count': 108},
    'tom1': {'id': 'tom1', 'radiusMm': 139.25, 'hoopSpacingMm': 182.0 / 3, 'count': 108},
    'floor-tom': {'id': 'tom2', 'radiusMm': 179.25, 'hoopSpacingMm': 322.0 / 3, 'count': 136},
}
# Per consolidated mesh triangle targets. No geometric scaling changes the source profile.
TARGETS = {'acrylic': 15000, 'head': 4000, 'metal': 18000, 'gasket': 4500,
           'pcb': 1500, 'diffuser-body': 4000, 'led-lens': 2400, 'led-tape': 1200}
MAX_TRIANGLES = 320000
MAX_BYTES = 20 * 1024 * 1024


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def rendered_objects():
    names = set()
    def walk(layer):
        if layer.exclude or layer.collection.hide_render:
            return
        names.update(o.name for o in layer.collection.objects if not o.hide_render)
        for child in layer.children:
            walk(child)
    walk(bpy.context.view_layer.layer_collection)
    return [o for o in bpy.data.objects if o.type == 'MESH' and o.name in names]


def classify(obj):
    match = re.search(r'(?:^|/)(kick|snare|tom1|floor-tom)(?=[./]|$)', obj.name)
    if not match:
        assert obj.name == 'Dark stage (not CAD)', f'Unclassified source mesh: {obj.name}'
        return None
    cad_id = match.group(1)
    names = [m.name for m in obj.data.materials if m]
    assert len(names) == 1, (obj.name, names)
    material = names[0]
    hoop = None
    if obj.name.startswith('Silicone/'):
        hoop = int(re.search(r'/hoop(\d+)/', obj.name).group(1))
        role = {'body': 'diffuser-body', 'lens': 'led-lens', 'tape': 'led-tape'}[obj.name.rsplit('/', 1)[1]]
    # The source shares shell-acrylic with the THIN HEAD membrane. Role is physical
    # purpose, not just a Blender material name; otherwise Eco erases the drumheads.
    elif obj.name.endswith('.upper-head.thin-envelope') or 'head-white-woven' in material: role = 'head'
    elif material == 'Onshape/shell-acrylic': role = 'acrylic'
    elif material in ('NONPRINT/polished chrome', 'Onshape/steel'): role = 'metal'
    elif material in ('NONPRINT/v2 black isolator', 'Onshape/dark-plastic'): role = 'gasket'
    elif material == 'Onshape/pcb-green': role = 'pcb'
    else: raise ValueError(f'Unclassified material {material} on {obj.name}')
    return cad_id, role, hoop


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    parser.add_argument('--layout', required=True)
    parser.add_argument('--report', required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    assert bpy.app.background, 'Headless only'
    assert bpy.app.version >= (4, 5, 0), bpy.app.version_string
    source = pathlib.Path(bpy.data.filepath).resolve()
    assert source.name == 'raised-rim-v1.blend'
    assert sha256(source) == SOURCE_HASH, 'Source changed: review and pin a new derivative explicitly'
    out = pathlib.Path(args.out).resolve()
    assert out.suffix == '.glb' and out != source
    assert 'docs/cad' not in out.as_posix(), 'Never write into the original CAD tree'
    out.parent.mkdir(parents=True, exist_ok=True)
    report_path = pathlib.Path(args.report).resolve()
    assert 'docs/cad' not in report_path.as_posix()
    layout = json.loads(pathlib.Path(args.layout).read_text())
    assert layout['units'] == 'mm'
    assert bpy.context.scene.unit_settings.scale_length == 1.0

    groups = {}
    originals = rendered_objects()
    for obj in originals:
        key = classify(obj)
        if key is not None:
            groups.setdefault(key, []).append(obj)
    assert len(groups) == 68, f'Unexpected derivative role groups: {len(groups)}'
    collection = bpy.data.collections.new('Stage derivative (export only)')
    bpy.context.scene.collection.children.link(collection)
    roots = {}
    transforms = {}
    for cad_id, profile in PROFILES.items():
        root = bpy.data.objects.new('kit:' + profile['id'], None)
        root['stageDrumId'] = profile['id']
        collection.objects.link(root)
        roots[cad_id] = root
        drum = layout['drums'][cad_id]
        origin = Vector([drum['cadOrigin'][key] / 1000 for key in ('x', 'y', 'z')])
        rotation = Euler([math.radians(drum['cadRotation'][key]) for key in ('x', 'y', 'z')], 'XYZ').to_matrix().to_4x4()
        centre_z = (drum['hoops'][0]['zMm'] + drum['hoops'][-1]['zMm']) / 2000
        transforms[cad_id] = Matrix.Translation((0, 0, -centre_z)) @ rotation.inverted() @ Matrix.Translation(-origin)

    # Export materials are named role placeholders, not captured lookdev or packed RGB.
    materials = {}
    for role in TARGETS:
        material = bpy.data.materials.new('Stage/' + role)
        material.use_nodes = True
        principled = material.node_tree.nodes.get('Principled BSDF')
        principled.inputs['Base Color'].default_value = (0.5, 0.5, 0.5, 1)
        principled.inputs['Roughness'].default_value = 0.5
        materials[role] = material

    depsgraph = bpy.context.evaluated_depsgraph_get()
    created = []
    totals = []
    for (cad_id, role, hoop), objects in sorted(groups.items(), key=lambda item: str(item[0])):
        merged = bmesh.new()
        before_triangles = 0
        for original in objects:
            # The saved scene is never saved back. Evaluate only the approved visible objects.
            evaluated = original.evaluated_get(depsgraph)
            mesh = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=False, depsgraph=depsgraph)
            mesh.transform(transforms[cad_id] @ original.matrix_world)
            before_triangles += sum(len(p.vertices) - 2 for p in mesh.polygons)
            merged.from_mesh(mesh)
            bpy.data.meshes.remove(mesh)
        mesh = bpy.data.meshes.new(f"Stage/{PROFILES[cad_id]['id']}/{role}/{hoop or 0}")
        merged.to_mesh(mesh)
        merged.free()
        mesh.materials.append(materials[role])
        for face in mesh.polygons:
            face.material_index = 0
        obj = bpy.data.objects.new(mesh.name, mesh)
        collection.objects.link(obj)
        obj.parent = roots[cad_id]
        obj['stageRole'] = role
        if hoop is not None: obj['stageHoop'] = hoop
        target = TARGETS[role]
        if before_triangles > target:
            modifier = obj.modifiers.new('Stage bounded detail', 'DECIMATE')
            modifier.decimate_type = 'COLLAPSE'
            modifier.ratio = target / before_triangles
            modifier.use_collapse_triangulate = True
            bpy.context.view_layer.objects.active = obj
            obj.select_set(True)
            bpy.ops.object.modifier_apply(modifier=modifier.name)
            obj.select_set(False)
        mesh = obj.data
        # Remove all inherited attributes that could export source textures/lighting metadata.
        while mesh.uv_layers: mesh.uv_layers.remove(mesh.uv_layers[0])
        while mesh.color_attributes: mesh.color_attributes.remove(mesh.color_attributes[0])
        mesh.calc_loop_triangles()
        triangles = len(mesh.loop_triangles)
        totals.append({'id': PROFILES[cad_id]['id'], 'role': role, 'hoop': hoop,
                       'sourceObjects': len(objects), 'beforeTriangles': before_triangles,
                       'triangles': triangles, 'vertices': len(mesh.vertices)})
        created.append(obj)
        print(f'STAGE_MESH {obj.name}: {before_triangles} -> {triangles} triangles', flush=True)

    triangle_count = sum(item['triangles'] for item in totals)
    assert triangle_count <= MAX_TRIANGLES, (triangle_count, MAX_TRIANGLES)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in list(roots.values()) + created: obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(out), export_format='GLB', use_selection=True,
        export_yup=True, export_apply=False, export_normals=True, export_texcoords=False,
        export_materials='EXPORT', export_extras=True, export_cameras=False,
        export_lights=False, export_animations=False)
    assert out.stat().st_size <= MAX_BYTES, f'Asset exceeds byte budget: {out.stat().st_size}'
    assert sha256(source) == SOURCE_HASH, 'Original scene changed'
    manifest = {
        'version': 1, 'source': {'path': SOURCE_NAME, 'sha256': SOURCE_HASH},
        'units': 'metres', 'axes': 'gltf-y-up',
        'drums': [{'id': p['id'], 'cadId': cad, 'rootName': 'kit:' + p['id'],
                   'radiusMm': p['radiusMm'], 'hoopSpacingMm': p['hoopSpacingMm'],
                   'hoopPixelCounts': [p['count']] * 4} for cad, p in PROFILES.items()],
    }
    out.with_suffix('.manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    report = {'sourceSha256': SOURCE_HASH, 'sourceUnchanged': True,
              'blenderVersion': bpy.app.version_string, 'rendered': False,
              'meshCount': len(created), 'triangles': triangle_count, 'bytes': out.stat().st_size,
              'assetSha256': sha256(out), 'meshes': totals,
              'limits': ['Photo-informed model, not fabrication certification',
                         'Reduced actual geometry; small hardware/profile details simplified',
                         'Runtime materials/light are illustrative, not Cycles equivalence']}
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + '\n')
    print('STAGE_EXPORT', json.dumps({k: v for k, v in report.items() if k != 'meshes'}), flush=True)


main()
