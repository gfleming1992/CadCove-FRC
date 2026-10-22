"""Optional real FreeCAD/add-on integration, plus portable native validation."""
import copy
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'src/native'))
import cadquery as cq
import ezdxf
from sheetmetal_geometry import prepare, export_job, finish


def bracket(two=False):
    shape = (cq.Workplane('XZ').moveTo(-40, 0).lineTo(0, 0)
        .threePointArc((5/math.sqrt(2), 5-5/math.sqrt(2)), (5, 5)).lineTo(5, 35)
        .lineTo(3, 35).lineTo(3, 5).threePointArc((3/math.sqrt(2), 5-3/math.sqrt(2)), (0, 2))
        .lineTo(-40, 2))
    if two:
        shape = (shape.threePointArc((-40-3/math.sqrt(2), 5-3/math.sqrt(2)), (-43, 5))
                 .lineTo(-43, 35).lineTo(-45, 35).lineTo(-45, 5)
                 .threePointArc((-40-5/math.sqrt(2), 5-5/math.sqrt(2)), (-40, 0)))
    shape = shape.close().extrude(20).val()
    return shape.cut(cq.Solid.makeCylinder(2, 4, cq.Vector(-20, -10, -1)))


def request():
    return dict(schema=1, part='bracket', thicknessMm=2,
                rootFace=dict(id='base', part='bracket', kind='plane', point=[-20, -10, 0], axis=[0, 0, -1]),
                kFactor=dict(value=.4, standard='ansi', source='Explicit synthetic test assumption'))


class SheetMetal(unittest.TestCase):
    def test_input_and_stale_geometry_fail_before_output(self):
        parts = [dict(id='bracket', shape=bracket())]
        self.assertEqual(prepare(parts, request())[1]['rootFace']['matches'], 1)
        for changes in [dict(thicknessMm=0), dict(kFactor={}), dict(shapeHash='stale'), dict(scale=2),
                        dict(kFactor=dict(value=.8, standard='ansi', source='test'))]:
            with tempfile.TemporaryDirectory() as tmp:
                output = Path(tmp)/'result'
                with self.assertRaises(ValueError): export_job(parts, dict(request(), **changes), output)
                self.assertFalse(output.exists())
        bad = request(); bad['rootFace']['point'] = [0, 0, 0]
        with self.assertRaisesRegex(ValueError, 'missing'): prepare(parts, bad)

    @unittest.skipUnless(os.environ.get('CADCOVE_FREECAD') and os.environ.get('CADCOVE_SHEETMETAL'), 'Optional FreeCAD and SheetMetal required')
    def test_headless_unfold_bend_allowance_holes_units_and_errors(self):
        parts = [dict(id='bracket', shape=bracket())]
        with tempfile.TemporaryDirectory() as tmp:
            def run(name, req):
                root = Path(tmp)/name; export_job(parts, req, root)
                env = dict(os.environ, CADCOVE_SHEETMETAL_JOB=str(root))
                p = subprocess.run([env['CADCOVE_FREECAD'], '-u', str(root/'user.cfg'), '-s', str(root/'system.cfg'),
                                    str(Path(__file__).resolve().parents[1]/'src/native/sheetmetal_freecad.py')],
                                   env=env, capture_output=True, text=True, timeout=60)
                self.assertEqual(p.returncode, 0, p.stderr)
                return root, json.loads((root/'backend-result.json').read_text())
            for name, k, standard in [('ansi', .4, 'ansi'), ('din', .8, 'din'), ('different', .25, 'ansi')]:
                req = request(); req['kFactor'].update(value=k, standard=standard)
                root, backend = run(name, req)
                self.assertTrue(backend['ok'], backend); self.assertEqual(backend['guiUp'], 0)
                result = finish(root, explain=True)
                length = 70 + math.pi/2*(3+2*(k/2 if standard == 'din' else k))
                self.assertAlmostEqual(result['flat']['boundsMm']['max'][0], length, places=5)
                self.assertAlmostEqual(result['flat']['areaMm2'], length*20-4*math.pi, places=4)
                self.assertEqual(result['flat']['holeCount'], 1)
                cut = ezdxf.readfile(root/'cut.dxf'); full = ezdxf.readfile(root/'unfold.dxf')
                self.assertEqual(cut.units, 4); self.assertEqual(full.units, 4)
                self.assertEqual({e.dxf.layer for e in cut.modelspace()}, {'OUTLINE', 'HOLES'})
                self.assertIn('BENDS', {e.dxf.layer for e in full.modelspace()})
                self.assertEqual(len(full.modelspace().query('LINE[layer=="BENDS"]')), 1)
                self.assertIn('<path', (root/'preview.svg').read_text())
                self.assertIn('<animate ', (root/'folds.svg').read_text())
                from fold_diagram import diagram
                diagram(backend['bends'],2,req['kFactor'],root/'again.svg')
                self.assertEqual((root/'folds.svg').read_bytes(),(root/'again.svg').read_bytes())
                self.assertNotIn('<script', (root/'folds.svg').read_text())
                with self.assertRaises(FileExistsError): export_job(parts, req, root)
            # Two bends and an assembly placement must retain dimensions and holes.
            moved = bracket(two=True).rotate((0,0,0),(1,0,0),90).translate((10,20,30))
            parts = [dict(id='bracket',shape=moved)]
            req = request(); req['rootFace'].update(point=[-10,20,20],axis=[0,1,0])
            root, backend = run('rotated-two-bends', req)
            self.assertTrue(backend['ok'],backend); self.assertEqual(backend['bendCount'],2)
            result = finish(root, explain=True)
            self.assertAlmostEqual(result['flat']['areaMm2'], (100+math.pi*(3+.4*2))*20-4*math.pi, places=4)
            self.assertEqual(result['flat']['holeCount'],1)
            parts = [dict(id='bracket',shape=bracket())]
            parts = [dict(id='bracket',shape=bracket().cut(cq.Solid.makeCylinder(3,1,cq.Vector(-20,-10,1))))]
            root, backend = run('counterbore', request())
            self.assertFalse(backend['ok']); self.assertIn('uniform sheet',backend['error'])
            self.assertFalse((root/'flat.brep').exists())
            parts = [dict(id='bracket',shape=bracket())]
            bad = request(); bad['thicknessMm'] = 3
            root, backend = run('bad-thickness', bad)
            self.assertFalse(backend['ok']); self.assertIn('thickness', backend['error'])
            with self.assertRaises(ValueError): finish(root)
            self.assertFalse((root/'cut.dxf').exists())

if __name__ == '__main__': unittest.main()
