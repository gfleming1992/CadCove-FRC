"""Team 3310 robot. Native CadQuery parts, shared vendor STEP prototypes.

Edit a part's native/parts/p_*.py parameters or its native helper. Assembly
occurrence IDs and authored colors remain stable for simulation and selection.
Legacy executable CAD sources have been removed.
"""
import importlib
import json
import math
import cadquery as cq
from OCP.gp import gp_Trsf
from pathlib import Path

ROOT=Path(__file__).parent

def prototypes(ctx):
    catalog=json.loads((ROOT/'catalog.json').read_text())
    nodes=json.loads((ROOT/'instances.json').read_text())
    migration=json.loads((ROOT/'native/migration.json').read_text())
    if migration['pending'] or len(migration['converted'])!=migration['expectedAuthoredParts']:
        raise ValueError('Native robot migration is incomplete; refusing an implicit STEP fallback')
    builders={p['id']:p for p in migration['converted']}
    common=['models.py','native/migration.json']+[p for p in ctx.files if p.startswith('native/') and not p.startswith('native/parts/') and p.endswith(('.py','.json'))]
    prototypes={}
    for node in nodes:
        key=node['asset']
        if key in prototypes:continue
        asset=catalog[key]
        if key in builders:
            module='native.parts.'+builders[key]['module']
            factory=importlib.import_module(module).make
            dependencies=[*common,'native/parts/'+builders[key]['module']+'.py']
            prototypes[key]=ctx.component(key,factory,dependencies=dependencies)
        else:
            prototypes[key]=ctx.component(key,lambda a=asset:ctx.import_step(a['file'],a['sha256']),dependencies=['models.py',asset['file']],inputs={'sha256':asset['sha256']})
    return catalog,nodes,prototypes


def mass_signature(shape):
    return (shape.Volume(1e-7),shape.Area(),shape.Center().toTuple(),
            [v for row in cq.Shape.matrixOfInertia(shape) for v in row])


def build(ctx):
    catalog,nodes,shapes=prototypes(ctx)
    repairable={'4-stealth-wheel-40a-1-2-hex-bore-997621bd055b':'997621bd055b88cf3b0de7136d3b9f52ce85fc16b6a159e158a81b996a9915b1'}
    result=[]
    for node in nodes:
        key=node['asset'];shape=shapes[key]
        part={'id':node['id'],'name':node['name'],'color':node['color'],'shape':shape,'transform':node['transform']}
        if key in repairable:
            if catalog[key]['sha256']!=repairable[key]:raise ValueError('Changed vendor wheel needs placement review')
            tr=gp_Trsf();tr.SetValues(*node['transform']);placed=shape.moved(cq.Location(tr))
            if not placed.isValid():
                before=mass_signature(placed)
                # Detach first: healing must not mutate the shared prototype.
                fixed=placed.copy().fix();after=mass_signature(fixed)
                relative=lambda a,b:abs(a-b)/max(1,abs(a))
                if (not fixed.isValid() or relative(before[0],after[0])>1e-9 or relative(before[1],after[1])>1e-9 or
                    math.dist(before[2],after[2])>1e-6 or math.dist(before[3],after[3])/max(1,math.sqrt(sum(x*x for x in before[3])))>1e-9):
                    raise ValueError('Wheel tolerance repair changed mass properties: '+node['id'])
                part['shape']=fixed;part.pop('transform')
        result.append(part)
    return result
