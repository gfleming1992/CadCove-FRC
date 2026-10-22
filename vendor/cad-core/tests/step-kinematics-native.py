import math
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src/native"))
from step_kinematics import inspect_step
from OCP import StepKinematics as K
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeVertex
from OCP.GeomToStep import GeomToStep_MakeAxis2Placement3d
from OCP.gp import gp_Ax2, gp_Pnt, gp_Dir
from OCP.StepData import StepData_Factors
from OCP.STEPControl import STEPControl_Writer, STEPControl_AsIs
from OCP.IFSelect import IFSelect_ReturnStatus
from OCP.TCollection import TCollection_HAsciiString as S


def fixture(file, kinematics):
    writer = STEPControl_Writer()
    assert writer.Transfer(BRepBuilderAPI_MakeVertex(gp_Pnt()).Vertex(), STEPControl_AsIs) == IFSelect_ReturnStatus.IFSelect_RetDone
    if kinematics:
        a, b = K.StepKinematics_KinematicLink(), K.StepKinematics_KinematicLink()
        # Duplicate names deliberately ensure reference identity is preserved.
        a.Init(S("shaft")); b.Init(S("shaft"))
        joint = K.StepKinematics_KinematicJoint(); joint.Init(S("hinge"), a, b)
        frame = GeomToStep_MakeAxis2Placement3d(gp_Ax2(gp_Pnt(10, 20, 30), gp_Dir(0, 1, 0)), StepData_Factors()).Value()
        common = (S("test"), S("placement"), False, S(""), frame, frame, joint)
        revolute = K.StepKinematics_RevolutePairWithRange()
        revolute.Init(*common, False, False, False, False, False, True, True, -math.pi/2, True, math.pi/2)
        value = K.StepKinematics_RevolutePairValue(); value.Init(S("pose"), revolute, .25)
        slider = K.StepKinematics_PrismaticPair(); slider.Init(*common, False, False, True, False, False, False)
        gear = K.StepKinematics_GearPair(); gear.Init(*common, 12, 24, 0, 0, 2)
        unsupported = K.StepKinematics_CylindricalPair(); unsupported.Init(*common, False, False, True, False, False, True)
        for item in (revolute, value, slider, gear, unsupported): writer.Model().AddWithRefs(item)
    assert writer.Write(str(file)) == IFSelect_ReturnStatus.IFSelect_RetDone


with tempfile.TemporaryDirectory() as temp:
    file = Path(temp) / "assembly.step"
    fixture(file, True)
    report = inspect_step(file)
    assert report["hasKinematics"] and not report["solverReady"] and not report["geometryTransferred"]
    assert len(report["links"]) == 2 and report["links"][0]["id"] != report["links"][1]["id"]
    assert report["links"][0]["name"] == report["links"][1]["name"]
    revolute = next(p for p in report["pairs"] if p["kind"] == "revolute")
    assert set(revolute["links"]) == {link["id"] for link in report["links"]}
    assert abs(revolute["limits"]["upper"]-math.pi/2) < 1e-10
    assert revolute["frames"][0]["origin"] == [10, 20, 30]
    assert revolute["frames"][0]["axis"] == [0, 1, 0]
    assert report["values"][0]["pair"] == revolute["id"] and report["values"][0]["value"] == .25
    assert next(p for p in report["pairs"] if p["kind"] == "gear")["ratio"] == 2
    assert next(p for p in report["pairs"] if p["kind"] == "slider")["freedoms"]["TZ"]
    assert any(p["type"].endswith("CylindricalPair") for p in report["unsupportedEntities"])
    assert inspect_step(file) == report
    plain = Path(temp) / "plain.step"; fixture(plain, False)
    empty = inspect_step(plain)
    assert not empty["hasKinematics"] and empty["pairs"] == [] and empty["links"] == []
    bad = Path(temp) / "bad.step"; bad.write_text("This is not STEP")
    try: inspect_step(bad)
    except ValueError: pass
    else: raise AssertionError("Invalid STEP accepted")
print("STEP kinematics native inspection tests passed")
