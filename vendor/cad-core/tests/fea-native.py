import copy,json,os,subprocess,sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src/native'))
import cadquery as cq
from cad_references import fingerprint,resolve,ReferenceError
from fea_geometry import export_analysis, prepare_geometry

def fixture():
    shape=cq.Workplane('XY').box(100,10,10,centered=(False,False,False)).val()
    request=dict(analysis=dict(schema=1,analysis='linearStatic',units='mm-N-MPa',parts=[dict(id='beam',shapeHash=fingerprint(shape),material=dict(name='synthetic steel',source='analytical test fixture only',youngsModulusMPa=210000,poissonRatio=.3))],supports=[dict(id='support',part='beam',reference='mount',source='fixture',restrainedTranslations=[True]*3)],loads=[dict(id='pull',part='beam',reference='end',source='fixture',forceN=[1000,0,0])],outputs=['displacement'],assumptions=['Synthetic axial benchmark']),references=[dict(id='mount',part='beam',kind='plane',point=[0,5,5],axis=[-1,0,0]),dict(id='end',part='beam',kind='plane',point=[100,5,5],axis=[1,0,0])],mesh=dict(sizesMm=[5,3],relativeTolerance=.01))
    return [dict(id='beam',shape=shape)],request

class FeaTests(unittest.TestCase):
    def test_preparation_pins_geometry_without_inventing_physical_facts(self):
        parts, fixture_request = fixture()
        request = dict(schema=1, analysis='linearStatic', units='mm-N-MPa', parts=[dict(id='beam')], outputs=['displacement'])
        review = prepare_geometry(parts, request)
        self.assertNotIn('shapeHash', request['parts'][0])
        self.assertEqual(review['request']['parts'][0]['shapeHash'], fingerprint(parts[0]['shape']))
        self.assertNotIn('material', review['request']['parts'][0])
        self.assertFalse(review['inputComplete'])
        self.assertIn('loads', [q['field'] for q in review['questions']])
        self.assertAlmostEqual(review['geometry'][0]['volumeMm3'], 10000)
        bad=copy.deepcopy(request);bad['parts'][0]['shapeHash']='a'*64
        with self.assertRaisesRegex(ValueError,'Stale'):prepare_geometry(parts,bad)
        bad=copy.deepcopy(request);bad['parts'][0]['id']='missing'
        with self.assertRaisesRegex(ValueError,'Missing'):prepare_geometry(parts,bad)

    def test_geometry_and_boundaries_fail_closed(self):
        parts,request=fixture()
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)/'job'
            bad=copy.deepcopy(request);bad['analysis']['parts'][0]['shapeHash']='a'*64
            with self.assertRaisesRegex(ValueError,'Stale'):export_analysis(parts,bad,root)
            self.assertFalse(root.exists())
            bad=copy.deepcopy(request);bad['references'][0]['point'][1]+=1
            with self.assertRaisesRegex(ReferenceError,'missing'):export_analysis(parts,bad,root)
            bad=copy.deepcopy(request);bad['analysis']['supports'][0]['restrainedTranslations']=[True,False,False]
            with self.assertRaisesRegex(ValueError,'fully fixed'):export_analysis(parts,bad,root)
            export_analysis(parts,request,root)
            with self.assertRaises(FileExistsError):export_analysis(parts,request,root)
    @unittest.skipUnless(all(os.environ.get(k) for k in ('CADCOVE_FREECAD','CADCOVE_GMSH','CADCOVE_CCX')),'Optional FEA binaries not configured')
    def test_actual_meshing_solve_and_analytical_displacement(self):
        parts,request=fixture()
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)/'job';export_analysis(parts,request,root)
            env=dict(os.environ,CADCOVE_FEA_JOB=str(root))
            backend=Path(__file__).resolve().parents[1]/'src/native/fea_freecad.py'
            p=subprocess.run([env['CADCOVE_FREECAD'],'-u',str(root/'user.cfg'),'-s',str(root/'system.cfg'),str(backend)],env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=300)
            self.assertEqual(p.returncode,0,p.stdout.decode()[-3000:])
            r=json.loads((root/'result.json').read_text());self.assertTrue(r['ok'],r)
            self.assertTrue(r['convergence']['passed']);self.assertFalse(r['engineeringValidated'])
            expected=1000*100/(100*210000)
            self.assertLess(abs(r['runs'][-1]['maxDisplacementMm']/expected-1),.01)
            self.assertTrue((root/'mesh-1/nodal-results.json').is_file())
            # An orthogonal load catches silently ignored/reoriented force vectors.
            request['analysis']['loads'][0]['forceN']=[0,0,-100]
            request['mesh']['sizesMm']=[3,2]
            root=Path(temp)/'bending';export_analysis(parts,request,root)
            env['CADCOVE_FEA_JOB']=str(root)
            p=subprocess.run([env['CADCOVE_FREECAD'],'-u',str(root/'user.cfg'),'-s',str(root/'system.cfg'),str(backend)],env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=300)
            self.assertEqual(p.returncode,0,p.stdout.decode()[-3000:])
            r=json.loads((root/'result.json').read_text());self.assertTrue(r['ok'],r)
            expected=100*100**3/(3*210000*(10*10**3/12))
            self.assertLess(abs(r['runs'][-1]['maxDisplacementMm']/expected-1),.03)
            self.assertTrue(r['convergence']['passed'])

if __name__=='__main__':unittest.main()
