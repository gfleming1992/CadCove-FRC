"""Native CadQuery bhr-2026-500-022m-005027036523; dimensions in millimetres."""

from native.brackets import bracket022m

parameters = {"frontMountHoleRadius": 1.7272, "counterboreDiameter": 7.9375}


def make(**overrides):
    return bracket022m(**{**parameters, **overrides})


def build(ctx):
    return [
        {"id": "bhr-2026-500-022m-005027036523", "color": "#aab3bd", "shape": make()}
    ]
