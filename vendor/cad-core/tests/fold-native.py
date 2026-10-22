"""Fixtures/OCCT verification for the real JS fold evaluator (no duplicate solver)."""
import json, os, subprocess, sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src/native'))
from geometry import mesh
from sheetmetal_geometry import export_job
import cadquery as cq
# Reuse the existing sheet-metal geometric fixture, not a checked-in robot.
import importlib.util
spec=importlib.util.spec_from_file_location('sheet_fixture',Path(__file__).with_name('sheetmetal-native.py'))
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)
root=Path(sys.argv[2])
if sys.argv[1]=='prepare':
    for name in ['base','nested','rotated']:
        shape=fixture.bracket(two=True);req=fixture.request()
        if name!='base':req['rootFace'].update(point=[5,-10,20],axis=[1,0,0])
        if name=='rotated':
            shape=shape.rotate((0,0,0),(1,0,0),37).translate((13,22,39))
            import math
            a=math.radians(37);req['rootFace'].update(point=[18,-10*math.cos(a)-20*math.sin(a)+22,-10*math.sin(a)+20*math.cos(a)+39])
        output=root/name;export_job([dict(id='bracket',shape=shape)],req,output)
        env=dict(os.environ,CADCOVE_SHEETMETAL_JOB=str(output),CADCOVE_SHEETMETAL_FOLD='1')
        p=subprocess.run([env['CADCOVE_FREECAD'],'-u',str(output/'user.cfg'),'-s',str(output/'system.cfg'),str(Path(__file__).resolve().parents[1]/'src/native/sheetmetal_freecad.py')],env=env,capture_output=True,text=True,timeout=60)
        result=json.loads((output/'backend-result.json').read_text());assert result['ok'],result
        definition=json.loads((output/'fold-definition.json').read_text());parts=[]
        for z in definition['zones']:
            arrays=mesh(cq.importers.importStep(str(output/z['file'])).val(),.03,.1)
            parts.append(dict(id=z['id'],color='#73b9df',**dict(zip(['positions','normals','indices'],[a.tolist() for a in arrays]))))
        (output/'mesh.json').write_text(json.dumps(dict(parts=parts)))
    print(json.dumps(dict(ok=True)))
else:
    worst=0
    for name in ['base','nested','rotated']:
        output=root/name;shape=cq.Shape.importBrep(str(output/'fold-reference.brep'))
        points=json.loads((output/'evaluated.json').read_text())
        # Mesh nodes may lie inside the solid on internal zone boundaries.
        # Test against exact BREP, not another tessellation or the same equation.
        for p in points:
            d=cq.Vertex.makeVertex(*p).distance(shape);worst=max(worst,d)
            assert d<.001,(name,p,d)
        bounds=shape.BoundingBox()
        for k,(lo,hi) in enumerate([(bounds.xmin,bounds.xmax),(bounds.ymin,bounds.ymax),(bounds.zmin,bounds.zmax)]):
            assert abs(min(p[k] for p in points)-lo)<.001
            assert abs(max(p[k] for p in points)-hi)<.001
    print(json.dumps(dict(ok=True,maximumDistanceMm=worst)))
