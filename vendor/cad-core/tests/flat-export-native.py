import json
import math
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'src/native'))
import cadquery as cq
import ezdxf
from flat_export import export_flat, prepare

FRAME = dict(origin=[0,0,0], xDir=[1,0,0], normal=[0,0,1])
def plate():
    return cq.Workplane('XY').box(80,50,6,centered=(False,False,False)).faces('>Z').workplane().pushPoints([(20,25),(60,25)]).hole(10).val()
def request(**kw): return dict(schema=1,part='plate',frame=FRAME,**kw)
def parts(shape): return [dict(id='plate',shape=shape)]

class FlatExport(unittest.TestCase):
    def test_roundtrip_closed_full_size_and_holes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/'flat'
            shape=plate();shape.tessellate(0.1)
            result=export_flat(parts(shape),request(),str(root))
            self.assertEqual(result['holeCount'],2)
            self.assertAlmostEqual(result['thicknessMm'],6)
            doc=ezdxf.readfile(root/'profile.dxf')
            self.assertEqual(doc.units,4)
            self.assertEqual(len(doc.modelspace().query('CIRCLE')),2)
            self.assertEqual(len(doc.modelspace().query('LINE')),4)
            self.assertEqual({e.dxf.layer for e in doc.modelspace()},{'OUTLINE','HOLES'})
            imported=cq.importers.importDXF(str(root/'profile.dxf')).wires().vals()
            self.assertEqual(len(imported),3)
            self.assertTrue(all(w.IsClosed() for w in imported))
            bbox=cq.Compound.makeCompound(imported).BoundingBox()
            self.assertAlmostEqual(bbox.xlen,80);self.assertAlmostEqual(bbox.ylen,50)
            areas=sorted(cq.Face.makeFromWires(w).Area() for w in imported)
            self.assertAlmostEqual(areas[-1]-sum(areas[:-1]),4000-50*math.pi)
            svg=(root/'profile.svg').read_text()
            self.assertIn('width="80mm"',svg)
            self.assertIn('<path',svg);self.assertEqual(result['preview']['entityCount'],6)
            self.assertNotIn('<text',svg)
            with self.assertRaises(FileExistsError):export_flat(parts(plate()),request(),str(root))

    def test_rotated_occurrence_and_arcs(self):
        shape=cq.Workplane('XY').rect(80,50).extrude(6).edges('|Z').fillet(5).val()
        moved=shape.rotate((0,0,0),(1,0,0),90).translate((12,23,34))
        req=dict(schema=1,part='plate',frame=dict(origin=[12,23,34],xDir=[1,0,0],normal=[0,-1,0]))
        with tempfile.TemporaryDirectory() as tmp:
            result=export_flat(parts(moved),req,str(Path(tmp)/'flat'))
            doc=ezdxf.readfile(Path(tmp)/'flat/profile.dxf')
            self.assertEqual(len(doc.modelspace().query('ARC')),4)
            self.assertAlmostEqual(result['thicknessMm'],6)
            self.assertAlmostEqual(result['boundsMm']['max'][0]-result['boundsMm']['min'][0],80)

    def test_reject_nonflat_stale_bad_frame_without_output(self):
        pocket=cq.Workplane('XY').box(80,50,6,centered=(False,False,False)).faces('>Z').workplane().center(30,20).circle(5).cutBlind(-2).val()
        bevel=cq.Workplane('XY').box(80,50,6,centered=(False,False,False)).faces('>Z').edges().chamfer(1).val()
        for shape in (pocket,bevel):
            with tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp)/'bad'
                with self.assertRaisesRegex(ValueError,'constant-section'):export_flat(parts(shape),request(),str(root))
                self.assertFalse(root.exists())
        for change in (dict(shapeHash='stale'),dict(scale=2),dict(frame=dict(FRAME,normal=[1,0,0])),dict(frame=dict(FRAME,origin=[0,0,3])),dict(frame=dict(FRAME,xDir=[float('nan'),0,0]))):
            with self.assertRaises(ValueError):prepare(parts(plate()),dict(request(),**change))

    def test_dxf_preview_units_and_failures(self):
        from dxf_preview import render_dxf
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);doc=ezdxf.new();doc.units=1
            doc.modelspace().add_circle((1,1),1);doc.saveas(root/'inches.dxf')
            result=render_dxf(root/'inches.dxf',root/'inches.svg')
            self.assertAlmostEqual(result['widthMm'],50.8)
            self.assertIn('width="50.8mm"',(root/'inches.svg').read_text())
            with self.assertRaisesRegex(ValueError,'already exists'):render_dxf(root/'inches.dxf',root/'inches.svg')
            doc.modelspace().add_text('unsupported');doc.saveas(root/'text.dxf')
            with self.assertRaisesRegex(ValueError,'TEXT'):render_dxf(root/'text.dxf',root/'text.svg')
            self.assertFalse((root/'text.svg').exists())

if __name__=='__main__':unittest.main()
