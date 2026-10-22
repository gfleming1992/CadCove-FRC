import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path
import cadquery as cq
from OCP.TDocStd import TDocStd_Document
from OCP.TCollection import TCollection_ExtendedString
from OCP.TDF import TDF_Label, TDF_LabelSequence
from OCP.TDataStd import TDataStd_Name
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.XCAFDoc import XCAFDoc_DocumentTool
root=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as tmp:
    tmp=Path(tmp);source=tmp/'source.step';output=tmp/'field';pin=tmp/'pin.json'
    assembly=cq.Assembly(name='fixture')
    assembly.add(cq.Workplane('XY').box(10,20,1),name='window',color=cq.Color(.5,.5,.5,.2))
    assembly.add(cq.Workplane('XY').box(10,20,1).translate((15,0,0)),name='frame',color=cq.Color(.2,.2,.2,1))
    assembly.save(str(source))
    doc=TDocStd_Document(TCollection_ExtendedString('BinXCAF'));reader=STEPCAFControl_Reader()
    reader.ReadFile(str(source));reader.Transfer(doc);shapes=XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    occurrences=[]
    def walk(label,identifier):
        ref=TDF_Label();prototype=ref if shapes.GetReferredShape_s(label,ref) else label
        children=TDF_LabelSequence();shapes.GetComponents_s(prototype,children,False)
        if children.Length():
            for i in range(1,children.Length()+1):walk(children.Value(i),identifier+'/'+str(i-1))
        else:
            attr=TDataStd_Name();prototype.FindAttribute(TDataStd_Name.GetID_s(),attr)
            name=attr.Get().ToExtString();occurrences.append(dict(id='step:'+identifier,name=name,asset=name))
    roots=TDF_LabelSequence();shapes.GetFreeShapes(roots)
    for i in range(1,roots.Length()+1):walk(roots.Value(i),str(i-1))
    raw=source.read_bytes();pin.write_text(json.dumps(dict(bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest(),occurrences=occurrences)))
    command=[sys.executable,str(root/'scripts/native-field.py'),str(source),str(output),str(pin)]
    subprocess.run(command,check=True,capture_output=True)
    appearance=json.loads((output/'appearance.json').read_text())
    values=[appearance['instances'][n['id']]['opacity'] for n in occurrences]
    assert any(abs(v-.2)<1e-6 for v in values),values
    assert any(v==1 for v in values),values
    originals={p:p.read_bytes() for p in output.rglob('*') if p.is_file() and 'appearance' not in p.parts and p.name!='appearance.json'}
    subprocess.run(command+['--appearance-only'],check=True,capture_output=True)
    assert all(p.read_bytes()==data for p,data in originals.items()),'Appearance refresh changed geometry/bindings'
    assert json.loads((output/'appearance.json').read_text())==appearance
print(json.dumps(dict(ok=True,rgbaRoundtrip=True,appearanceOnlyPreservesGeometry=True)))
