"""Small agent contract over FreeCAD's PlaneGCS, via optional planegcs.

No FreeCAD GUI, CAD rebuild, or implicit dependency installation. Coordinates
are millimetres. Native Python callers may use planegcs directly for more tools.
"""
import argparse
import json
import math
from importlib.metadata import version
from pathlib import Path


def number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError('Expected a finite number')
    return value


def fields(obj, allowed):
    if not isinstance(obj, dict) or set(obj) - set(allowed):
        raise ValueError('Unsupported fields in sketch request')


def solve(request):
    fields(request, ('schema', 'units', 'points', 'lines', 'circles', 'constraints', 'requireFullyConstrained'))
    if request.get('schema') != 1 or request.get('units') != 'mm':
        raise ValueError('Expected schema 1, units mm')
    required = request.get('requireFullyConstrained', True)
    if type(required) is not bool:
        raise ValueError('requireFullyConstrained must be boolean')
    lists = [request.get(k, []) for k in ('points', 'lines', 'circles', 'constraints')]
    if any(not isinstance(v, list) or len(v) > 512 for v in lists):
        raise ValueError('Sketch exceeds 512 entries per collection')
    if not lists[0]:
        raise ValueError('At least one point is required')
    try:
        from planegcs import Sketch, SolveStatus
    except ImportError as e:
        raise RuntimeError('Optional sketch solver missing: install planegcs==0.9.6 in the chosen Python environment') from e
    if version('planegcs') != '0.9.6':
        raise RuntimeError('This adapter requires planegcs==0.9.6')
    sketch = Sketch()
    points, lines, circles, names, tags = {}, {}, {}, set(), {}
    line_points, circle_points = {}, {}

    def ident(item):
        name = item.get('id')
        if not isinstance(name, str) or not name or name in names:
            raise ValueError('Duplicate or empty sketch ID')
        names.add(name)
        return name

    def get(table, key):
        if not isinstance(key, str) or key not in table:
            raise ValueError('Unknown or wrong-kind sketch reference: ' + str(key))
        return table[key]

    for p in lists[0]:
        fields(p, ('id', 'x', 'y'))
        points[ident(p)] = sketch.add_point(number(p['x']), number(p['y']))
    for l in lists[1]:
        fields(l, ('id', 'a', 'b'))
        name = ident(l)
        if l['a'] == l['b']:
            raise ValueError('Line endpoints must differ')
        lines[name] = sketch.add_line(get(points, l['a']), get(points, l['b']))
        line_points[name] = (l['a'], l['b'])
    for c in lists[2]:
        fields(c, ('id', 'center', 'radius'))
        name = ident(c)
        radius = number(c['radius'])
        if radius <= 0:
            raise ValueError('Circle radius must be positive')
        circles[name] = sketch.add_circle(get(points, c['center']), sketch.add_param(radius))
        circle_points[name] = c['center']
    for c in lists[3]:
        kind = c.get('type')
        allowed = {
            'fix': ('point', 'x', 'y'), 'x': ('point', 'value'), 'y': ('point', 'value'),
            'distance': ('a', 'b', 'value'), 'coincident': ('a', 'b'),
            'horizontal': ('line',), 'vertical': ('line',),
            'equalLength': ('a', 'b'), 'radius': ('circle', 'value'),
            'equalRadius': ('a', 'b'), 'concentric': ('a', 'b'),
        }
        if kind not in allowed:
            raise ValueError('Unsupported sketch constraint: ' + str(kind))
        fields(c, ('id', 'type', *allowed[kind]))
        name = ident(c)
        if kind == 'fix':
            tag = sketch.fix_point(get(points, c['point']), number(c['x']), number(c['y']))
        elif kind in ('x', 'y'):
            tag = getattr(sketch, 'coordinate_' + kind)(get(points, c['point']), sketch.add_fixed_param(number(c['value'])))
        elif kind == 'distance':
            value = number(c['value'])
            if value <= 0:
                raise ValueError('Distance must be positive; use coincident for zero')
            tag = sketch.set_p2p_distance(get(points, c['a']), get(points, c['b']), value)
        elif kind == 'coincident':
            tag = sketch.coincident(get(points, c['a']), get(points, c['b']))
        elif kind in ('horizontal', 'vertical'):
            tag = getattr(sketch, kind)(get(lines, c['line']))
        elif kind == 'equalLength':
            tag = sketch.equal_length(get(lines, c['a']), get(lines, c['b']))
        elif kind == 'radius':
            value = number(c['value'])
            if value <= 0:
                raise ValueError('Radius must be positive')
            tag = sketch.set_circle_radius(get(circles, c['circle']), value)
        elif kind == 'equalRadius':
            tag = sketch.equal_radius_cc(get(circles, c['a']), get(circles, c['b']))
        else:
            tag = sketch.coincident(get(points, get(circle_points, c['a'])), get(points, get(circle_points, c['b'])))
        for t in tag if isinstance(tag, tuple) else (tag,):
            tags[int(t)] = name
    status = sketch.solve()
    diagnosis = sketch.diagnose()
    diagnostic = dict(degreesOfFreedom=diagnosis.dof,
        conflicting=sorted({tags.get(int(t), 'internal:' + str(t)) for t in diagnosis.conflicting}),
        redundant=sorted({tags.get(int(t), 'internal:' + str(t)) for t in diagnosis.redundant}),
        partiallyRedundant=sorted({tags.get(int(t), 'internal:' + str(t)) for t in diagnosis.partially_redundant}))
    result = dict(schema=1, units='mm', solver='PlaneGCS', packageVersion=version('planegcs'),
                  status=status.name, diagnosis=diagnostic, ok=False)
    if status != SolveStatus.Success or diagnosis.conflicting or (required and diagnosis.dof != 0):
        result['error'] = 'Sketch did not solve' if status != SolveStatus.Success else 'Sketch is conflicting or under-constrained'
        return result
    solved = {k: dict(zip(('x', 'y'), sketch.get_point(v))) for k, v in points.items()}
    radii = {k: sketch.get_circle(v).radius for k, v in circles.items()}
    def xy(k): return solved[k]['x'], solved[k]['y']
    def distance(a, b): return math.dist(xy(a), xy(b))
    def length(k): return distance(*line_points[k])
    residuals = {}
    for c in lists[3]:
        kind = c['type']
        if kind == 'fix': r = math.dist(xy(c['point']), (c['x'], c['y']))
        elif kind in ('x', 'y'): r = abs(solved[c['point']][kind] - c['value'])
        elif kind == 'distance': r = abs(distance(c['a'], c['b']) - c['value'])
        elif kind == 'coincident': r = distance(c['a'], c['b'])
        elif kind in ('horizontal', 'vertical'):
            a, b = line_points[c['line']]; key = 'y' if kind == 'horizontal' else 'x'
            r = abs(solved[a][key] - solved[b][key])
        elif kind == 'equalLength': r = abs(length(c['a']) - length(c['b']))
        elif kind == 'radius': r = abs(radii[c['circle']] - c['value'])
        elif kind == 'equalRadius': r = abs(radii[c['a']] - radii[c['b']])
        else: r = distance(circle_points[c['a']], circle_points[c['b']])
        residuals[c['id']] = r
    all_values = [v for p in solved.values() for v in p.values()] + list(radii.values()) + list(residuals.values())
    if not all(math.isfinite(v) for v in all_values) or any(v <= 0 for v in radii.values()) or any(length(k) <= 1e-7 for k in lines) or max(residuals.values(), default=0) > 1e-6:
        result['error'] = 'Solved geometry failed independent residual or degeneracy checks'
        return result
    result.update(ok=True, points=solved, circles={k: dict(center=circle_points[k], radius=v) for k, v in radii.items()},
                  lines=line_points, residualsMm=residuals)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    try:
        result = solve(json.loads(Path(args.input).read_text()))
        with open(args.output, 'x') as f:
            json.dump(result, f, indent=2, allow_nan=False)
        print(json.dumps(result, allow_nan=False))
    except Exception as e:
        print(json.dumps(dict(ok=False, error=str(e))))
        raise SystemExit(1)
