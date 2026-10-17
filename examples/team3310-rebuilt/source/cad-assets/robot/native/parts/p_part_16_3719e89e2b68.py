"""part-16-3719e89e2b68: editable tie spacer and nut interfaces."""
from native.drive_spacer import make as spacer
parameters={'nutAcrossFlats': 9.5758, 'notchWidth': 25.4, 'length': 88.9}
def make(**overrides):
    return spacer(**{**parameters, **overrides},center=[-193.675, -101.6],angle=0)
def build(ctx):
    return [{'id':'part-16-3719e89e2b68','color':'#aab3bd','shape':make()}]
