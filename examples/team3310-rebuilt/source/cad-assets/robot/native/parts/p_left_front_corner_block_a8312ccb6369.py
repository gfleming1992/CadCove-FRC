"""left-front-corner-block-a8312ccb6369: native dimensioned stock and manufacturing features (mm)."""
from native.corners import make as build_part
parameters={'holeScale': 1, 'engravingDepth': 1.5875}
def make(**overrides):
    return build_part(**{'rear': False, 'right': False}, **{**parameters, **overrides})
def build(ctx):
    return [{'id':'left-front-corner-block-a8312ccb6369','color':'#aab3bd','shape':make()}]
