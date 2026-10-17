"""Native CadQuery bhr-2026-600-004a-fdc0673fe431; dimensions in millimetres."""

from native.rails import rail

parameters = {"holeScale": 1, "nutAcrossFlats": 9.779}


def make(**overrides):
    return rail(**{**parameters, **overrides})


def build(ctx):
    return [
        {"id": "bhr-2026-600-004a-fdc0673fe431", "color": "#aab3bd", "shape": make()}
    ]
