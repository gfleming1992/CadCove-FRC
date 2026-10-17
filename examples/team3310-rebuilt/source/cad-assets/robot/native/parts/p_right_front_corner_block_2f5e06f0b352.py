"""right-front-corner-block-2f5e06f0b352: native dimensioned stock and manufacturing features (mm)."""
from native.corners import make as build_part
parameters={'holeScale': 1, 'engravingDepth': 1.5875}
def make(**overrides):
    return build_part(**{'rear': False, 'right': True}, **{**parameters, **overrides})
def build(ctx):
    return [{'id':'right-front-corner-block-2f5e06f0b352','color':'#aab3bd','shape':make()}]
