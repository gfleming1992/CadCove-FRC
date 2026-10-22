"""Evidence-only assembly discovery. No inferred connection commands motion.

Public API accepts the same occurrence records as native inspection. Cached
analytic features are independent of tessellation and reviewed intent.
"""
import hashlib
import io
import json
import math
import os
import re
from pathlib import Path
import tempfile
import cadquery as cq
import OCP
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepTools import BRepTools
from OCP.BRep import BRep_Builder
from OCP.TopoDS import TopoDS_Shape
from OCP.Bnd import Bnd_Box
from OCP.GeomAbs import GeomAbs_Cylinder
from OCP.TopTools import TopTools_FormatVersion_VERSION_1

VERSION = hashlib.sha256(Path(__file__).read_bytes()).hexdigest() + '/' + OCP.__version__

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()

def dot(a, b):
    return sum(x*y for x, y in zip(a, b))

def sub(a, b):
    return [x-y for x, y in zip(a, b)]

def canonical(axis):
    axis = list(axis)
    if next((x for x in axis if abs(x) > 1e-10), 1) < 0:
        axis = [-x for x in axis]
    return axis

def bounds(shape):
    box = Bnd_Box()
    BRepBndLib.AddOptimal_s(shape.wrapped, box, False, False)
    v = list(box.Get())
    return [v[:3], v[3:]]

def corners(box):
    return [[x,y,z] for x in (box[0][0],box[1][0]) for y in (box[0][1],box[1][1]) for z in (box[0][2],box[1][2])]

def matrix(location):
    tr = location.wrapped.Transformation()
    return [[tr.Value(i,j) for j in range(1,5)] for i in range(1,4)]

def transform(m, p, direction=False):
    return [dot(row[:3], p) + (0 if direction else row[3]) for row in m]

class Cache:
    def __init__(self, directory):
        self.directory = Path(directory) if directory else None
        self.memory = {}
        self.stats = dict(featureHits=0, featureMisses=0, pairHits=0, pairMisses=0)
        if self.directory:
            self.directory.mkdir(parents=True, exist_ok=True)

    def get(self, kind, key, compute):
        key = digest([VERSION, kind, key])
        value = self.memory.get(key)
        file = self.directory / (key + '.json') if self.directory else None
        if value is None and file:
            try:
                if file.stat().st_size > 16*1024*1024:
                    raise ValueError('oversized cache')
                record = json.loads(file.read_text())
                if record['key'] == key and digest(record['value']) == record['sha256']:
                    value = record['value']
            except (OSError, ValueError, KeyError, TypeError):
                pass
        self.stats[kind + ('Hits' if value is not None else 'Misses')] += 1
        if value is None:
            value = compute()
            if file:
                temp = None
                try:
                    with tempfile.NamedTemporaryFile(mode='w', dir=self.directory, delete=False) as stream:
                        temp = stream.name
                        json.dump(dict(key=key, value=value, sha256=digest(value)), stream, allow_nan=False)
                    os.replace(temp, file)
                finally:
                    if temp and os.path.exists(temp):
                        os.unlink(temp)
        self.memory[key] = value
        return value

def features(shape):
    cylinders = []
    for index, face in enumerate(shape.Faces()):
        surface = BRepAdaptor_Surface(face.wrapped)
        if surface.GetType() != GeomAbs_Cylinder:
            continue
        c = surface.Cylinder()
        axis = canonical(c.Axis().Direction().Coord())
        p = list(c.Location().Coord())
        origin = [p[i] - dot(p, axis)*axis[i] for i in range(3)]
        cylinders.append(dict(face=index, axis=axis, origin=origin, radiusMm=c.Radius(), bounds=bounds(face)))
    return dict(bounds=bounds(shape), cylinders=cylinders)

