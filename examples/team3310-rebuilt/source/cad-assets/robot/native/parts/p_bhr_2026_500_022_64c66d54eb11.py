"""Native CadQuery bhr-2026-500-022-64c66d54eb11; dimensions in millimetres."""

from native.brackets import bracket022

parameters = {"frontMountHoleRadius": 1.7272}


def make(**overrides):
    return bracket022(**{**parameters, **overrides})


def build(ctx):
    return [
        {"id": "bhr-2026-500-022-64c66d54eb11", "color": "#aab3bd", "shape": make()}
    ]
