"""Current-CAD handoff and checked DXF outputs for an external SheetMetal unfolder."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import cadquery as cq
from cad_references import fingerprint, resolve
from flat_export import prepare as prepare_flat


def prepare(parts, request):
    allowed = {'schema', 'part', 'shapeHash', 'rootFace', 'thicknessMm', 'kFactor'}
    if not isinstance(request, dict) or set(request) - allowed or type(request.get('schema')) is not int or request['schema'] != 1:
        raise ValueError('Sheet metal requires schema 1 and supported fields only')
    thickness = request.get('thicknessMm')
    if type(thickness) not in (int, float) or not math.isfinite(thickness) or thickness <= 0:
        raise ValueError('Explicit positive thicknessMm is required')
    k = request.get('kFactor')
    if not isinstance(k, dict) or set(k) != {'value', 'standard', 'source'} or k['standard'] not in ('ansi', 'din') or not isinstance(k['source'], str) or not k['source'].strip():
        raise ValueError('Explicit kFactor requires value, standard (ansi/din), and source')
    if type(k['value']) not in (int, float) or not math.isfinite(k['value']) or not 0 <= k['value'] <= (0.5 if k['standard'] == 'ansi' else 1):
        raise ValueError('K-factor range is 0–0.5 ANSI or 0–1 DIN')
    reference = request.get('rootFace')
    if not isinstance(reference, dict) or reference.get('part') != request.get('part') or reference.get('kind') != 'plane':
        raise ValueError('rootFace must be a checked named plane on the requested part')
    face, evidence = resolve(parts, reference)
    shape = next(p['shape'] for p in parts if p['id'] == request['part'])
    if not shape.isValid() or len(shape.Solids()) != 1:
        raise ValueError('Sheet metal requires one valid solid')
    if any(f.geomType() not in ('PLANE', 'CYLINDER') for f in shape.Faces()):
        raise ValueError('Initial sheet metal scope supports planar walls and cylindrical bends only')
    digest = fingerprint(shape)
    if 'shapeHash' in request and request['shapeHash'] != digest:
        raise ValueError('Stale sheet metal geometry hash')
    return shape, dict(request=request, shapeHash=digest, rootFace=evidence)


def export_job(parts, request, output):
    shape, job = prepare(parts, request)
    root = Path(output)
    root.mkdir(parents=True, exist_ok=False)
    shape.exportBrep(str(root/'input.brep'))
    job['geometrySha256'] = hashlib.sha256((root/'input.brep').read_bytes()).hexdigest()
    (root/'input.json').write_text(json.dumps(job, indent=2, allow_nan=False)+'\n')
    return job


def finish(output, explain=False):
    from cadquery.occ_impl.exporters.dxf import DxfDocument
    from dxf_preview import render_dxf
    root = Path(output)
    job = json.loads((root/'input.json').read_text())
    backend = json.loads((root/'backend-result.json').read_text())
    if not backend.get('ok'):
        raise ValueError(backend.get('error', 'SheetMetal backend failed'))
    for name, digest in backend['files'].items():
        if name not in ('flat.brep', 'bends.brep') or hashlib.sha256((root/name).read_bytes()).hexdigest() != digest:
            raise ValueError('Unfolded geometry hash mismatch')
    shape = cq.Shape.importBrep(str(root/'flat.brep'))
    bends = cq.Shape.importBrep(str(root/'bends.brep'))
    frame = dict(origin=[0, 0, 0], xDir=[1, 0, 0], normal=[0, 0, 1])
    face, wires, evidence = prepare_flat([dict(id='flat', shape=shape)], dict(schema=1, part='flat', frame=frame))
    if abs(evidence['thicknessMm'] - job['request']['thicknessMm']) > 1e-5:
        raise ValueError('Unfolded thickness does not match requested stock')
    for edge in bends.Edges():
        b = edge.BoundingBox()
        if edge.geomType() != 'LINE' or abs(b.zmin) > 1e-5 or abs(b.zmax) > 1e-5:
            raise ValueError('Bend centerlines must be planar XY lines')
        if sum(e.Length() for e in edge.cut(face).Edges()) > 1e-5:
            raise ValueError('Bend centerline extends outside the flat profile')
    # A cutting-only file prevents bend marks from becoming unintended cuts.
    for name, include_bends in [('cut.dxf', False), ('unfold.dxf', True)]:
        doc = DxfDocument(doc_units=4)
        doc.add_layer('OUTLINE').add_layer('HOLES')
        doc.add_shape(wires[0], layer='OUTLINE')
        for wire in wires[1:]: doc.add_shape(wire, layer='HOLES')
        if include_bends:
            doc.document.linetypes.new('BEND_DASH', dxfattribs={'pattern': [4.0, 2.5, -1.5]})
            doc.document.layers.new('BENDS', dxfattribs={'color': 1, 'linetype': 'BEND_DASH'})
            for edge in bends.Edges(): doc.add_shape(cq.Wire.assembleEdges([edge]), layer='BENDS')
        doc.document.saveas(str(root/name))
    cq.exporters.export(shape, str(root/'flat.step'))
    preview = render_dxf(root/'unfold.dxf', root/'preview.svg')
    files = {n: hashlib.sha256((root/n).read_bytes()).hexdigest() for n in ('cut.dxf', 'unfold.dxf', 'flat.step', 'preview.svg')}
    explanation = None
    if explain:
        from fold_diagram import diagram
        explanation = diagram(backend['bends'], job['request']['thicknessMm'], job['request']['kFactor'], root/'folds.svg')
        files['folds.svg'] = hashlib.sha256((root/'folds.svg').read_bytes()).hexdigest()
    result = dict(explanation=explanation, ok=True, schema=1, units='mm', scale=1, part=job['request']['part'], shapeHash=job['shapeHash'],
                  flat=evidence, backend=backend, kFactor=job['request']['kFactor'], preview=preview, files=files,
                  reviewRequired=True, dfmValidated=False,
                  limitations=['Planar walls and cylindrical bends; upstream unfolding may approximate curves',
                               'No tooling access, bend sequence, springback, cutter compensation or machine-specific DFM check',
                               'cut.dxf contains cutting contours only; unfold.dxf also contains BENDS centerlines'])
    with (root/'result.json').open('x') as f: json.dump(result, f, indent=2, allow_nan=False)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--finish', required=True); parser.add_argument('--explain', action='store_true')
    args = parser.parse_args()
    try: print(json.dumps(finish(args.finish, args.explain), allow_nan=False))
    except Exception as error:
        print(json.dumps(dict(ok=False, error=str(error)))); raise SystemExit(1)
