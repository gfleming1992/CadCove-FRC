import copy
import sys
from pathlib import Path
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src/native'))
from sketch_solver import solve
from cad_references import resolve, ReferenceError
from fea_request import prepare
import cadquery as cq


def layout(spacing):
    return dict(schema=1, units='mm', points=[dict(id='left', x=0, y=0), dict(id='right', x=spacing, y=0)],
        lines=[dict(id='centers', a='left', b='right')],
        circles=[dict(id='bearingLeft', center='left', radius=5), dict(id='bearingRight', center='right', radius=4)],
        constraints=[dict(id='origin', type='fix', point='left', x=0, y=0),
            dict(id='aligned', type='horizontal', line='centers'),
            dict(id='spacing', type='distance', a='left', b='right', value=spacing),
            dict(id='bore', type='radius', circle='bearingLeft', value=5),
            dict(id='matchingBearings', type='equalRadius', a='bearingLeft', b='bearingRight')])


class SketchTests(unittest.TestCase):
    def test_fea_input_review_never_invents_missing_physics(self):
        request = dict(schema=1, analysis='linearStatic', units='mm-N-MPa', parts=[dict(id='plate')], outputs=['stress', 'safetyFactor'])
        r = prepare(request)
        self.assertFalse(r['inputComplete'])
        self.assertTrue(any(q['field'].endswith('yieldStrengthMPa') for q in r['questions']))
        self.assertEqual(request['parts'][0], dict(id='plate'))
        request['parts'][0].update(shapeHash='a'*64, material=dict(name='test material', source='synthetic fixture only', youngsModulusMPa=70000, poissonRatio=.3, yieldStrengthMPa=200))
        request['loads'] = [dict(id='pull',part='plate',reference='loaded-face',source='test fixture',forceN=[100,0,0])]
        request['supports'] = [dict(id='mount',part='plate',reference='mount-face',source='test fixture',restrainedTranslations=[True,True,True])]
        r = prepare(request)
        self.assertTrue(r['inputComplete']); self.assertFalse(r['readyToSolve']); self.assertFalse(r['solved'])
        request['parts'][0]['material']['poissonRatio'] = .5
        self.assertFalse(prepare(request)['inputComplete'])

    def test_plate_edit_and_reference_survives_topology_change(self):
        hashes = []
        for spacing in (40, 65):
            r = solve(layout(spacing))
            self.assertTrue(r['ok'], r)
            self.assertEqual(r['diagnosis']['degreesOfFreedom'], 0)
            self.assertAlmostEqual(r['points']['right']['x'], spacing, places=6)
            plate = cq.Workplane('XY').box(spacing+30, 30, 4, centered=(False, True, False)).translate((-15, 0, 0))
            for k in ('left', 'right'):
                p = r['points'][k]
                cutter = cq.Workplane('XY').center(p['x'], p['y']).circle(5).extrude(4)
                plate = plate.cut(cutter)
            if spacing == 65:
                plate = plate.cut(cq.Workplane('XY').center(30, 0).circle(3).extrude(4))
            shape = plate.val()
            ref = dict(id='rightBearing', part='plate', kind='cylinder', point=[spacing, 0, 2], axis=[0, 0, 1], radius=5)
            face, evidence = resolve([dict(id='plate', shape=shape)], ref)
            self.assertAlmostEqual(face.Center().x, spacing, places=6)
            self.assertTrue(shape.isValid())
            hashes.append(evidence['shapeHash'])
        self.assertNotEqual(*hashes)

    def test_conflict_underconstraint_and_bad_input(self):
        r = layout(40)
        r['constraints'].append(dict(id='wrongSpacing', type='distance', a='left', b='right', value=50))
        self.assertFalse(solve(r)['ok'])
        r = layout(40); r['constraints'] = r['constraints'][1:]
        self.assertFalse(solve(r)['ok'])
        r['requireFullyConstrained'] = False
        self.assertTrue(solve(r)['ok'])
        for change in (dict(value=float('nan')), dict(a='missing')):
            r = layout(40); r['constraints'][2].update(change)
            with self.assertRaises(ValueError): solve(r)
        r = layout(40); r['points'].append(copy.deepcopy(r['points'][0]))
        with self.assertRaises(ValueError): solve(r)

    def test_reference_missing_ambiguous_and_new_pose(self):
        cylinder = cq.Workplane('XY').circle(5).extrude(4).val()
        ref = dict(id='axis', part='shaft', kind='cylinder', point=[0, 0, 2], axis=[0, 0, 1], radius=5)
        resolve([dict(id='shaft', shape=cylinder)], ref)
        for shape in (cq.Workplane('XY').box(10, 10, 4).val(), cq.Compound.makeCompound([cylinder, cylinder.copy()]), cylinder.translate((10, 0, 0))):
            with self.assertRaises(ReferenceError): resolve([dict(id='shaft', shape=shape)], ref)
        ref['point'] = [10, 0, 2]
        resolve([dict(id='shaft', shape=cylinder.translate((10, 0, 0)))], ref)


if __name__ == '__main__': unittest.main()
