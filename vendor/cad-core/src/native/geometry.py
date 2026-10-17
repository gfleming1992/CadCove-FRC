"""Shared native tessellation and portable WebGPU mesh encoding."""
import json
import os
import struct
import numpy as np
from OCP.BRep import BRep_Tool
from OCP.StdPrs import StdPrs_ToolTriangulatedShape
from OCP.TopAbs import TopAbs_REVERSED
from OCP.TopLoc import TopLoc_Location
from OCP.BRepMesh import BRepMesh_IncrementalMesh

def mesh(shape, tolerance=0.12, angular_tolerance=0.35):
    # CadQuery Shape.mesh defaults to relative deflection; match the viewer's
    # existing absolute 0.12 mm / 0.35 rad tessellation instead.
    BRepMesh_IncrementalMesh(shape.wrapped, tolerance, False, angular_tolerance, False)
    positions, normals, indices = [], [], []
    offset = 0
    for face in shape.Faces():
        loc = TopLoc_Location()
        poly = BRep_Tool.Triangulation_s(face.wrapped, loc)
        if poly is None:
            continue
        StdPrs_ToolTriangulatedShape.ComputeNormals_s(face.wrapped, poly)
        transform = loc.Transformation()
        reverse = face.wrapped.Orientation() == TopAbs_REVERSED
        for i in range(1, poly.NbNodes() + 1):
            p = poly.Node(i).Transformed(transform)
            n = poly.Normal(i).Transformed(transform)
            sign = -1 if reverse else 1
            positions.extend(p.Coord())
            normals.extend(sign * x for x in n.Coord())
        # Iterating OCP's returned TriangleArray copies/bridges excessively.
        # Indexed access avoids that overhead on plates with many small faces.
        for i in range(1, poly.NbTriangles() + 1):
            a, b, c = (v + offset - 1 for v in poly.Triangle(i).Get())
            indices.extend((a, c, b) if reverse else (a, b, c))
        offset += poly.NbNodes()
    return (np.asarray(positions, dtype="<f4"), np.asarray(normals, dtype="<f4"), np.asarray(indices, dtype="<u4"))


def encode(parts, meshes, output):
    header = json.dumps(parts, separators=(",", ":"), allow_nan=False).encode()
    if 12 + len(header) + sum(a.nbytes for arrays in meshes for a in arrays) > 512 * 1024 * 1024:
        raise ValueError("Native scene exceeds the 512 MiB scene cache limit")
    with open(output + ".tmp", "wb") as stream:
        stream.write(struct.pack("<II", 0x31444349, len(header)))
        stream.write(header)
        stream.write(b"\0" * (-(8 + len(header)) % 4))
        for arrays in meshes:
            for data in arrays:
                stream.write(data.tobytes())
    os.replace(output + ".tmp", output)

