"""Explicit homogeneous-solid mass properties for CadQuery or imported STEP shapes.

Input shape coordinates are mm, density is kg/m³. Returned inertia is about
COM in the shape's current frame. No density or material is inferred.
"""
import math

def mass_properties(shape, density_kg_m3, evidence):
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps
    if isinstance(density_kg_m3, bool) or not isinstance(density_kg_m3, (int,float)) or not math.isfinite(density_kg_m3) or density_kg_m3 <= 0:
        raise ValueError('Supply a positive finite density in kg/m^3')
    if not isinstance(evidence,str) or not evidence.strip():
        raise ValueError('Density provenance is required')
    if not shape.isValid() or not shape.Solids():
        raise ValueError('Mass properties require valid solid geometry')
    props=GProp_GProps()
    BRepGProp.VolumeProperties_s(shape.wrapped, props, 1e-7, True, False)
    volume=props.Mass()
    if not math.isfinite(volume) or volume<=0:
        raise ValueError('Nonpositive solid volume')
    center=props.CentreOfMass(); matrix=props.MatrixOfInertia()
    tensor=[matrix.Value(i,j)*density_kg_m3*1e-15 for i,j in [(1,1),(2,2),(3,3),(1,2),(1,3),(2,3)]]
    return {'mass':volume*density_kg_m3*1e-9,'center':[v/1000 for v in center.Coord()],
            'tensor':tensor,'provenance':{'status':'derived','evidence':evidence},
            'assumptions':['homogeneous density','shape frame','inertia about center of mass'],
            'densityKgM3':density_kg_m3}
