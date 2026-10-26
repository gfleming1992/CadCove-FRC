"""Shared-request accuracy tests and opt-in paired backend benchmark."""
import argparse
import copy
import importlib.util
import json
import math
import os
from pathlib import Path
import statistics
import time
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('rapier_mates',ROOT/'lib/rapier-mates.py')
rapier=importlib.util.module_from_spec(spec);spec.loader.exec_module(rapier)
api=rapier.contract(ROOT/'vendor/cad-core/src/native/mate_contract.py')
BINARY=os.environ.get('CADCOVE_RAPIER_MATE_SOLVER')

def pose(x=0,y=0,z=0,angle=0):
    c,s=math.cos(math.radians(angle)),math.sin(math.radians(angle))
    return [c,s,0,0,-s,c,0,0,0,0,1,0,x,y,z,1]
def mate(id,a,b,fa=None,fb=None,kind='revolute'):
    return dict(id=id,type=kind,a=dict(body=a,frame=fa or pose()),b=dict(body=b,frame=fb or pose()))
def body(id,p=None,fixed=False):
    return dict(id=id,pose=p or pose(),fixed=fixed,parts=[id])
def request(bodies,mates,drives,duration=1,dt=.02,**extra):
    return dict(schema=1,units='mm-deg-s',sourceRevision='synthetic-benchmark',bodies=bodies,mates=mates,drives=drives,duration=duration,samplePeriod=dt,**extra)
def fixtures():
    r=math.sqrt(2)*25
    fourbar=request([body('g',fixed=True),body('crank',pose(angle=45)),body('coupler',pose(r,r)),body('rocker',pose(100,angle=45))],
        [mate('drive','g','crank'),mate('elbow','crank','coupler',pose(50)),mate('end','coupler','rocker',pose(100),pose(50)),mate('base','g','rocker',pose(100))],
        [dict(joint='drive',position=45,velocity=20)])
    static=copy.deepcopy(fourbar);static['duration']=0;static['drives'][0]['position']=60
    carrier=request([body('g',fixed=True),body('carrier'),body('a',pose(angle=30)),body('b',pose(60,angle=30)),body('c',pose(120,angle=30))],
        [mate('steer','g','carrier'),mate('a','carrier','a'),mate('b','carrier','b',pose(60)),mate('c','carrier','c',pose(120))],
        [dict(joint='steer',velocity=45),dict(joint='a',position=30,velocity=3600,acceleration=-7200)],
        couplings=[dict(id='gear',type='gear',driver='a',follower='b',driverTeeth=20,followerTeeth=40,direction=-1),dict(id='belt',type='belt',driver='b',follower='c',driverTeeth=36,followerTeeth=18,direction=1)],
        jointBindings=[dict(joint='pulley',mate='a',offsetDeg=-30),dict(joint='lower',mate='c')])
    # Non-coplanar wheel axle: local mate Z is mapped to world X.
    axle=[0,0,-1,0,0,1,0,0,1,0,0,0,0,0,0,1]
    swerve=request([body('g',fixed=True),body('module'),body('wheel')],
        [mate('steer','g','module'),mate('wheel','module','wheel',axle,axle)],
        [dict(joint='steer',velocity=90),dict(joint='wheel',velocity=720,acceleration=360)])
    fixed=request([body('g',pose(100,20,30,15),True),body('plate')],
        [mate('fixed','g','plate',pose(25,10))],[],duration=0)
    slider=request([body('g',fixed=True),body('slide',pose(z=5))],[mate('s','g','slide',kind='slider')],
        [dict(joint='s',position=5,velocity=2,acceleration=4,jerk=6)])
    return dict(fixed=fixed,slider=slider,fourbar=fourbar,static_assembly=static,gears_belts_carrier=carrier,swerve=swerve)

@unittest.skipUnless(BINARY,'set CADCOVE_RAPIER_MATE_SOLVER to native binary')
class RapierContract(unittest.TestCase):
    def test_shared_mate_contract_and_analytic_positions(self):
        for name,r in fixtures().items():
            with self.subTest(name=name):
                out=rapier.solve(r,BINARY,api)
                self.assertEqual(out['sourceRevision'],r['sourceRevision'])
                self.assertLessEqual(out['checks']['maxPositionResidualMm'],1e-4)
                self.assertFalse(out['checks']['collisionChecked'])
                if name=='slider': self.assertAlmostEqual(out['frames'][-1]['poses'][1][14],10,delta=1e-4)
                if name=='fourbar':
                    for f in out['frames']:
                        a=math.radians(45+20*f['time'])
                        self.assertAlmostEqual(f['poses'][2][12],50*math.cos(a),delta=1e-4)
                        self.assertAlmostEqual(f['poses'][2][13],50*math.sin(a),delta=1e-4)
                if name=='gears_belts_carrier':
                    self.assertAlmostEqual(out['frames'][25]['angles']['pulley'],900,delta=1e-3)
                    self.assertAlmostEqual(out['frames'][-1]['angles']['pulley'],0,delta=1e-3)
    def test_impossible_drive_and_conflicting_coupling_fail(self):
        r=fixtures()['fourbar'];r['bodies'][1]['fixed']=True
        with self.assertRaises((ValueError,RuntimeError)):rapier.solve(r,BINARY,api)
        r=fixtures()['gears_belts_carrier'];r['drives'].append(dict(joint='b'))
        with self.assertRaises(ValueError):rapier.solve(r,BINARY,api)
    def test_perturbed_output_is_rejected(self):
        r=fixtures()['fourbar'];out=rapier.solve(r,BINARY,api)
        out['frames'][10]['poses'][2][12]+=.01
        with self.assertRaises(ValueError):api.verify(r,out)

if __name__=='__main__': unittest.main()
