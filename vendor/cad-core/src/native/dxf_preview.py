"""Render planar DXF modelspace with ezdxf's maintained SVG backend."""
import argparse
import hashlib
import json
from pathlib import Path
import ezdxf
from ezdxf import units
from ezdxf.addons.drawing import RenderContext, Frontend, svg, layout, config


def render_dxf(source, output):
    source, output = Path(source), Path(output)
    if output.exists():
        raise ValueError('Preview output already exists')
    if source.stat().st_size > 32*1024*1024:
        raise ValueError('DXF preview limit is 32 MiB')
    doc = ezdxf.readfile(source)
    audit = doc.audit()
    if audit.has_errors:
        raise ValueError('DXF audit found errors; repair the source before previewing')
    entities = list(doc.modelspace())
    allowed = {'LINE', 'ARC', 'CIRCLE', 'ELLIPSE', 'SPLINE', 'LWPOLYLINE', 'POLYLINE'}
    unsupported = sorted({e.dxftype() for e in entities} - allowed)
    if unsupported:
        raise ValueError('Flat DXF preview does not support: ' + ', '.join(unsupported))
    if not entities or len(entities) > 100000:
        raise ValueError('DXF preview requires 1 to 100000 geometry entities')
    if doc.units not in (units.MM, units.IN):
        raise ValueError('DXF must declare millimetres or inches in INSUNITS')
    # Restrict to XY geometry; do not silently flatten a 3D drawing.
    from ezdxf import bbox
    bounds = bbox.extents(entities)
    if not bounds.has_data or abs(bounds.extmin.z) > 1e-5 or abs(bounds.extmax.z) > 1e-5:
        raise ValueError('DXF preview requires planar XY geometry at Z=0')
    if bounds.size.x <= 0 or bounds.size.y <= 0:
        raise ValueError('DXF preview requires a nonzero width and height')
    backend = svg.SVGBackend()
    cfg = config.Configuration(color_policy=config.ColorPolicy.BLACK, background_policy=config.BackgroundPolicy.WHITE)
    Frontend(RenderContext(doc), backend, config=cfg).draw_layout(doc.modelspace(), finalize=True)
    factor = units.conversion_factor(doc.units, units.MM)
    rendered = backend.get_string(layout.Page(0, 0, units=layout.Units.mm),
        settings=layout.Settings(fit_page=False, scale=factor))
    if '<path' not in rendered:
        raise ValueError('DXF produced no visible SVG paths')
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('x') as stream:
        stream.write(rendered)
    return dict(ok=True, source=str(source), svg=str(output), sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),
        svgSha256=hashlib.sha256(output.read_bytes()).hexdigest(), entityCount=len(entities), units='mm',
        sourceUnits='mm' if doc.units == units.MM else 'in', widthMm=bounds.size.x*factor, heightMm=bounds.size.y*factor,
        previewOnly=True, warnings=['Preview is not a toolpath or machining approval'] + (['DXF audit repaired issues in memory'] if audit.has_fixes else []))

if __name__ == '__main__':
    args=argparse.ArgumentParser();args.add_argument('--input',required=True);args.add_argument('--output',required=True)
    options=args.parse_args()
    try:
        print(json.dumps(render_dxf(options.input,options.output),allow_nan=False))
    except Exception as exc:
        print(json.dumps(dict(ok=False,error=str(exc))));raise SystemExit(1)
