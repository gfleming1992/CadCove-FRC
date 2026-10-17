from native.platforms import panel,guard

def make(**overrides):
    return panel('014',**overrides)

def build(ctx):
    return [{"id":'bhr-2026-500-014-top-d26859488e35',"color":"#aab3bd","shape":make()}]
