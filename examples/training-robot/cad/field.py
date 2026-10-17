"""Training field, sharing the dimensions used by physics."""
import json
from pathlib import Path
from models import build_parts

def build(ctx):
    return build_parts(json.loads(Path(__file__).with_name('design.json').read_text())['fieldParts'])
