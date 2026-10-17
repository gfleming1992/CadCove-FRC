"""right-rear-corner-block-74b524db1283: native dimensioned stock and manufacturing features (mm)."""
from native.corners import make as build_part
parameters={'holeScale': 1, 'engravingDepth': 1.5875}
def make(**overrides):
    return build_part(**{'rear': True, 'right': True}, **{**parameters, **overrides})
def build(ctx):
    return [{'id':'right-rear-corner-block-74b524db1283','color':'#aab3bd','shape':make()}]
