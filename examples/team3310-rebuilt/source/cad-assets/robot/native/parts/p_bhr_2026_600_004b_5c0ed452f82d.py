"""Native CadQuery bhr-2026-600-004b-5c0ed452f82d; dimensions in millimetres."""

from native.rails import rail

parameters = {"holeScale": 1, "nutAcrossFlats": 9.779}


def make(**overrides):
    return rail(**{**parameters, **overrides}, b=True)


def build(ctx):
    return [
        {"id": "bhr-2026-600-004b-5c0ed452f82d", "color": "#aab3bd", "shape": make()}
    ]
