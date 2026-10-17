"""Editable STEP assembly: immutable prototypes, stable occurrence IDs."""
import json
from pathlib import Path
ROOT = Path(__file__).parent

def build(ctx):
    catalog = json.loads((ROOT/'catalog.json').read_text())
    nodes = json.loads((ROOT/'instances.json').read_text())
    shapes = {}
    for node in nodes:
        key = node['asset']
        if key not in shapes:
            asset = catalog[key]
            shapes[key] = ctx.component(key,lambda a=asset:ctx.import_step(a['file'],a['sha256']),dependencies=['models.py',asset['file']],inputs={'sha256':asset['sha256']})
    return [dict(id=n['id'],name=n['name'],color=n['color'],shape=shapes[n['asset']],transform=n['transform']) for n in nodes]
