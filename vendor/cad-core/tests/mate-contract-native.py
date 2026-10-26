import copy,json,math,os,sys,time,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src/native'))
from mate_contract import validate,verify,IDENTITY

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

if __name__=='__main__':unittest.main()
