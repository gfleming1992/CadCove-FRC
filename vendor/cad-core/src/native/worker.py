"""Trusted local CadQuery worker. JSON lines for control, binary meshes on disk.

This is process isolation for responsiveness/cancellation, NOT a Python sandbox.
Only launch after the editor grants workspace trust. No network/API service.
"""
import contextlib
import hashlib
import importlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import struct
import sys
import time
import traceback
import tempfile
from collections import OrderedDict

START = time.perf_counter()
# OCCT writes to C stdout as well as Python stdout. Keep both out of JSONL.
PROTOCOL = os.fdopen(os.dup(sys.stdout.fileno()), "w", buffering=1)
os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
import cadquery as cq
import OCP
import numpy as np
from geometry import mesh, encode
from OCP.BRep import BRep_Tool, BRep_Builder
from OCP.TopoDS import TopoDS_Shape
from OCP.StdPrs import StdPrs_ToolTriangulatedShape
from OCP.TopAbs import TopAbs_REVERSED
from OCP.TopLoc import TopLoc_Location
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRepBndLib import BRepBndLib
from OCP.Bnd import Bnd_Box
from OCP.gp import gp_Trsf
from OCP.BRepTools import BRepTools
from OCP.TopTools import TopTools_FormatVersion_VERSION_1

IDENTITY = "cadquery@2.6.1/ocp@7.8.1.1/native-mesh-v1/worker:" + hashlib.sha256(b''.join(
    Path(__file__).with_name(name).read_bytes() for name in
    (Path(__file__).name, 'geometry.py', 'sketch_solver.py', 'cad_references.py'))).hexdigest()
if cq.__version__ != "2.6.1" or OCP.__version__ != "7.8.1.1":
    raise RuntimeError("Install the pinned CadCove native requirements in your Python environment")
sys.stdout = sys.stderr  # User print() must never corrupt the protocol.
sys.dont_write_bytecode = True


def emit(value):
    PROTOCOL.write(json.dumps(value, allow_nan=False) + "\n")
    PROTOCOL.flush()


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def shape_of(value):
    if isinstance(value, cq.Workplane):
        shapes = value.vals()
        if not shapes or not all(isinstance(s, cq.Shape) for s in shapes):
            raise TypeError("Workplane must contain CAD shapes")
        value = shapes[0] if len(shapes) == 1 else cq.Compound.makeCompound(shapes)
    if not isinstance(value, cq.Shape):
        raise TypeError("Return a CadQuery Shape/Workplane or {id, name, color, shape} records")
    return value


def brep_bytes(shape):
    buffer = io.BytesIO()
    BRepTools.Write_s(shape.wrapped, buffer, False, False, TopTools_FormatVersion_VERSION_1)
    return buffer.getvalue()