def occurrence(part, cache):
    shape = part['shape']
    if isinstance(shape, cq.Workplane):
        shape = shape.val()
    if not isinstance(shape, cq.Shape):
        raise ValueError('Discovery requires exact CadQuery shapes')
    # Top-level occurrence placement is removable; transforms baked into the
    # underlying geometry conservatively produce a different fingerprint.
    local = shape.located(cq.Location())
    stream = io.BytesIO()
    BRepTools.Write_s(local.wrapped, stream, False, False, TopTools_FormatVersion_VERSION_1)
    # OCCT's first read normalizes checked flags and may change signed zeros.
    # Canonicalize a throwaway BREP; retain the actual shape for measurements.
    normalized = TopoDS_Shape()
    BRepTools.Read_s(normalized, io.BytesIO(stream.getvalue()), BRep_Builder())
    canonical_stream = io.BytesIO()
    BRepTools.Write_s(normalized, canonical_stream, False, False, TopTools_FormatVersion_VERSION_1)
    content = re.sub(rb'(?<!\S)-0(?=\s)', b'0', canonical_stream.getvalue())
    key = hashlib.sha256(content).hexdigest()
    f = cache.get('feature', key, lambda: features(local))
    m = matrix(shape.location())
    vertices = [transform(m, p) for p in corners(f['bounds'])]
    box = [[min(p[i] for p in vertices) for i in range(3)], [max(p[i] for p in vertices) for i in range(3)]]
    cylinders = []
    for c in f['cylinders']:
        a = canonical(transform(m, c['axis'], True))
        p = transform(m, c['origin'])
        origin = [p[i]-dot(p,a)*a[i] for i in range(3)]
        extent = [dot(transform(m, p), a) for p in corners(c['bounds'])]
        cylinders.append(dict(face=c['face'], axis=a, origin=origin, radiusMm=c['radiusMm'], spanMm=[min(extent),max(extent)]))
    return dict(id=part['id'], geometryHash=key, placement=m, bounds=box, cylinders=cylinders)

def compare(a, b, tolerance, gap):
    matches = []
    for x in a['cylinders']:
        for y in b['cylinders']:
            alignment = dot(x['axis'], y['axis'])
            if abs(alignment) < 1-1e-10:
                continue
            delta = sub(y['origin'], x['origin'])
            offset = math.sqrt(max(0, dot(delta,delta)-dot(delta,x['axis'])**2))
            span = y['spanMm'] if alignment >= 0 else [-y['spanMm'][1],-y['spanMm'][0]]
            separation = max(0, x['spanMm'][0]-span[1], span[0]-x['spanMm'][1])
            if offset > tolerance or separation > gap:
                continue
            # Coaxial geometry does not establish a bearing fit, engagement,
            # rigid attachment, joint kind, or any permitted travel.
            matches.append(dict(faces=[x['face'],y['face']], originMm=x['origin'], axis=x['axis'],
                                radiiMm=[x['radiusMm'],y['radiusMm']], axisOffsetMm=offset,
                                axialBoundsGapMm=separation))
    return matches

