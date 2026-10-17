from native.platforms import panel,guard

def make(**overrides):
    return guard(**overrides).mirror((0,1,0),(0,0,0))

def build(ctx):
    return [{"id":'bhr-2026-500-027m-538f738485fe',"color":"#aab3bd","shape":make()}]
