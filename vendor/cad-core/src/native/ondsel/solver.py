"""Headless Ondsel adapter. Public input uses mm, degrees, seconds and local mate frames.

This is a solver request, not a replacement CAD/mechanism persistence format.
Geometry and meshes never cross this boundary. Only explicit authored/reviewed mates do.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile

IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
TYPES = {"fixed": 0, "revolute": 1, "slider": 2}

def mul(a, b):
    return [sum(a[k * 4 + r] * b[c * 4 + k] for k in range(4)) for c in range(4) for r in range(4)]

def inverse(m):
    r = [m[(i % 4) * 4 + i // 4] if i % 4 < 3 and i // 4 < 3 else IDENTITY[i] for i in range(16)]
    r[12:15] = [-sum(r[k * 4 + row] * m[12 + k] for k in range(3)) for row in range(3)]
    return r

def finite(v):
    return isinstance(v, (float, int)) and not isinstance(v, bool) and math.isfinite(v)

def frame(m):
    if not isinstance(m, list) or len(m) != 16 or not all(finite(x) for x in m):
        raise ValueError("A frame must contain 16 finite column-major values")
    if any(abs(m[i] - IDENTITY[i]) > 1e-9 for i in (3, 7, 11, 15)):
        raise ValueError("Invalid affine frame")
    product = mul(inverse(m), m)
    det = m[0]*(m[5]*m[10]-m[9]*m[6])-m[4]*(m[1]*m[10]-m[9]*m[2])+m[8]*(m[1]*m[6]-m[5]*m[2])
    if max(abs(x-y) for x, y in zip(product, IDENTITY)) > 1e-7 or abs(det-1)>1e-7:
        raise ValueError("Frames must be rigid right-handed transforms, without scale")
    return m

def fields(obj, allowed):
    if not isinstance(obj, dict) or set(obj)-set(allowed):
        raise ValueError("Unsupported fields: " + str(set(obj)-set(allowed) if isinstance(obj, dict) else obj))

def validate(request):
    fields(request, ('schema', 'units', 'bodies', 'mates', 'drives', 'duration', 'samplePeriod', 'sourceRevision', 'jointBindings', 'couplings'))
    if request.get('schema') != 1 or request.get('units') != 'mm-deg-s':
        raise ValueError('Expected schema 1 and units mm-deg-s')
    bodies, mates, drives = request['bodies'], request['mates'], request.get('drives', [])
    if not 1 <= len(bodies) <= 512 or not 1 <= len(mates) <= 2048 or len(drives)>128:
        raise ValueError('Request exceeds body/mate/driver budget')
    body_ids, mate_ids, parts = set(), set(), set()
    for b in bodies:
        fields(b, ('id','pose','bindPose','fixed','parts'))
        if not isinstance(b['id'],str) or not b['id'] or b['id'] in body_ids: raise ValueError('Duplicate/invalid body ID')
        body_ids.add(b['id']);frame(b['pose'])
        if 'bindPose' in b: frame(b['bindPose'])
        if type(b.get('fixed',False)) is not bool: raise ValueError('fixed must be boolean')
        if not isinstance(b.get('parts',[]),list): raise ValueError('parts must be an array')
        for part in b.get('parts',[]):
            if not isinstance(part,str) or not part or part in parts: raise ValueError('Duplicate/invalid occurrence binding')
            parts.add(part)
    grounded={b['id'] for b in bodies if b.get('fixed')}
    if not grounded: raise ValueError('At least one body must be grounded')
    for m in mates:
        fields(m, ('id','type','a','b'))
        if not isinstance(m['id'],str) or not m['id'] or m['id'] in mate_ids: raise ValueError('Duplicate/invalid mate ID')
        mate_ids.add(m['id'])
        if m['type'] not in TYPES: raise ValueError('Unsupported mate type: '+m['type'])
        for end in (m['a'],m['b']):
            fields(end, ('body','frame'))
            if end['body'] not in body_ids: raise ValueError('Unknown mate body')
            frame(end['frame'])
        if m['a']['body']==m['b']['body']: raise ValueError('Self mate')
    reached=set(grounded)
    while True:
        expanded = reached | {e['body'] for m in mates if m['a']['body'] in reached or m['b']['body'] in reached for e in (m['a'],m['b'])}
        if expanded==reached: break
        reached=expanded
    if reached!=body_ids: raise ValueError('Disconnected ungrounded bodies')
    driven=set()
    for d in drives:
        fields(d, ('joint','position','velocity','acceleration','jerk'))
        if d['joint'] not in mate_ids or d['joint'] in driven: raise ValueError('Unknown/duplicate drive')
        if next(m['type'] for m in mates if m['id']==d['joint'])=='fixed': raise ValueError('Cannot drive fixed mate')
        driven.add(d['joint'])
        for key in ('position','velocity','acceleration','jerk'):
            if not finite(d.get(key,0)): raise ValueError('Nonfinite drive')
    couplings=request.get('couplings',[])
    if not isinstance(couplings,list) or len(couplings)>128: raise ValueError('Invalid couplings')
    followers=set();coupling_ids=set();by_id={m['id']:m for m in mates}
    for c in couplings:
        fields(c, ('id','type','driver','follower','driverTeeth','followerTeeth','direction'))
        if not isinstance(c.get('id'),str) or not c['id'] or c['id'] in coupling_ids: raise ValueError('Invalid coupling ID')
        coupling_ids.add(c['id'])
        if c.get('type') not in ('gear','belt','chain'): raise ValueError('Unsupported coupling type')
        if any(type(c.get(k)) is not int or not 1<=c[k]<=100000 for k in ('driverTeeth','followerTeeth')) or type(c.get('direction')) is not int or c['direction'] not in (-1,1): raise ValueError('Coupling requires tooth counts and explicit direction')
        d,f=by_id.get(c.get('driver')),by_id.get(c.get('follower'))
        if not d or not f or d['type']!='revolute' or f['type']!='revolute' or d['id']==f['id']: raise ValueError('Coupling requires distinct revolute mates')
        if f['id'] in followers or f['id'] in driven: raise ValueError('Conflicting coupling follower/drive')
        followers.add(f['id'])
        if d['a']['body']!=f['a']['body'] or d['b']['body']==f['b']['body'] or max(abs(d['a']['frame'][i]-f['a']['frame'][i]) for i in (8,9,10))>1e-7:
            raise ValueError('Coupled axes must be parallel, equally oriented and share a carrier')
    reachable=set(driven)
    while True:
        expanded=reachable|{c['follower'] for c in couplings if c['driver'] in reachable}
        if expanded==reachable:break
        reachable=expanded
    if not followers<=reachable: raise ValueError('Couplings must form driven acyclic chains')
    bindings=request.get('jointBindings',[])
    if not isinstance(bindings,list) or len(bindings)>128: raise ValueError('Invalid joint bindings')
    bound=set()
    for binding in bindings:
        fields(binding, ('joint','mate','scale','offsetDeg'))
        joint=binding.get('joint');mate=binding.get('mate')
        if not isinstance(joint,str) or not joint or joint in bound: raise ValueError('Invalid/duplicate visual joint binding')
        bound.add(joint)
        if mate not in reachable or next(m['type'] for m in mates if m['id']==mate)!='revolute':
            raise ValueError('Visual joint binding requires an explicitly driven or coupled revolute mate; passive turn counts are ambiguous')
        if type(binding.get('scale',1)) not in (int,float) or binding.get('scale',1) not in (-1,1) or not finite(binding.get('offsetDeg',0)):
            raise ValueError('Visual joint binding requires sign +/-1 and finite offsetDeg')
    duration, dt=request.get('duration',0),request.get('samplePeriod',.04)
    if not finite(duration) or not finite(dt) or not 0<=duration<=300 or not 0<dt<=1 or duration/dt>10000:
        raise ValueError('Invalid timing budget')
    if len(bodies)*(duration/dt+1)>100000: raise ValueError('Solver pose budget exceeded')
    if request.get('sourceRevision') is not None and (not isinstance(request['sourceRevision'],str) or not request['sourceRevision']): raise ValueError('Invalid source revision')
    if duration and abs(duration/dt-round(duration/dt))>1e-7: raise ValueError('Duration must be an integer multiple of samplePeriod')
    return bodies,mates,drives,duration,dt

def encode(request):
    bodies,mates,drives,duration,dt=validate(request)
    ids={b['id']:i for i,b in enumerate(bodies)}
    def pose(m): return [m[i] for i in (12,13,14,0,4,8,1,5,9,2,6,10)]
    data=[2,len(bodies),len(mates),len(drives),len(request.get('couplings',[])),duration,dt]
    for b in bodies: data += [int(b.get('fixed',False)), *pose(b['pose'])]
    for m in mates: data += [TYPES[m['type']],ids[m['a']['body']],ids[m['b']['body']],*pose(m['a']['frame']),*pose(m['b']['frame'])]
    for c in request.get('couplings',[]):
        data += [next(i for i,m in enumerate(mates) if m['id']==c['driver']),next(i for i,m in enumerate(mates) if m['id']==c['follower']),c['driverTeeth'],-c['direction']*c['followerTeeth']]
    for d in drives:
        i=next(i for i,m in enumerate(mates) if m['id']==d['joint'])
        factor=math.pi/180 if mates[i]['type']=='revolute' else 1
        data += [i,*[d.get(key,0)*factor for key in ('position','velocity','acceleration','jerk')]]
    return ' '.join(str(x) for x in data)+'\n'

def verify(request, result):
    """Independent residual check; never trust successful process exit alone."""
    bodies,mates,drives,duration,dt=validate(request)
    frames=result['frames']
    if not frames or abs(frames[0]['time'])>1e-8 or abs(frames[-1]['time']-duration)>1e-6: raise ValueError('Incomplete solver trajectory')
    max_pos=max_rot=0.
    previous=-1
    initial={b['id']:b['pose'] for b in bodies}
    bind={}
    for m in mates:
        a=mul(initial[m['a']['body']],m['a']['frame']);b=mul(initial[m['b']['body']],m['b']['frame'])
        rel=mul(inverse(a),b);bind[m['id']]=math.degrees(math.atan2(rel[1],rel[0]))
    for sample in frames:
        t=sample['time']
        if not finite(t) or t<=previous or len(sample['poses'])!=len(bodies): raise ValueError('Invalid solver frame')
        if previous>=0 and t-previous>dt*1.01: raise ValueError('Missing solver frames')
        previous=t
        poses={b['id']:frame(p) for b,p in zip(bodies,sample['poses'])}
        for b in bodies:
            if b.get('fixed') and max(abs(x-y) for x,y in zip(poses[b['id']],b['pose']))>1e-5: raise ValueError('Ground body moved')
        coordinates={}
        for m in mates:
            a=mul(poses[m['a']['body']],m['a']['frame']);b=mul(poses[m['b']['body']],m['b']['frame']);rel=mul(inverse(a),b)
            pos=max(abs(rel[i]) for i in ((12,13) if m['type']=='slider' else (12,13,14)))
            rot=max(abs(rel[i]-IDENTITY[i]) for i in ((2,6,8,9,10) if m['type']=='revolute' else (0,1,2,4,5,6,8,9,10)))
            max_pos,max_rot=max(max_pos,pos),max(max_rot,rot)
            if pos>1e-4 or rot>1e-5: raise ValueError('Mate residual exceeds tolerance: '+m['id'])
            coordinates[m['id']]=math.atan2(rel[1],rel[0])*180/math.pi if m['type']=='revolute' else rel[14]
        continuous={}
        for d in drives:
            expected=d.get('position',0)+d.get('velocity',0)*t+d.get('acceleration',0)*t*t/2+d.get('jerk',0)*t*t*t/6
            error=coordinates[d['joint']]-expected
            if next(m['type'] for m in mates if m['id']==d['joint'])=='revolute': error=(error+180)%360-180
            if abs(error)>1e-3: raise ValueError('Driver residual exceeds tolerance: '+d['joint'])
            # Select the full-turn branch using the prescribed drive, but retain
            # the measured solver residual. Never unwrap from rendering history.
            continuous[d['joint']]=expected+error
        pending=list(request.get('couplings',[]))
        while pending:
            ready=[c for c in pending if c['driver'] in continuous]
            if not ready: raise ValueError('Unresolved coupling coordinates')
            for c in ready:
                expected=bind[c['follower']]+c['direction']*c['driverTeeth']/c['followerTeeth']*(continuous[c['driver']]-bind[c['driver']])
                error=(coordinates[c['follower']]-expected+180)%360-180
                if abs(error)>1e-3: raise ValueError('Coupling residual exceeds tolerance: '+c['id'])
                continuous[c['follower']]=expected+error;pending.remove(c)
        sample['coordinates']=coordinates
        sample['angles']={b['joint']:continuous[b['mate']]*b.get('scale',1)+b.get('offsetDeg',0) for b in request.get('jointBindings',[])}
    return {'maxPositionResidualMm':max_pos,'maxRotationMatrixResidual':max_rot,'collisionChecked':False,'mobilityCertified':False}

def solve(request, executable=None, timeout=60, pin_file=None):
    payload=encode(request)
    executable=executable or os.environ.get('CADCOVE_MATE_SOLVER')
    if not executable: raise ValueError('Set CADCOVE_MATE_SOLVER to the built cadcove-ondsel executable')
    with tempfile.TemporaryDirectory(prefix='cadcove-mates-') as work:
        output=Path(work)/'result.json'
        # Isolate native failures and incidental solver files from CAD sources.
        with open(Path(work)/'diagnostics.log','w+b') as log:
            proc=subprocess.run([str(Path(executable).resolve()),str(output)],input=payload.encode(),stdout=log,stderr=log,cwd=work,timeout=timeout)
            log.seek(0,2);size=log.tell();log.seek(max(0,size-8000));diagnostics=log.read().decode(errors='replace')
        if proc.returncode or not output.exists(): raise RuntimeError('Ondsel solve failed: '+diagnostics)
        if output.stat().st_size>128*1024*1024: raise ValueError('Solver result exceeds budget')
        result=json.loads(output.read_text())
    checks=verify(request,result)
    result.update(schema=1,solver=json.loads(Path(pin_file or Path(__file__).with_name('upstream.json')).read_text()),units='mm-deg-s',checks=checks,executableSha256=hashlib.sha256(Path(executable).read_bytes()).hexdigest(),requestHash=hashlib.sha256(json.dumps(request,sort_keys=True,separators=(',',':')).encode()).hexdigest(),sourceRevision=request.get('sourceRevision'),bodies=request['bodies'])
    result['jointBindings']=request.get('jointBindings',[])
    result['mates']=request['mates']
    result['couplings']=request.get('couplings',[])
    return result

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--input',required=True);parser.add_argument('--output',required=True);parser.add_argument('--solver');parser.add_argument('--pin');args=parser.parse_args()
    try:
        request=json.loads(Path(args.input).read_text());result=solve(request,args.solver,pin_file=args.pin)
        with open(args.output,'x') as out: json.dump(result,out,allow_nan=False)
        print(json.dumps({'ok':True,'output':args.output,'frames':len(result['frames']),'checks':result['checks']}))
    except Exception as error:
        print(json.dumps({'ok':False,'error':str(error)}));raise SystemExit(1)
