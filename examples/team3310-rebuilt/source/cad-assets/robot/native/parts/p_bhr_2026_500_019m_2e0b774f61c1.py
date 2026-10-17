from native.platforms import panel,guard

def make(**overrides):
    return panel('019',**overrides).mirror((0,1,0),(0,0,0))

def build(ctx):
    return [{"id":'bhr-2026-500-019m-2e0b774f61c1',"color":"#aab3bd","shape":make()}]
