"""part-13-9970d95455ef: editable tie spacer and nut interfaces."""
from native.drive_spacer import make as spacer
parameters={'length': 158.75, 'notchWidth': 88.9, 'nutAcrossFlats': 9.5758}
def make(**overrides):
    return spacer(**{**parameters, **overrides},center=[-193.675, 101.6],angle=0)
def build(ctx):
    return [{'id':'part-13-9970d95455ef','color':'#aab3bd','shape':make()}]