class Context:
    """Explicit dependency cache; unspecified dependencies use the entire snapshot.

    component(name, factory, dependencies=[...], inputs={...}) caches exact BREP
    and its mesh. Declare every local source/data dependency when narrowing the
    default. read_asset verifies imported STEP hashes when one is supplied.
    """
    def __init__(self):
        self.cache = OrderedDict()
        self.bytes = 0

    def begin(self, request):
        self.root = Path(request["root"]).resolve()
        self.files = request["files"]
        # Hash large shared numeric sources once, not once per assembly part.
        self.file_hashes = {p: hashlib.sha256(v.encode()).hexdigest() for p,v in self.files.items()}
        self.pending = {}
        self.keys = {}
        self.hits = self.misses = self.disk_hits = 0
        self.disk_dir = Path(request["output"]).resolve().parent / "components"
        try:
            if self.disk_dir.is_symlink():
                raise ValueError("Component cache directory is a symlink")
            self.disk_dir.mkdir(parents=True, exist_ok=True)
        except (OSError, ValueError):
            self.disk_dir = None

    def path(self, relative):
        target = (self.root / relative).resolve()
        if not target.is_relative_to(self.root):
            raise ValueError("Asset leaves the CAD source directory")
        return target

    def read_asset(self, relative, sha256=None):
        data = self.path(relative).read_bytes()
        if sha256 and hashlib.sha256(data).hexdigest() != sha256:
            raise ValueError(f"Asset hash mismatch: {relative}")
        return data

    def import_step(self, relative, sha256=None):
        self.read_asset(relative, sha256)
        return shape_of(cq.importers.importStep(str(self.path(relative))))

    def component(self, name, factory, *, dependencies=None, inputs=None):
        dependencies = sorted(self.files) if dependencies is None else sorted(set(dependencies))
        missing = [p for p in dependencies if p not in self.files]
        if missing:
            raise ValueError(f"Untracked component dependencies: {missing}")
        key = digest([IDENTITY, name, [(p, self.file_hashes[p]) for p in dependencies], inputs])
        item = self.pending.get(key) or self.cache.get(key)
        if item is None:
            item = self.load_component(key)
            if item is not None:
                self.disk_hits += 1
        if item:
            self.hits += 1
        else:
            self.misses += 1
            shape = shape_of(factory())
            if not shape.isValid():
                raise ValueError(f"Invalid component: {name}")
            data = brep_bytes(shape)
            # BREP serialization is a conservative cache budget proxy, not RSS.
            item = {"shape": shape, "signature": hashlib.sha256(data).digest(), "bytes": len(data) * 4}
        self.pending[key] = item
        # A model may call mutating Shape.move or use OCP directly. Never expose
        # the canonical cache shape, and verify the returned copy before reuse.
        shape = item["shape"].copy()
        self.keys[id(shape)] = (key, hashlib.sha256(brep_bytes(shape)).digest())
        return shape

    def load_component(self, key):
        if self.disk_dir is None:
            return None
        file = self.disk_dir / (key + ".bin")
        try:
            if file.is_symlink() or file.stat().st_size > 256 * 1024 * 1024:
                return None
            raw = file.read_bytes()
            if raw[:4] != b"ICC1" or len(raw) < 8:
                return None
            size = struct.unpack("<I", raw[4:8])[0]
            if size > 65536 or size > len(raw) - 8:
                return None
            header = json.loads(raw[8:8+size])
            payload = raw[8+size:]
            if header["key"] != key or header["runtime"] != IDENTITY or hashlib.sha256(json.dumps({k:v for k,v in header.items() if k != "sha256"}, sort_keys=True, separators=(",", ":")).encode() + payload).hexdigest() != header["sha256"]:
                return None
            length = header["brep"]
            if type(length) is not int or not 0 < length <= len(payload):
                return None
            wrapped = TopoDS_Shape()
            BRepTools.Read_s(wrapped, io.BytesIO(payload[:length]), BRep_Builder())
            shape = cq.Shape.cast(wrapped)
            if not shape.isValid():
                return None
            item = {"shape": shape, "bytes": length * 4, "persisted": True}
            lengths = header["mesh"]
            if lengths is not None:
                if not isinstance(lengths, list) or len(lengths) != 3 or any(type(n) is not int or n <= 0 or n % 3 for n in lengths):
                    return None
                if lengths[0] != lengths[1] or length + sum(lengths) * 4 != len(payload):
                    return None
                arrays = []
                for count, dtype in zip(lengths, ("<f4", "<f4", "<u4")):
                    arrays.append(np.frombuffer(payload, dtype=dtype, count=count, offset=length).copy())
                    length += count * 4
                if not np.isfinite(arrays[0]).all() or not np.isfinite(arrays[1]).all() or int(arrays[2].max()) >= lengths[0] // 3:
                    return None
                metrics = header["metrics"]
                if metrics["valid"] is not True or not np.isfinite(metrics["volume"]) or metrics["volume"] < 0:
                    return None
                bounds = np.asarray([metrics["bounds"]["min"], metrics["bounds"]["max"]])
                if bounds.shape != (2, 3) or not np.isfinite(bounds).all() or np.any(bounds[0] > bounds[1]):
                    return None
                if metrics["triangles"] != lengths[2] // 3:
                    return None
                item.update(mesh=tuple(arrays), metrics=metrics)
                item["bytes"] += sum(a.nbytes for a in arrays)
            elif length != len(payload):
                return None
            return item
        except Exception:
            # A missing, interrupted, obsolete or corrupt cache is a cache miss.
            # Geometry is rebuilt from the authoritative source, never hidden.
            return None

    def save_component(self, key, item):
        if self.disk_dir is None or item.get("persisted"):
            return
        tmp = None
        try:
            data = brep_bytes(item["shape"])
            arrays = item.get("mesh")
            payload = data + (b"".join(a.tobytes() for a in arrays) if arrays is not None else b"")
            if len(payload) > 256 * 1024 * 1024 - 65544:
                return
            metadata = {"key": key, "runtime": IDENTITY, "brep": len(data),
                        "mesh": [len(a) for a in arrays] if arrays is not None else None,
                        "metrics": item.get("metrics")}
            checksum = hashlib.sha256(json.dumps(metadata, sort_keys=True, separators=(",", ":"), allow_nan=False).encode() + payload).hexdigest()
            header = json.dumps({**metadata, "sha256": checksum}, allow_nan=False).encode()
            with tempfile.NamedTemporaryFile(dir=self.disk_dir, suffix=".tmp", delete=False) as stream:
                tmp = Path(stream.name)
                stream.write(b"ICC1" + struct.pack("<I", len(header)) + header + payload)
            os.replace(tmp, self.disk_dir / (key + ".bin"))
            item["persisted"] = True
        except OSError as error:
            print("Component cache write skipped:", error, file=sys.stderr)
        finally:
            if tmp is not None:
                try:
                    tmp.unlink(missing_ok=True)
                except OSError:
                    pass

    def commit(self):
        for key, item in self.pending.items():
            self.save_component(key, item)
        # Disk storage is expendable and bounded. Keep recent entries first;
        # atomic replacement lets other workers read without a shared lock.
        if self.disk_dir is not None:
            try:
                entries = [(p.stat().st_mtime, p.stat().st_size, p) for p in self.disk_dir.iterdir()
                           if re.fullmatch(r"[0-9a-f]{64}\.bin", p.name) and not p.is_symlink()]
                total = sum(size for _, size, _ in entries)
                for _, size, file in sorted(entries):
                    if total <= 2 * 1024 * 1024 * 1024:
                        break
                    file.unlink(missing_ok=True)
                    total -= size
            except OSError:
                pass
        # Retain only dependencies used by the accepted revision, then apply cap.
        self.cache = OrderedDict(self.pending)
        self.bytes = sum(v["bytes"] for v in self.cache.values())
        self.requested_bytes = self.bytes
        while self.cache and self.bytes > 640 * 1024 * 1024:
            _, item = self.cache.popitem(last=False)
            self.bytes -= item["bytes"]




