"""Rapier backend for the existing mate request/playback contract.

Uses the solver-independent validation and residual contract. The animation
coordinate is prescribed; internal relaxation iterations are not physics time.
No mass, collisions, or motor behavior is inferred from assembly geometry.
"""
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import subprocess
import time


def contract(path):
    spec = importlib.util.spec_from_file_location('cadcove_mate_contract', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def quaternion_pose(m):
    # Column-major rigid frame -> translation and XYZW, without external deps.
    tr=m[0]+m[5]+m[10]
    if tr>0:
        s=math.sqrt(tr+1)*2
        q=[(m[6]-m[9])/s,(m[8]-m[2])/s,(m[1]-m[4])/s,s/4]
    elif m[0]>m[5] and m[0]>m[10]:
        s=math.sqrt(1+m[0]-m[5]-m[10])*2
        q=[s/4,(m[4]+m[1])/s,(m[8]+m[2])/s,(m[6]-m[9])/s]
    elif m[5]>m[10]:
        s=math.sqrt(1+m[5]-m[0]-m[10])*2
        q=[(m[4]+m[1])/s,s/4,(m[9]+m[6])/s,(m[8]-m[2])/s]
    else:
        s=math.sqrt(1+m[10]-m[0]-m[5])*2
        q=[(m[8]+m[2])/s,(m[9]+m[6])/s,s/4,(m[1]-m[4])/s]
    return m[12:15]+q


def encode(request, api):
    bodies,mates,drives,duration,dt=api.validate(request)
    ids={b['id']:i for i,b in enumerate(bodies)}
    by_id={b['id']:b['pose'] for b in bodies}
    bind={}
    for m in mates:
        rel=api.mul(api.inverse(api.mul(by_id[m['a']['body']],m['a']['frame'])),api.mul(by_id[m['b']['body']],m['b']['frame']))
        bind[m['id']]=math.degrees(math.atan2(rel[1],rel[0]))
    samples=[]
    for i in range(round(duration/dt)+1):
        t=i*dt
        targets={d['joint']:d.get('position',0)+d.get('velocity',0)*t+d.get('acceleration',0)*t*t/2+d.get('jerk',0)*t*t*t/6 for d in drives}
        pending=list(request.get('couplings',[]))
        # Supported couplings are driven acyclic chains. Preserve authored phase
        # and continuous turns; never estimate a ratio from rendered geometry.
        while pending:
            ready=[c for c in pending if c['driver'] in targets]
            if not ready: raise ValueError('Unresolved coupling')
            for c in ready:
                targets[c['follower']]=bind[c['follower']]+c['direction']*c['driverTeeth']/c['followerTeeth']*(targets[c['driver']]-bind[c['driver']])
                pending.remove(c)
        samples.append({'time':t,'targets':[None if m['id'] not in targets else (math.radians((targets[m['id']]+180)%360-180) if m['type']=='revolute' else targets[m['id']]) for m in mates]})
    return {'bodies':[{'pose':quaternion_pose(b['pose']),'fixed':b.get('fixed',False)} for b in bodies],
        'mates':[{'a':ids[m['a']['body']],'b':ids[m['b']['body']],'kind':m['type'],'frame_a':quaternion_pose(m['a']['frame']),'frame_b':quaternion_pose(m['b']['frame'])} for m in mates], 'samples':samples}


def solve(request, executable, api, timeout=60):
    payload=encode(request,api)
    start=time.perf_counter()
    def run():
        remaining=timeout-(time.perf_counter()-start)
        if remaining<=0: raise TimeoutError('Rapier mate solve exceeded time budget')
        proc=subprocess.run([str(Path(executable).resolve())],input=json.dumps({'op':'solve_mates','request':payload})+'\n',text=True,capture_output=True,timeout=remaining)
        if proc.returncode: raise RuntimeError('Rapier mate process failed: '+proc.stderr[-2000:])
        value=json.loads(proc.stdout)
        if not value.get('ok'): raise RuntimeError(value.get('error','Rapier mate solve failed'))
        return value
    result=run()
    try:
        checks=api.verify(request,result)
    except ValueError as error:
        if result['diagnostics']['mode']!='Rapier multibody forward kinematics': raise
        # f32 forward propagation can exceed the CAD tolerance on long/large
        # chains. Retry Rapier constraints, never change tolerance or switch backends
        # invisibly. Both attempts count toward end-to-end timing.
        retry={'reason':str(error),'firstAttempt':result['diagnostics']}
        payload['relax']=True
        result=run()
        checks=api.verify(request,result)
        result['diagnostics']['refinement']=retry
    result['diagnostics']['processMs']=(time.perf_counter()-start)*1000
    result.update(schema=1,solver={'name':'Rapier','version':'0.36.0','experimental':True},units='mm-deg-s',checks=checks,
        executableSha256=hashlib.sha256(Path(executable).read_bytes()).hexdigest(),
        requestHash=hashlib.sha256(json.dumps(request,sort_keys=True,separators=(',',':')).encode()).hexdigest(),
        sourceRevision=request.get('sourceRevision'),bodies=request['bodies'],mates=request['mates'],
        couplings=request.get('couplings',[]),jointBindings=request.get('jointBindings',[]))
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    for key in ('input','output','solver','contract'): parser.add_argument('--'+key,required=True)
    args=parser.parse_args()
    try:
        if Path(args.output).exists(): raise FileExistsError('File exists: '+args.output)
        result=solve(json.loads(Path(args.input).read_text()),args.solver,contract(args.contract))
        with open(args.output,'x') as out: json.dump(result,out,allow_nan=False)
        print(json.dumps({'ok':True,'solver':'Rapier','output':args.output,'frames':len(result['frames']),'checks':result['checks'],'diagnostics':result['diagnostics']}))
    except Exception as error:
        print(json.dumps({'ok':False,'error':str(error)}));raise SystemExit(1)
