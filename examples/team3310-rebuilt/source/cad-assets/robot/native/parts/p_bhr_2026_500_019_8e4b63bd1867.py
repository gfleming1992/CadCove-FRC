from native.platforms import panel,guard

def make(**overrides):
    return panel('019',**overrides)

def build(ctx):
    return [{"id":'bhr-2026-500-019-8e4b63bd1867',"color":"#aab3bd","shape":make()}]
