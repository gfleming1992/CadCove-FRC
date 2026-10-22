import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1] / 'src/native'))
import tempfile
import unittest
import cadquery as cq
from discovery import discover, review

class DiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.shaft=cq.Workplane('XY').circle(5).extrude(20).val()
        self.bearing=cq.Workplane('XY').circle(9).circle(5.1).extrude(5).val()
    def tearDown(self):
        self.tmp.cleanup()
    def run_scan(self, shift=0, radius=5):
        shaft=self.shaft if radius==5 else cq.Workplane('XY').circle(radius).extrude(20).val()
        return discover([dict(id='shaft',shape=shaft.moved(cq.Location(cq.Vector(shift,0,0)))),dict(id='bearing',shape=self.bearing)],cache_dir=self.tmp.name)
    def test_persistent_cache_and_stale_confirmation(self):
        first=self.run_scan()
        self.assertEqual(first['cache']['featureMisses'],2)
        self.assertEqual(len(first['candidates']),1)
        c=first['candidates'][0]
        decision=dict(candidateId=c['id'],evidenceHash=c['evidenceHash'],decision='confirm',jointType='revolute',evidenceIndex=0,reason='Bearing inner race carries shaft; fixture intent')
        self.assertEqual(review(first,[decision])['decisions'][0]['status'],'confirmed')
        second=self.run_scan()
        self.assertEqual(second['cache'],dict(featureHits=2,featureMisses=0,pairHits=1,pairMisses=0))
        moved=self.run_scan(shift=0.01)
        self.assertEqual(moved['cache']['featureMisses'],0)
        self.assertEqual(moved['cache']['pairMisses'],1)
        self.assertEqual(review(moved,[decision])['decisions'][0]['status'],'stale')
        changed=self.run_scan(radius=4.9)
        self.assertEqual(changed['cache']['featureMisses'],1)
        self.assertEqual(review(changed,[decision])['decisions'][0]['status'],'stale')
        self.assertFalse(review(first,[decision])['activatesMotion'])
    def test_noncoaxial_and_no_automatic_rigid_or_motion_claims(self):
        self.assertEqual(self.run_scan(shift=1)['candidates'],[])
        r=self.run_scan()
        self.assertFalse(r['collisionChecked'])
        self.assertEqual(r['candidates'][0]['status'],'proposed')
        self.assertIn('limits',r['candidates'][0]['unknowns'])
        with self.assertRaises(ValueError):
            discover([dict(id='a',shape=self.shaft)],ids=['missing'])
    def test_corrupt_cache_rebuilds(self):
        self.run_scan()
        for f in Path(self.tmp.name).glob('*.json'):
            f.write_text('{bad')
        r=self.run_scan()
        self.assertEqual(r['cache']['featureMisses'],2)
        self.assertEqual(len(r['candidates']),1)
    def test_rotation_and_duplicate_occurrences(self):
        loc=cq.Location(cq.Vector(42,10,0),cq.Vector(1,0,0),90)
        parts=[dict(id='a',shape=self.shaft.moved(loc)),dict(id='b',shape=self.bearing.moved(loc)),dict(id='far',shape=self.bearing.moved(cq.Location(cq.Vector(1000,0,0))))]
        r=discover(parts,cache_dir=self.tmp.name)
        self.assertEqual(r['cache']['featureMisses'],2)
        self.assertEqual(r['cache']['featureHits'],1)
        self.assertEqual(len(r['candidates']),1)
        self.assertAlmostEqual(abs(r['candidates'][0]['evidence'][0]['axis'][1]),1)
        with self.assertRaises(ValueError):
            discover(parts+parts)

if __name__=='__main__': unittest.main()
