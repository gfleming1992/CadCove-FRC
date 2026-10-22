import copy
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src/native'))
import cadquery as cq
from drawing_geometry import export_drawing, validate
from cad_references import fingerprint

class Drawings(unittest.TestCase):
    def test_evidence_and_missing_references(self):
        shape=cq.Workplane('XY').box(80,50,6,centered=(False,False,False)).val()
        request=dict(schema=1,part='plate',shapeHash=fingerprint(shape),dimensions=[dict(id='width',type='horizontal',view='top',points=[[0,0,6],[80,0,6]],positionMm=[70,115])])
        with tempfile.TemporaryDirectory() as root:
            result=export_drawing([dict(id='plate',shape=shape)],request,str(Path(root)/'drawing'))
            self.assertEqual(result['shapeHash'],fingerprint(shape))
            with self.assertRaises(FileExistsError): export_drawing([dict(id='plate',shape=shape)],request,str(Path(root)/'drawing'))
            with self.assertRaisesRegex(ValueError,'Stale'): export_drawing([dict(id='plate',shape=shape)],dict(request,shapeHash='bad'),str(Path(root)/'stale'))
            request['dimensions'][0]['points'][1][0]=81
            with self.assertRaisesRegex(ValueError,'missing CAD vertex'):export_drawing([dict(id='plate',shape=shape)],request,str(Path(root)/'missing'))
            self.assertFalse((Path(root)/'missing').exists())
    def test_contract(self):
        request=dict(schema=1,part='plate')
        for change in [dict(scale=float('nan')),dict(scale=True),dict(scale=0),dict(unknown=1),dict(notes=['x']*3),dict(title='x\n')]:
            with self.assertRaises(ValueError):validate(dict(request,**change))
        dim=dict(id='width',type='horizontal',view='top',points=[[0,0,0],[1,0,0]],positionMm=[70,115])
        for change in [dict(view='isometric'),dict(positionMm=[-1,0]),dict(points=[[0,0,0],[0,0,0]])]:
            with self.assertRaises(ValueError):validate(dict(request,dimensions=[dict(dim,**change)]))
        with self.assertRaises(ValueError):validate(dict(request,dimensions=[dim,copy.deepcopy(dim)]))

if __name__=='__main__':unittest.main()
