"""Check default native part builds. Requires the pinned CadQuery environment."""
import importlib
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.dont_write_bytecode = True
manifest = json.loads((ROOT / "native/migration.json").read_text())
rows = []
for part in manifest["converted"]:
    start = time.perf_counter()
    try:
        shape = importlib.import_module("native.parts." + part["module"]).make()
        volume = shape.Volume(1e-7)
        if not shape.isValid() or not shape.Solids() or volume <= 0:
            raise ValueError("Expected a valid positive-volume solid")
        rows.append({"id": part["id"], "ok": True, "volumeMm3": volume,
                     "solids": len(shape.Solids()), "buildMs": (time.perf_counter()-start)*1000})
    except Exception as error:
        rows.append({"id": part["id"], "ok": False, "error": str(error)})
print(json.dumps({"ok": all(r["ok"] for r in rows), "scope": "default solid validity only",
                  "parts": rows, "pending": manifest["pending"]}, indent=2))
sys.exit(0 if all(r["ok"] for r in rows) else 1)
