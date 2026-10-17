"""Native CadQuery shroud-5023935d6e1a; dimensions in millimetres."""

from native.shroud import shroud

parameters = {"mountHoleRadius": 3.429}


def make(**overrides):
    return shroud(**{**parameters, **overrides})


def build(ctx):
    return [{"id": "shroud-5023935d6e1a", "color": "#aab3bd", "shape": make()}]
