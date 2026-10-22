import copy,json,math,os,sys,time,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src/native/ondsel'))
from solver import solve,validate,verify,IDENTITY

def pose(x=0,y=0,z=0,angle=0):
 c,s=math.cos(math.radians(angle)),math.sin(math.radians(angle))
 return [c,s,0,0,-s,c,0,0,0,0,1,0,x,y,z,1]
def mate(id,a,b,pa,pb,type='revolute'):
 return {'id':id,'type':type,'a':{'body':a,'frame':pa},'b':{'body':b,'frame':pb}}
def fourbar():
 root=math.sqrt(2)*25
 return {'schema':1,'units':'mm-deg-s','bodies':[{'id':'ground','pose':pose(),'fixed':True},{'id':'crank','pose':pose(angle=45)},{'id':'coupler','pose':pose(root,root)},{'id':'rocker','pose':pose(100,angle=45)}],
 'mates':[mate('drive','ground','crank',pose(),pose()),mate('elbow','crank','coupler',pose(50),pose()),mate('end','coupler','rocker',pose(100),pose(50)),mate('base','ground','rocker',pose(100),pose())],
 'drives':[{'joint':'drive','position':45,'velocity':20}],'duration':1,'samplePeriod':.05}

class SolverContract(unittest.TestCase):
 def test_visual_binding_rejects_passive_or_nonangular_coordinates(self):
  r=fourbar();r['jointBindings']=[{'joint':'pulley','mate':'base'}]
  with self.assertRaisesRegex(ValueError,'explicitly driven'):validate(r)
  r['jointBindings']=[{'joint':'pulley','mate':'drive','scale':2}]
  with self.assertRaisesRegex(ValueError,'sign'):validate(r)
 @unittest.skipUnless(os.environ.get('CADCOVE_MATE_SOLVER'),'optional Ondsel binary not installed')
 def test_multistage_gear_and_belt_follow_one_driver(self):
  r={'schema':1,'units':'mm-deg-s',
   'bodies':[{'id':'ground','fixed':True,'pose':pose()},*[{'id':'b'+str(i),'pose':pose(i*60)} for i in range(3)]],
   'mates':[mate('j'+str(i),'ground','b'+str(i),pose(i*60),pose()) for i in range(3)],
   'drives':[{'joint':'j0','velocity':3600,'acceleration':-7200}],
   'couplings':[{'id':'gear','type':'gear','driver':'j0','follower':'j1','driverTeeth':20,'followerTeeth':40,'direction':-1},{'id':'belt','type':'belt','driver':'j1','follower':'j2','driverTeeth':36,'followerTeeth':18,'direction':1}],
   'jointBindings':[{'joint':'output','mate':'j2'}],'duration':1,'samplePeriod':.01}
  s=solve(r)
  for f in s['frames']:
   q=3600*f['time']-3600*f['time']**2
   self.assertAlmostEqual(f['angles']['output'],-q,places=6)
   self.assertAlmostEqual((f['coordinates']['j1']+q/2+180)%360-180,0,places=6)
  bad=copy.deepcopy(s);bad['frames'][25]['poses'][3]=pose(120,angle=12)
  with self.assertRaisesRegex(ValueError,'Coupling residual'):verify(r,bad)
  for mutate in [lambda r:r['drives'].append({'joint':'j1'}),lambda r:r['couplings'][0].update(driverTeeth=0),lambda r:r['couplings'][0].update(direction=0),lambda r:r['couplings'][0].update(driver='j2')]:
   q=copy.deepcopy(r);mutate(q)
   with self.assertRaises(ValueError):validate(q)
 @unittest.skipUnless(os.environ.get('CADCOVE_MATE_SOLVER'),'optional Ondsel binary not installed')
 def test_multiturn_reversing_pulleys_on_moving_carrier(self):
  r={'schema':1,'units':'mm-deg-s','sourceRevision':'belt-test',
   'bodies':[{'id':'ground','fixed':True,'pose':pose(),'parts':['world']},{'id':'carrier','pose':pose(),'parts':['belt']},{'id':'b0','pose':pose(angle=30),'parts':['p0']},{'id':'b1','pose':pose(50,angle=30),'parts':['p1']}],
   'mates':[mate('parent','ground','carrier',pose(),pose()),mate('pulley0','carrier','b0',pose(),pose()),mate('pulley1','carrier','b1',pose(50),pose())],
   'drives':[{'joint':'parent','velocity':30},{'joint':'pulley0','position':30,'velocity':3600,'acceleration':-7200}],
   'couplings':[{'id':'belt-drive','type':'belt','driver':'pulley0','follower':'pulley1','driverTeeth':26,'followerTeeth':26,'direction':1}],
   'jointBindings':[{'joint':'j0','mate':'pulley0','offsetDeg':-30}], 'duration':1,'samplePeriod':.01}
  s=solve(r)
  for f in s['frames']:
   t=f['time'];self.assertAlmostEqual(f['angles']['j0'],3600*t-3600*t*t,places=6)
  self.assertAlmostEqual(s['frames'][50]['angles']['j0'],900,places=6)
  reverse=copy.deepcopy(r);reverse['jointBindings'][0].update(scale=-1,offsetDeg=30)
  other=solve(reverse)
  self.assertAlmostEqual(other['frames'][50]['angles']['j0'],-900,places=6)
  if os.environ.get('CADCOVE_SOLVED_BELT_FIXTURE'):
   Path(os.environ['CADCOVE_SOLVED_BELT_FIXTURE']).write_text(json.dumps(s))
 def test_validation_rejects_unsupported_and_ambiguous_inputs(self):
  r=fourbar();validate(r)
  for mutate in [lambda r:r.update(units='m-rad'),lambda r:r['mates'][0].update(type='gear'),lambda r:r['bodies'][0].update(fixed=False),lambda r:r['mates'][0]['a'].update(body='unknown'),lambda r:r.update(contacts=[]),lambda r:r['drives'].append(r['drives'][0]),lambda r:r['bodies'][1]['pose'].__setitem__(0,2),lambda r:r.update(duration=.071)]:
   q=copy.deepcopy(r);mutate(q)
   with self.assertRaises(ValueError):validate(q)
 @unittest.skipUnless(os.environ.get('CADCOVE_MATE_SOLVER'),'optional Ondsel binary not installed')
 def test_fourbar_matches_independent_analytic_solution(self):
  r=fourbar();start=time.monotonic();s=solve(r)
  self.assertEqual(len(s['frames']),21)
  for f in s['frames']:
   theta=math.radians(45+20*f['time']);coupler=f['poses'][2]
   self.assertAlmostEqual(coupler[12],50*math.cos(theta),places=7)
   self.assertAlmostEqual(coupler[13],50*math.sin(theta),places=7)
   self.assertAlmostEqual(f['coordinates']['base'],45+20*f['time'],places=7)
  bad=copy.deepcopy(s);bad['frames'][10]['poses'][2][12]+=1
  with self.assertRaisesRegex(ValueError,'residual'):verify(r,bad)
  print('fourbar solve including process startup seconds:',time.monotonic()-start)
 @unittest.skipUnless(os.environ.get('CADCOVE_MATE_SOLVER'),'optional Ondsel binary not installed')
 def test_slider_with_acceleration_and_jerk(self):
  r={'schema':1,'units':'mm-deg-s','bodies':[{'id':'ground','pose':pose(),'fixed':True},{'id':'slide','pose':pose(z=5)}],'mates':[mate('s','ground','slide',pose(),pose(),type='slider')],'drives':[{'joint':'s','position':5,'velocity':2,'acceleration':4,'jerk':6}],'duration':1,'samplePeriod':.1}
  s=solve(r)
  self.assertAlmostEqual(s['frames'][-1]['poses'][1][14],10,places=7)
 @unittest.skipUnless(os.environ.get('CADCOVE_MATE_SOLVER'),'optional Ondsel binary not installed')
 def test_impossible_drive_fails_without_usable_output(self):
  r=fourbar();r['bodies'][1]['fixed']=True
  with self.assertRaises((RuntimeError,ValueError)):solve(r)
 @unittest.skipUnless(os.environ.get('CADCOVE_MATE_SOLVER'),'optional Ondsel binary not installed')
 def test_static_assembly(self):
  r=fourbar();r['duration']=0;r['drives'][0]['position']=60
  s=solve(r);self.assertEqual(len(s['frames']),1)
  self.assertAlmostEqual(s['frames'][0]['coordinates']['base'],60,places=6)

if __name__=='__main__':unittest.main()
