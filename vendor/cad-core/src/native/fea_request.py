"""Agent intake for linear static FEA; preparation only, not an FEA solver.

Keep missing physical facts explicit. A complete request still requires current
geometry/reference validation, meshing, restraint checks and convergence study.
"""
import argparse
import json
import math
from pathlib import Path


def prepare(request):
    if not isinstance(request, dict) or set(request) - {'schema', 'analysis', 'units', 'parts', 'loads', 'supports', 'connections', 'outputs', 'assumptions'}:
        raise ValueError('Unsupported analysis request fields')
    if request.get('schema') != 1 or request.get('analysis') != 'linearStatic' or request.get('units') != 'mm-N-MPa':
        raise ValueError('Only schema 1 linearStatic with units mm-N-MPa is supported')
    questions = []
    def ask(field, question): questions.append(dict(field=field, question=question))
    def positive(v): return type(v) in (int, float) and math.isfinite(v) and v > 0
    parts = request.get('parts', [])
    if not isinstance(parts, list) or len(parts) > 512:
        raise ValueError('Expected at most 512 parts')
    ids = set()
    if not parts: ask('parts', 'Which parts should be analyzed?')
    for p in parts:
        if not isinstance(p, dict) or set(p) - {'id', 'shapeHash', 'material'} or not isinstance(p.get('id'), str) or not p['id'] or p['id'] in ids:
            raise ValueError('Invalid or duplicate analysis part')
        ids.add(p['id']); prefix = 'parts.' + p['id']
        h = p.get('shapeHash')
        if not isinstance(h, str) or len(h) != 64 or any(c not in '0123456789abcdef' for c in h):
            ask(prefix + '.shapeHash', 'Pin this part to its current exact geometry before analysis.')
        material = p.get('material') or {}
        if not isinstance(material, dict) or set(material) - {'name', 'youngsModulusMPa', 'poissonRatio', 'yieldStrengthMPa', 'source'}:
            raise ValueError('Unsupported material fields')
        if not material.get('name') or not material.get('source'):
            ask(prefix + '.material', 'What material and grade is this part, and what is the source of its properties?')
        if not positive(material.get('youngsModulusMPa')):
            ask(prefix + '.material.youngsModulusMPa', 'What Young’s modulus should be used, in MPa?')
        nu = material.get('poissonRatio')
        if type(nu) not in (int, float) or not math.isfinite(nu) or not -1 < nu < 0.5:
            ask(prefix + '.material.poissonRatio', 'What Poisson ratio should be used (between -1 and 0.5)?')
        if 'safetyFactor' in request.get('outputs', []) and not positive(material.get('yieldStrengthMPa')):
            ask(prefix + '.material.yieldStrengthMPa', 'What yield strength should be used for a yield-based safety factor, in MPa?')
    for name in ('loads', 'supports'):
        entries = request.get(name, [])
        if not isinstance(entries, list) or len(entries) > 512:
            raise ValueError('Invalid ' + name)
        if not entries:
            ask(name, 'What forces act on the part, where, and in which directions?' if name == 'loads' else 'Where is the part held, and which translations are restrained?')
        labels = set()
        for i, entry in enumerate(entries):
            allowed = {'id', 'part', 'reference', 'source', 'forceN'} if name == 'loads' else {'id', 'part', 'reference', 'source', 'restrainedTranslations'}
            if not isinstance(entry, dict) or set(entry) - allowed or not isinstance(entry.get('id'), str) or not entry['id'] or entry['id'] in labels:
                raise ValueError('Invalid or duplicate ' + name + ' ID')
            labels.add(entry['id']); prefix = f'{name}.{i}'
            if entry.get('part') not in ids: raise ValueError('Unknown analysis part')
            if not isinstance(entry.get('reference'), str) or not entry['reference']:
                ask(prefix + '.reference', 'Which named geometry reference should this condition attach to?')
            if not entry.get('source'): ask(prefix + '.source', 'What measurement, specification, or explicit assumption supports this condition?')
            if name == 'loads':
                f = entry.get('forceN')
                if not isinstance(f, list) or len(f) != 3 or not all(type(x) in (int, float) and math.isfinite(x) for x in f) or not any(f):
                    ask(prefix + '.forceN', 'What is the nonzero force vector [x,y,z] in newtons, in the CAD frame?')
            else:
                fixed = entry.get('restrainedTranslations')
                if not isinstance(fixed, list) or len(fixed) != 3 or not all(type(x) is bool for x in fixed) or not any(fixed):
                    ask(prefix + '.restrainedTranslations', 'Which translations are restrained [x,y,z]? Do not assume the mount is fully fixed.')
    if len(parts) > 1:
        ask('connections', 'Multi-part contact/fastener analysis is not implemented yet; identify connections and select a supported analysis backend before solving.')
    outputs = request.get('outputs', [])
    if not isinstance(outputs, list) or any(x not in ('displacement', 'stress', 'safetyFactor') for x in outputs):
        raise ValueError('Supported outputs: displacement, stress, safetyFactor')
    if not outputs: ask('outputs', 'Do you want displacement, stress, or a yield-based safety factor?')
    assumptions = request.get('assumptions', [])
    if not isinstance(assumptions, list) or any(not isinstance(x, str) or not x for x in assumptions):
        raise ValueError('Assumptions must be explicit nonempty descriptions')
    return dict(ok=True, schema=1, stage='input-review', inputComplete=not questions,
                readyToSolve=False, solved=False, questions=questions, assumptions=assumptions,
                pending=['Current geometry and reference validation',
                         'Mesh and restraint validation', 'Mesh convergence and result review'], request=request)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    try:
        result = prepare(json.loads(Path(args.input).read_text()))
        with open(args.output, 'x') as f: json.dump(result, f, indent=2, allow_nan=False)
        print(json.dumps(result, allow_nan=False))
    except Exception as e:
        print(json.dumps(dict(ok=False, error=str(e))))
        raise SystemExit(1)