def discover(parts, *, cache_dir=None, ids=None, axis_tolerance_mm=0.05, neighbor_gap_mm=2.0, max_pairs=100000):
    """Propose coaxial connections; never infer joint type, travel or actuation.

    Units: mm, world-space assembled CAD coordinates. Pair checks use bounds
    only as broad phase. This is not an interference or clearance certificate.
    """
    if not all(isinstance(x,(float,int)) and not isinstance(x,bool) and math.isfinite(x) and x>=0 for x in (axis_tolerance_mm,neighbor_gap_mm)):
        raise ValueError('Tolerances must be finite nonnegative millimetres')
    if type(max_pairs) is not int or max_pairs < 1:
        raise ValueError('max_pairs must be a positive integer')
    parts = list(parts)
    names = [p['id'] for p in parts]
    if any(not isinstance(n,str) or not n for n in names) or len(set(names)) != len(names):
        raise ValueError('Unique nonempty occurrence IDs required')
    if ids is not None:
        if not isinstance(ids,list) or not ids or len(set(ids))!=len(ids) or not set(ids).issubset(names):
            raise ValueError('Unknown, duplicate or empty discovery selection')
        parts = [p for p in parts if p['id'] in ids]
    cache = Cache(cache_dir)
    records = [occurrence(p, cache) for p in sorted(parts, key=lambda p:p['id'])]
    candidates, checked = [], 0
    # Sweep along X before testing remaining AABB axes. No all-face-pairs pass
    # across the entire assembly. Budget failure is explicit, never truncation.
    ordered = sorted(records, key=lambda p:p['bounds'][0][0])
    for i, left in enumerate(ordered):
        for right in ordered[i+1:]:
            if right['bounds'][0][0] > left['bounds'][1][0]+neighbor_gap_mm:
                break
            if any(left['bounds'][1][k]+neighbor_gap_mm < right['bounds'][0][k] or right['bounds'][1][k]+neighbor_gap_mm < left['bounds'][0][k] for k in (1,2)):
                continue
            checked += 1
            if checked > max_pairs:
                raise ValueError('Discovery pair budget exceeded; select a subsystem')
            a,b = sorted((left,right),key=lambda p:p['id'])
            evidence_key = [[p['geometryHash'],p['placement']] for p in (a,b)]
            matches = cache.get('pair', [evidence_key,axis_tolerance_mm,neighbor_gap_mm], lambda: compare(a,b,axis_tolerance_mm,neighbor_gap_mm))
            if not matches:
                continue
            candidate_id = 'coaxial:' + digest([a['id'],b['id']])[:24]
            candidates.append(dict(id=candidate_id, parts=[a['id'],b['id']], kind='coaxial', status='proposed',
                evidenceHash=digest([VERSION,evidence_key,matches]), evidence=matches,
                possibleJointTypes=['fixed','revolute','cylindrical'],
                unknowns=['joint type','rigid group membership','limits','actuation','coupling','contact behavior']))
    return dict(schema=1, units='mm', analyzer=VERSION, scope='Selected occurrences only' if ids else 'All supplied occurrences',
                coverage=['analytic cylindrical axes','nearby coaxial surface pairs'],
                unsupported=['automatic rigid groups','slider detection','gear or belt ratio inference','closed-loop solving','contact-driven deployment'],
                parts=records, candidates=sorted(candidates,key=lambda c:c['id']), cache=cache.stats,
                checkedPairs=checked, collisionChecked=False)

def review(report, decisions):
    """Apply evidence-bound human/agent decisions without changing active CAD.

    Decisions remain a review ledger, not another kinematics interchange format.
    Unsupported intents remain explicit and cannot become animator commands.
    """
    if report.get('schema')!=1 or not isinstance(decisions,list):
        raise ValueError('Expected discovery report and decision list')
    current = {c['id']:c for c in report['candidates']}
    seen, results = set(), []
    for d in decisions:
        key=d['candidateId']
        if key in seen:
            raise ValueError('Duplicate candidate decision')
        seen.add(key)
        if d.get('decision') not in ('confirm','reject') or not isinstance(d.get('reason'),str) or not d['reason'].strip():
            raise ValueError('Decision and nonempty evidence/reason required')
        c=current.get(key)
        state='stale' if not c or d.get('evidenceHash')!=c['evidenceHash'] else ('confirmed' if d['decision']=='confirm' else 'rejected')
        if d['decision']=='confirm':
            if d.get('jointType') not in ('fixed','revolute','cylindrical'):
                raise ValueError('Explicit joint type required')
            if state=='confirmed' and (type(d.get('evidenceIndex')) is not int or not 0<=d['evidenceIndex']<len(c['evidence'])):
                raise ValueError('Choose an explicit measured axis by evidenceIndex')
        results.append(dict(**d, status=state))
    return dict(schema=1, decisions=results, pending=[c['id'] for c in report['candidates'] if c['id'] not in seen or any(d['candidateId']==c['id'] and d['status']=='stale' for d in results)], activatesMotion=False)
