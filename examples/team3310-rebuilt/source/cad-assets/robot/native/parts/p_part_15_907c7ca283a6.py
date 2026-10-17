"""part-15-907c7ca283a6: editable tie spacer and nut interfaces."""
from native.drive_spacer import make as spacer
parameters={'length': 95.25, 'notchWidth': 50.8, 'nutAcrossFlats': 9.5758}
def make(**overrides):
    return spacer(**{**parameters, **overrides},center=[-88.9, 0],angle=90)
def build(ctx):
    return [{'id':'part-15-907c7ca283a6','color':'#aab3bd','shape':make()}]
