from native.platforms import panel,guard

def make(**overrides):
    return panel('014',**overrides).mirror((0,1,0),(0,0,0))

def build(ctx):
    return [{"id":'bhr-2026-500-014m-top-22ebd4ced951',"color":"#aab3bd","shape":make()}]
