"""Rebuild pinned field prototypes and XCAF presentation using native OCCT."""
import hashlib
import json
import sys
from pathlib import Path
import cadquery as cq
from OCP.TDocStd import TDocStd_Document
from OCP.TCollection import TCollection_ExtendedString, TCollection_AsciiString
from OCP.TDF import TDF_Label, TDF_LabelSequence, TDF_Tool
from OCP.TDataStd import TDataStd_Name
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.IFSelect import IFSelect_RetDone
from OCP.XCAFDoc import XCAFDoc_DocumentTool, XCAFDoc_ShapeTool, XCAFDoc_ColorGen, XCAFDoc_ColorSurf
from OCP.Quantity import Quantity_Color, Quantity_TOC_sRGB
from OCP.BRepBndLib import BRepBndLib
from OCP.Bnd import Bnd_Box
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'vendor/cad-core/src/native'))
from geometry import mesh, encode

source, output, pin_file = map(Path, sys.argv[1:])
pin = json.loads(pin_file.read_text())
raw = source.read_bytes()
assert len(raw) == pin['bytes'] and hashlib.sha256(raw).hexdigest() == pin['sha256'], 'Unexpected field revision'
expected = {n['id']: n for n in pin['occurrences']}
doc = TDocStd_Document(TCollection_ExtendedString('BinXCAF'))
reader = STEPCAFControl_Reader()
reader.SetColorMode(True); reader.SetNameMode(True)
assert reader.ReadFile(str(source)) == IFSelect_RetDone and reader.Transfer(doc), 'STEP import failed'
shapes = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
colors = XCAFDoc_DocumentTool.ColorTool_s(doc.Main())
identity = [1,0,0,0,0,1,0,0,0,0,1,0]
catalog, instances, prototypes = {}, [], {}
appearance = dict(schema=1,sourceHash=pin["sha256"],instances={},catalog={})
styles = {}
for directory in ('components','meshes','appearance'): (output/directory).mkdir(parents=True,exist_ok=True)
def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def name(label):
    attr = TDataStd_Name()
    return attr.Get().ToExtString() if label.FindAttribute(TDataStd_Name.GetID_s(),attr) else ''
def color(label, fallback):
    result = Quantity_Color()
    for kind in (XCAFDoc_ColorSurf, XCAFDoc_ColorGen):
        if colors.GetColor_s(label, kind, result):
            return '#'+''.join(f'{max(0,min(255,round(v*255))):02x}' for v in result.Values(Quantity_TOC_sRGB))
    return fallback
def compose(a,b):
    return [sum(a[r*4+k]*b[k*4+c] for k in range(3))+(a[r*4+3] if c==3 else 0) for r in range(3) for c in range(4)]
