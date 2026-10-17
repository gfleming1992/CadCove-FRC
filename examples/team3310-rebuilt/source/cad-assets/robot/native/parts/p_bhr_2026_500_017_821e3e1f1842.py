"""Native CadQuery bhr-2026-500-017-821e3e1f1842; dimensions in millimetres."""

from native.brackets import bracket017

parameters = {"frontMountHoleRadius": 1.7272}


def make(**overrides):
    return bracket017(**{**parameters, **overrides})


def build(ctx):
    return [
        {"id": "bhr-2026-500-017-821e3e1f1842", "color": "#aab3bd", "shape": make()}
    ]
