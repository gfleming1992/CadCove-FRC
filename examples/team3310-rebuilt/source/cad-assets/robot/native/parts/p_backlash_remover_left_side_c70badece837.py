"""backlash-remover-left-side-c70badece837: native dimensioned stock and manufacturing features (mm)."""
from native.backlash import make as build_part
parameters={'holeScale': 1, 'hubLength': 12.7}
def make(**overrides):
    return build_part(**{'rightSide': False}, **{**parameters, **overrides})
def build(ctx):
    return [{'id':'backlash-remover-left-side-c70badece837','color':'#aab3bd','shape':make()}]
