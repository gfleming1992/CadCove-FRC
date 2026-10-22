"""Read standard STEP kinematics through OCCT; never infer absent motion metadata.

Entity IDs are positions in the decoded model, scoped to its file hash. They are
not persistent CAD occurrence IDs or necessarily the file's textual # labels.
No geometry transfer, mesh generation, unit guessing, or solver execution occurs.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path


def inspect_step(filename):
    try:
        from OCP import StepKinematics as K
    except ImportError as exc:
        raise RuntimeError("This OCP installation does not expose StepKinematics; use an explicitly configured compatible binding build") from exc
    from OCP.STEPControl import STEPControl_Reader
    from OCP.IFSelect import IFSelect_ReturnStatus
    from OCP.StepGeom import StepGeom_Axis2Placement3d

    source = Path(filename)
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    reader = STEPControl_Reader()
    if reader.ReadFile(str(source)) != IFSelect_ReturnStatus.IFSelect_RetDone:
        raise ValueError("OCCT could not read the STEP file")
    model = reader.StepModel()
    entities = [model.Value(i) for i in range(1, model.NbEntities() + 1)]
    # Handle identity works across wrappers; model.Number is not reliable for
    # all StepKinematics handles in the optional Python binding build.
    ids = {entity: f"entity:{i}" for i, entity in enumerate(entities, 1)}
    def ref(entity):
        if entity not in ids:
            raise ValueError("STEP reference is not in the decoded model")
        return ids[entity]
    def name(entity):
        value = entity.Name()
        return value.ToCString() if value else ""
    def finite(value):
        value = float(value)
        if not math.isfinite(value):
            raise ValueError("Non-finite STEP kinematics parameter")
        return value
    def placement(entity):
        if not isinstance(entity, StepGeom_Axis2Placement3d):
            return {"entity": ref(entity), "type": entity.DynamicType().Name(), "supported": False}
        # Preserve optional directions. Their standard defaults belong in a
        # later coordinate mapping, not an undocumented importer assumption.
        return {"entity": ref(entity), "type": "axis2Placement3d", "supported": True,
                "origin": [finite(v) for v in entity.Location().Coordinates()],
                "axis": [finite(v) for v in entity.Axis().DirectionRatios()] if entity.HasAxis() else None,
                "referenceDirection": [finite(v) for v in entity.RefDirection().DirectionRatios()] if entity.HasRefDirection() else None}

    links, pairs, values, representations, unsupported = [], [], [], [], []
    for entity in entities:
        typename = entity.DynamicType().Name()
        if isinstance(entity, K.StepKinematics_KinematicLink):
            links.append({"id": ref(entity), "name": name(entity)})
        elif isinstance(entity, K.StepKinematics_KinematicPair):
            joint = entity.Joint()
            transform = entity.ItemDefinedTransformation()
            record = {"id": ref(entity), "name": name(entity), "entityType": typename,
                      "joint": {"id": ref(joint), "name": name(joint)},
                      "links": [ref(joint.EdgeStart()), ref(joint.EdgeEnd())],
                      "frames": [placement(transform.TransformItem1()), placement(transform.TransformItem2())]}
            if isinstance(entity, K.StepKinematics_RevolutePair):
                record["kind"] = "revolute"
                suffix = "Rotation"
            elif isinstance(entity, K.StepKinematics_PrismaticPair):
                record["kind"] = "slider"
                suffix = "Translation"
            elif isinstance(entity, K.StepKinematics_GearPair):
                record.update(kind="gear", ratio=finite(entity.GearRatio()),
                              radii=[finite(entity.RadiusFirstLink()), finite(entity.RadiusSecondLink())],
                              helicalAngle=finite(entity.HelicalAngle()), bevel=finite(entity.Bevel()))
                suffix = None
            else:
                record["kind"] = "unsupported"
                suffix = None
                unsupported.append({"id": ref(entity), "type": typename})
            if suffix:
                record["freedoms"] = {key: bool(getattr(entity, key)()) for key in ("TX", "TY", "TZ", "RX", "RY", "RZ")}
                record["limits"] = {}
                for side in ("Lower", "Upper"):
                    key = side + "LimitActual" + suffix
                    if hasattr(entity, "Has" + key) and getattr(entity, "Has" + key)():
                        record["limits"][side.lower()] = finite(getattr(entity, key)())
            pairs.append(record)
        elif isinstance(entity, (K.StepKinematics_RevolutePairValue, K.StepKinematics_PrismaticPairValue)):
            rotational = isinstance(entity, K.StepKinematics_RevolutePairValue)
            values.append({"id": ref(entity), "pair": ref(entity.AppliesToPair()),
                           "kind": "rotation" if rotational else "translation",
                           "value": finite(entity.ActualRotation() if rotational else entity.ActualTranslation())})
        elif isinstance(entity, K.StepKinematics_KinematicLinkRepresentation):
            context = entity.ContextOfItems()
            representations.append({"id": ref(entity), "link": ref(entity.RepresentedLink()),
                                    "items": [ref(entity.ItemsValue(i)) for i in range(1, entity.NbItems() + 1)],
                                    "context": {"id": ref(context), "type": context.DynamicType().Name()}})
        elif typename.startswith("StepKinematics_") and not isinstance(entity, K.StepKinematics_KinematicJoint):
            unsupported.append({"id": ref(entity), "type": typename})
    if hashlib.sha256(source.read_bytes()).hexdigest() != digest:
        raise ValueError("STEP file changed during inspection")
    return {"schema": 1, "ok": True, "sourceSha256": digest, "entityCount": len(entities),
            "hasKinematics": bool(pairs), "links": links, "pairs": pairs, "values": values,
            "linkRepresentations": representations, "unsupportedEntities": unsupported,
            "coordinates": "Raw STEP representation coordinates; units and assembly context are not resolved",
            "solverReady": False, "geometryTransferred": False,
            "requiredBeforeSolving": ["Resolve representation units and reference frames", "Bind kinematic links to current CAD occurrences", "Map supported constraints and report all unsupported entities"]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        result = inspect_step(args.input)
        with open(args.output, "x") as stream:
            json.dump(result, stream, indent=2)
        print(json.dumps({"ok": True, "output": args.output, "hasKinematics": result["hasKinematics"], "pairs": len(result["pairs"]), "solverReady": False}))
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        raise SystemExit(1)
