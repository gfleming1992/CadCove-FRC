"""part-14-8abf4254dadc: editable tie spacer and nut interfaces."""
from native.drive_spacer import make as spacer
parameters={'length': 146.05, 'notchWidth': 101.6, 'nutAcrossFlats': 9.5758}
def make(**overrides):
    return spacer(**{**parameters, **overrides},center=[-301.625, -12.6873],angle=90)
def build(ctx):
    return [{'id':'part-14-8abf4254dadc','color':'#aab3bd','shape':make()}]
