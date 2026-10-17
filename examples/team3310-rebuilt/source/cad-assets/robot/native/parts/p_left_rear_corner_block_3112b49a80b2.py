"""left-rear-corner-block-3112b49a80b2: native dimensioned stock and manufacturing features (mm)."""
from native.corners import make as build_part
parameters={'holeScale': 1, 'engravingDepth': 1.5875}
def make(**overrides):
    return build_part(**{'rear': True, 'right': False}, **{**parameters, **overrides})
def build(ctx):
    return [{'id':'left-rear-corner-block-3112b49a80b2','color':'#aab3bd','shape':make()}]
