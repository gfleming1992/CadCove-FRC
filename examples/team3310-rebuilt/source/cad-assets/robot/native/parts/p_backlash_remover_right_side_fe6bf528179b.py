"""backlash-remover-right-side-fe6bf528179b: native dimensioned stock and manufacturing features (mm)."""
from native.backlash import make as build_part
parameters={'holeScale': 1, 'hubLength': 25.4}
def make(**overrides):
    return build_part(**{'rightSide': True}, **{**parameters, **overrides})
def build(ctx):
    return [{'id':'backlash-remover-right-side-fe6bf528179b','color':'#aab3bd','shape':make()}]