def instance_transform(value):
    """Finite rigid row-major 3x4 placement; no scaling/reflection of normals."""
    matrix = np.asarray(value, dtype=np.float64)
    if matrix.shape != (12,) or not np.isfinite(matrix).all():
        raise ValueError("Part transform must contain 12 finite row-major numbers")
    matrix = matrix.reshape(3, 4)
    rotation = matrix[:, :3]
    if not np.allclose(rotation.T @ rotation, np.eye(3), atol=1e-8, rtol=0) or abs(np.linalg.det(rotation)-1) > 1e-8:
        raise ValueError("Part transform must be a proper rigid placement")
    tr = gp_Trsf()
    tr.SetValues(*matrix.ravel().tolist())
    return matrix, cq.Location(tr)




ctx = Context()
last_parts = []
local_modules = set()


def build(request):
    global last_parts, local_modules
    t = time.perf_counter()
    cpu = time.process_time()
    ctx.begin(request)
    root = str(ctx.root)
    ctx.build_dir = Path(request["output"]).resolve().parent
    # Fresh module namespace on every build, while native libraries stay warm.
    for name in local_modules:
        sys.modules.pop(name, None)
    importlib.invalidate_caches()
    previous_path = sys.path[:]
    previous_cwd = os.getcwd()
    os.chdir(root)
    sys.path.insert(0, root)
    try:
        if request.get("stepAsset"):
            result = cq.Assembly.load(str(ctx.path(request["stepAsset"])), "STEP")
        else:
            spec = importlib.util.spec_from_file_location("cadcove_model", ctx.path(request["entry"]))
            module = importlib.util.module_from_spec(spec)
            sys.modules[spec.name] = module
            spec.loader.exec_module(module)
            if callable(getattr(module, "build", None)):
                result = module.build(ctx)
            elif hasattr(module, "result"):
                result = module.result
            else:
                raise ValueError("Define build(ctx) or assign a CadQuery object to result")
    finally:
        local_modules = {name for name,module in sys.modules.items()
                         if (file := getattr(module, "__file__", None))
                         and file.startswith(root + os.sep)
                         and not any(p.startswith('.') for p in Path(file).relative_to(ctx.root).parts)}
        sys.path[:] = previous_path
        os.chdir(previous_cwd)
    build_ms = (time.perf_counter() - t) * 1000
    if isinstance(result, cq.Assembly):
        result = [{"id": name, "name": name, "color": "#%02x%02x%02x" % tuple(round(c*255) for c in color.toTuple()[:3]) if color else "#cb7952", "shape": shape.moved(loc)} for shape, name, loc, color in result]
    if not isinstance(result, (list, tuple)):
        result = [result]
    if not result:
        raise ValueError("The model returned no parts")
    parts, meshes, exact, ids = [], [], [], set()
    validation_ms = tessellation_ms = metrics_ms = 0
    prototypes = {}
    for index, value in enumerate(result):
        item = value if isinstance(value, dict) else {"shape": value}
        shape = shape_of(item["shape"])
        name = str(item.get("id", f"part-{index+1}"))
        if name in ids:
            raise ValueError(f"Duplicate part ID: {name}")
        ids.add(name)
        mark = time.perf_counter()
        prototype = prototypes.get(id(shape))
        if prototype is None:
            certificate = ctx.keys.get(id(shape))
            key = certificate[0] if certificate else None
            cached = ctx.pending.get(key)
            if cached and hashlib.sha256(brep_bytes(shape)).digest() != certificate[1]:
                cached = None
            if cached is None and not shape.isValid():
                raise ValueError(f"{name}: OCCT reports invalid geometry")
            validation_ms += (time.perf_counter() - mark) * 1000
            mark = time.perf_counter()
            arrays = cached.get("mesh") if cached else None
            if arrays is None:
                arrays = mesh(shape)
                if cached is not None:
                    cached["mesh"] = arrays
                    cached["bytes"] += sum(a.nbytes for a in arrays)
            tessellation_ms += (time.perf_counter() - mark) * 1000
            mark = time.perf_counter()
            # Preview diagnostics use CadQuery's standard integration. High-
            # precision mass integration belongs in explicit cad-inspect checks,
            # not on the first-render path of every imported assembly part.
            metrics = cached.get("metrics") if cached else None
            if metrics is None:
                bounds = Bnd_Box()
                BRepBndLib.AddOptimal_s(shape.wrapped, bounds, False, False)
                xmin,ymin,zmin,xmax,ymax,zmax = bounds.Get()
                metrics = {"valid": True, "volume": shape.Volume(), "volumeMethod": "occt-fixed-quadrature", "bounds": {"min": [xmin,ymin,zmin], "max": [xmax,ymax,zmax]}, "triangles": len(arrays[2])//3}
                if cached is not None:
                    cached["metrics"] = metrics
            metrics_ms += (time.perf_counter() - mark) * 1000
            prototype = (arrays, metrics)
            prototypes[id(shape)] = prototype
        arrays, metrics = prototype
        if item.get("transform") is not None:
            mark = time.perf_counter()
            matrix, location = instance_transform(item["transform"])
            rotation, translation = matrix[:, :3], matrix[:, 3]
            arrays = ((arrays[0].reshape(-1,3) @ rotation.T + translation).astype("<f4").ravel(),
                      (arrays[1].reshape(-1,3) @ rotation.T).astype("<f4").ravel(), arrays[2])
            shape = shape.moved(location)
            tessellation_ms += (time.perf_counter() - mark) * 1000
            mark = time.perf_counter()
            # Rendering bounds need containment, not repeated OCCT extrema
            # solving for every occurrence of an already measured prototype.
            lo, hi = metrics["bounds"]["min"], metrics["bounds"]["max"]
            corners = np.asarray([[x,y,z] for x in (lo[0],hi[0]) for y in (lo[1],hi[1]) for z in (lo[2],hi[2])])
            corners = corners @ rotation.T + translation
            metrics = {**metrics, "bounds": {"min": corners.min(axis=0).tolist(), "max": corners.max(axis=0).tolist()},
                       "boundsMethod": "transformed-prototype-aabb"}
            metrics_ms += (time.perf_counter() - mark) * 1000
        color = item.get("color", "#cb7952")
        if not re.fullmatch(r"#[a-fA-F0-9]{6}", color):
            raise ValueError(f"{name}: color must be #rrggbb")
        metadata = {"id": name, "name": str(item.get("name", name)), "color": color,
                    "geometryKey": hashlib.sha256(b"".join(a.tobytes() for a in arrays)).hexdigest(),
                    "metrics": metrics,
                    "p": len(arrays[0]), "n": len(arrays[1]), "i": len(arrays[2])}
        parts.append(metadata)
        meshes.append(arrays)
        exact.append({**item, "id": name, "shape": shape})
    mark = time.perf_counter()
    encode(parts, meshes, request["output"])
    encode_ms = (time.perf_counter() - mark) * 1000
    ctx.commit()
    last_parts = exact
    return {"runtime": IDENTITY, "revision": request["revision"], "timings": {
        "modelBuildMs": build_ms, "validationMs": validation_ms, "tessellationMs": tessellation_ms,
        "metricsMs": metrics_ms, "encodeMs": encode_ms,
        "totalMs": (time.perf_counter()-t)*1000, "cpuMs": (time.process_time()-cpu)*1000,
        "components": {"hits": ctx.hits, "diskHits": ctx.disk_hits, "misses": ctx.misses, "budgetedBytes": ctx.bytes, "workingSetBudgetedBytes": ctx.requested_bytes, "retained": len(ctx.cache), "limitBytes": 640*1024*1024},
        "uniquePrototypes": len(prototypes), "sceneBytes": os.path.getsize(request["output"])}}


emit({"ready": True, "runtime": IDENTITY, "startupMs": (time.perf_counter()-START)*1000})
for line in sys.stdin:
    request = None
    try:
        request = json.loads(line)
        if request["kind"] == "build":
            result = build(request)
        elif request["kind"] == "export":
            if not last_parts:
                raise ValueError("Build successfully before exporting")
            ids = request.get("ids")
            selected = last_parts if ids is None else [p for p in last_parts if p.get("id") in ids]
            if not selected or (ids is not None and set(ids) != {p.get("id") for p in selected}):
                raise ValueError("Unknown or empty export part selection")
            assembly = cq.Assembly(name="CadCove")
            for i, part in enumerate(selected):
                color = part.get("color", "#cb7952")
                assembly.add(part["shape"], name=str(i), color=cq.Color(*[int(color[n:n+2],16)/255 for n in (1,3,5)]))
            target = Path(request["output"])
            if target.suffix.lower() not in (".step", ".stp"):
                raise ValueError("Export output must be STEP")
            temp = str(target) + ".tmp.step"
            assembly.save(temp, exportType="STEP")
            os.replace(temp, target)
            result = {"output":str(target), "parts":len(selected), "bytes":target.stat().st_size}
        elif request["kind"] == "inspect":
            scope = {"cq": cq, "parts": last_parts, "ctx": ctx}
            exec(request["code"], scope)
            result = scope.get("result")
        else:
            raise ValueError("Unknown native CAD operation")
        emit({"id": request["id"], "result": result})
    except Exception as error:
        traceback.print_exc(file=sys.stderr)
        emit({"id": request.get("id") if request else None, "error": str(error)})
