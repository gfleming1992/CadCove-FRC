from native.platforms import panel,guard

def make(**overrides):
    return guard(**overrides)

def build(ctx):
    return [{"id":'bhr-2026-500-027-34d684a8c9de',"color":"#aab3bd","shape":make()}]
