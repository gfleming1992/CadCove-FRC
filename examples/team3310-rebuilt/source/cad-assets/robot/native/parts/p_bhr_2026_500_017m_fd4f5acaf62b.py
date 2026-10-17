"""Native CadQuery bhr-2026-500-017m-fd4f5acaf62b; dimensions in millimetres."""

from native.brackets import bracket017m

parameters = {"counterboreDiameter": 7.9375, "rearPilotRadius": 2.2479}


def make(**overrides):
    return bracket017m(**{**parameters, **overrides})


def build(ctx):
    return [
        {"id": "bhr-2026-500-017m-fd4f5acaf62b", "color": "#aab3bd", "shape": make()}
    ]