def walk(label, identifier, parent, inherited):
    referred = TDF_Label()
    prototype = referred if shapes.GetReferredShape_s(label,referred) else label
    tr = shapes.GetLocation_s(label).Transformation()
    transform = [tr.Value(r,c) for r in range(1,4) for c in range(1,5)]
    node = dict(id='step:'+identifier, name=name(prototype) or name(label) or 'part-'+identifier, transform=transform)
    world = compose(parent,transform)
    rgb = color(label,color(prototype,inherited))
    children = TDF_LabelSequence()
    shapes.GetComponents_s(prototype,children,False)
    if children.Length():
        node['children'] = [n for i in range(1,children.Length()+1) if (n:=walk(children.Value(i),identifier+'/'+str(i-1),world,rgb))]
        return node
    raw_shape = shapes.GetShape_s(prototype)
    if raw_shape.IsNull(): return None
    ref = expected.get(node['id'])
    assert ref and ref['name'] == node['name'], 'Field occurrence mismatch: '+str(node)
    entry = TCollection_AsciiString(); TDF_Tool.Entry_s(prototype,entry); key = entry.ToCString()
    asset = prototypes.get(key)
    if asset is None:
        asset = ref['asset']; shape = cq.Shape.cast(raw_shape)
        if not shape.isValid(): shape = shape.fix()
        valid = shape.isValid()
        if not valid: print('Imported field component has unresolved validity:',asset,file=sys.stderr)
        step_path = output/'components'/(asset+'.step'); cq.exporters.export(shape,str(step_path))
        arrays = mesh(shape,1,.4)
        bbox = Bnd_Box(); BRepBndLib.AddOptimal_s(shape.wrapped,bbox,False,False)
        bounds = bbox.Get()
        metrics = dict(valid=valid,volume=shape.Volume(),bounds=dict(min=list(bounds[:3]),max=list(bounds[3:])),triangles=len(arrays[2])//3)
        metadata = dict(id=asset,name=node['name'],color=rgb,metrics=metrics,p=len(arrays[0]),n=len(arrays[1]),i=len(arrays[2]))
        mesh_path = output/'meshes'/(asset+'.bin'); encode([metadata],[arrays],str(mesh_path))
        catalog[asset] = dict(name=node['name'],file='components/'+asset+'.step',sha256=digest(step_path),bytes=step_path.stat().st_size,mesh='meshes/'+asset+'.bin',meshSha256=digest(mesh_path),meshBytes=mesh_path.stat().st_size,centerOfMass=list(shape.Center().toTuple()),unitDensityInertia=[v for row in cq.Shape.matrixOfInertia(shape) for v in row],**metrics)
        groups = {}
        for face in cq.Shape.cast(raw_shape).Faces():
            value = Quantity_Color(); face_color = None
            for kind in (XCAFDoc_ColorSurf, XCAFDoc_ColorGen):
                if colors.GetColor(face.wrapped,kind,value):
                    face_color = '#'+''.join(f'{max(0,min(255,round(v*255))):02x}' for v in value.Values(Quantity_TOC_sRGB)); break
            groups.setdefault(face_color,[]).append(face)
        style = []
        for face_color, faces in groups.items():
            a = mesh(cq.Compound.makeCompound(faces),1,.4)
            temp = output/'appearance'/'surface.tmp.bin'
            encode([dict(id='surface',name='surface',color='#ffffff',p=len(a[0]),n=len(a[1]),i=len(a[2]))],[a],str(temp))
            h = digest(temp); destination = output/'appearance'/(h+'.bin'); temp.replace(destination)
            surface = 'surface-'+h
            appearance['catalog'][surface] = dict(mesh='appearance/'+h+'.bin',meshSha256=h)
            style.append(dict(asset=surface,color=face_color))
        styles[asset] = style
        prototypes[key] = asset
        if len(prototypes)%50==0: print('Field prototypes:',len(prototypes),file=sys.stderr)
    assert asset==ref['asset'], 'Field prototype mismatch'
    node.update(asset=asset,color=rgb)
    appearance['instances'][node['id']] = (dict(color=styles[asset][0]['color'] or rgb) if len(styles[asset])==1 else dict(parts=[dict(asset=p['asset'],color=p['color'] or rgb) for p in styles[asset]]))
    instances.append(dict(node,transform=world))
    return node
roots = TDF_LabelSequence(); shapes.GetFreeShapes(roots)
children = [walk(roots.Value(i),str(i-1),identity,'#bcbcbc') for i in range(1,roots.Length()+1)]
assert len(instances)==len(expected), 'Field occurrence count mismatch'
for file,value in {'assembly.json':dict(schema=1,id='field',units='mm',sourceHash=pin['sha256'],children=children),'catalog.json':catalog,'instances.json':instances}.items():
    (output/file).write_text(json.dumps(value,indent=2)+'\n')
(output/'appearance.json').write_text(json.dumps(appearance))
(output/'models.py').write_bytes((Path(__file__).parent/'component-model.py').read_bytes())
print(json.dumps(dict(occurrences=len(instances),prototypes=len(prototypes))))
