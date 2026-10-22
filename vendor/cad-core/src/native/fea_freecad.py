"""Optional headless FreeCAD/Gmsh/CalculiX backend; no third-party code bundled.

Launched with an isolated FreeCAD configuration and CADCOVE_FEA_JOB directory.
Input is exported by fea_geometry from the current CadQuery solid. mm/N/MPa.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import traceback


def execute(root):
    import FreeCAD as App
    import Part
    import ObjectsFem
    from femmesh.gmshtools import GmshTools
    from femtools.ccxtools import FemToolsCcx
    request=json.loads((root/'input.json').read_text())
    geometry=request['geometry'];brep=root/geometry['file']
    if hashlib.sha256(brep.read_bytes()).hexdigest()!=geometry['sha256']:
        raise ValueError('Analysis BREP hash mismatch')
    shape=Part.Shape();shape.read(str(brep))
    if not shape.isValid() or len(shape.Solids)!=1 or len(shape.Faces)!=geometry['faces'] or abs(shape.Volume-geometry['volumeMm3'])>max(1e-6,geometry['volumeMm3']*1e-8):
        raise ValueError('Geometry changed in FreeCAD transfer')
    faces={}
    for name,ref in request['references'].items():
        matches=[];q=ref['query'];tol=q.get('toleranceMm',1e-5)
        for i,face in enumerate(shape.Faces):
            if math.dist(list(face.CenterOfMass),ref['centerMm'])>tol or abs(face.Area-ref['areaMm2'])>max(1e-6,ref['areaMm2']*1e-8):continue
            if q['kind']=='plane':
                if not isinstance(face.Surface,Part.Plane):continue
                u0,u1,v0,v1=face.ParameterRange
                normal=list(face.normalAt((u0+u1)/2,(v0+v1)/2));axis=q['axis'];norm=math.sqrt(sum(x*x for x in axis))
                if 1-sum(a*b/norm for a,b in zip(axis,normal))>1e-10:continue
            elif q['kind']=='cylinder':
                if not isinstance(face.Surface,Part.Cylinder) or abs(face.Surface.Radius-q['radius'])>tol:continue
            else:raise ValueError('Unsupported boundary kind')
            matches.append('Face'+str(i+1))
        if len(matches)!=1:raise ValueError('Boundary changed or ambiguous after transfer: '+name)
        faces[name]=matches[0]
    analysis=request['analysis'];material=analysis['parts'][0]['material'];runs=[]
    for index,size in enumerate(request['mesh']['sizesMm']):
        folder=root/('mesh-'+str(index));folder.mkdir()
        doc=App.newDocument('CadCoveAnalysis'+str(index))
        try:
            solid=doc.addObject('Part::Feature','AnalyzedPart');solid.Shape=shape
            group=ObjectsFem.makeAnalysis(doc,'Analysis')
            solver=ObjectsFem.makeSolverCalculiXCcxTools(doc,'Solver')
            solver.AnalysisType='static';solver.GeometricalNonlinearity='linear';solver.SplitInputWriter=False
            group.addObject(solver)
            mat=ObjectsFem.makeMaterialSolid(doc,'Material')
            mat.Material={'Name':material['name'],'YoungsModulus':str(material['youngsModulusMPa'])+' MPa','PoissonRatio':str(material['poissonRatio'])}
            group.addObject(mat)
            for s in analysis['supports']:
                fixed=ObjectsFem.makeConstraintFixed(doc,'Support');fixed.References=[(solid,faces[s['reference']])];group.addObject(fixed)
            for load in analysis['loads']:
                force=ObjectsFem.makeConstraintForce(doc,'Force');force.References=[(solid,faces[load['reference']])]
                magnitude=math.sqrt(sum(v*v for v in load['forceN']))
                force.Force=str(magnitude)+' N'
                # FreeCAD recomputes DirectionVector from Direction. Supply an
                # explicit datum edge; setting DirectionVector alone silently
                # reverts to the loaded face normal on recompute.
                direction=doc.addObject('Part::Feature','ForceDirection')
                direction.Shape=Part.makeLine(App.Vector(0,0,0),App.Vector(*[v/magnitude for v in load['forceN']]))
                force.Direction=(direction,['Edge1']);force.Reversed=False
                group.addObject(force)
            mesh=ObjectsFem.makeMeshGmsh(doc,'Mesh');mesh.Shape=solid;group.addObject(mesh)
            mesh.CharacteristicLengthMax=size;mesh.CharacteristicLengthMin=size/2
            mesh.ElementOrder='2nd';mesh.SecondOrderLinear=False;mesh.WorkingDirectory=str(folder)
            doc.recompute()
            for constraint,load in zip([obj for obj in group.Group if obj.TypeId=='Fem::ConstraintForce'],analysis['loads']):
                v=load['forceN'];n=math.sqrt(sum(x*x for x in v))
                if math.dist(list(constraint.DirectionVector),[x/n for x in v])>1e-8:
                    raise ValueError('FreeCAD force direction differs from requested CAD vector')
            App.ParamGet('User parameter:BaseApp/Preferences/Mod/Fem/Gmsh').SetString('gmshBinaryPath',os.environ['CADCOVE_GMSH'])
            mesher=GmshTools(mesh);mesher.prepare()
            with open(folder/'gmsh.log','w') as log:
                subprocess.run([os.environ['CADCOVE_GMSH'],'-v','3','-',mesher.temp_file_geo],stdout=log,stderr=subprocess.STDOUT,check=True,timeout=120)
            mesher.update_properties()
            if not 1<=mesh.FemMesh.NodeCount<=250000 or mesh.FemMesh.VolumeCount==0:
                raise ValueError('Empty or oversized volume mesh')
            tool=FemToolsCcx(analysis=group,solver=solver);tool.update_objects();tool.setup_working_dir(str(folder));tool.setup_ccx(os.environ['CADCOVE_CCX'])
            error=tool.check_prerequisites()
            if error:raise ValueError(str(error))
            tool.write_inp_file()
            inp=Path(tool.inp_file_name)
            if not inp.is_file():raise ValueError('No CalculiX input generated')
            with open(folder/'calculix.log','w') as log:
                subprocess.run([os.environ['CADCOVE_CCX'],'-i',inp.stem],cwd=str(inp.parent),stdout=log,stderr=subprocess.STDOUT,check=True,timeout=120)
            logtext=(folder/'calculix.log').read_text()
            if '*ERROR' in logtext.upper():raise ValueError('CalculiX reported an error; see calculix.log')
            tool.load_results()
            results=[obj for obj in doc.Objects if hasattr(obj,'DisplacementLengths') and len(obj.DisplacementLengths)]
            if len(results)!=1:raise ValueError('Expected one complete static result')
            result=results[0];disp=list(result.DisplacementLengths);stress=list(result.vonMises)
            if len(disp)!=len(stress) or not stress or not all(math.isfinite(x) and x>=0 for x in disp+stress):raise ValueError('Invalid result fields')
            row=dict(sizeMm=size,nodes=mesh.FemMesh.NodeCount,elements=mesh.FemMesh.VolumeCount,maxDisplacementMm=max(disp),maxVonMisesMPa=max(stress))
            if 'safetyFactor' in analysis['outputs']:
                if max(stress)<=0:raise ValueError('Cannot calculate yield factor for zero stress')
                row['minimumYieldSafetyFactor']=material['yieldStrengthMPa']/max(stress)
            doc.recompute();doc.saveAs(str(folder/'analysis.FCStd'))
            (folder/'nodal-results.json').write_text(json.dumps(dict(nodeNumbers=list(result.NodeNumbers),displacementsMm=[list(v) for v in result.DisplacementVectors],vonMisesMPa=stress),allow_nan=False))
            runs.append(row)
        finally:App.closeDocument(doc.Name)
    a,b=runs[-2:];metrics=['maxDisplacementMm'] if 'displacement' in analysis['outputs'] else []
    if any(k in analysis['outputs'] for k in ('stress','safetyFactor')):metrics.append('maxVonMisesMPa')
    changes={k:abs(b[k]-a[k])/max(abs(b[k]),1e-15) for k in metrics}
    refined=b['nodes']>a['nodes'];converged=refined and all(v<=request['mesh']['relativeTolerance'] for v in changes.values())
    return dict(ok=True,solved=True,stage='solved',backend='FreeCAD/Gmsh/CalculiX',freecad=App.Version(),guiUp=App.GuiUp,
                units='mm-N-MPa',shapeHash=analysis['parts'][0]['shapeHash'],runs=runs,
                convergence=dict(passed=converged,meshRefined=refined,relativeChanges=changes,tolerance=request['mesh']['relativeTolerance'],scope='Requested global extrema over the last two meshes only'),
                engineeringValidated=False,assumptions=analysis.get('assumptions',[]),
                limitations=['Linear elastic static, single solid, fully fixed supports and distributed face forces only','Support edges may have stress singularities; convergence of global maxima is not guaranteed','Results require load, restraint, local mesh and engineering review'])


# FreeCADCmd executes Python files in its console namespace, not __main__.
if os.environ.get('CADCOVE_FEA_JOB'):
    root=Path(os.environ['CADCOVE_FEA_JOB']).resolve()
    try:report=execute(root)
    except Exception as error:
        traceback.print_exc();report=dict(ok=False,solved=False,error=str(error))
    with open(root/'result.json','x') as f:json.dump(report,f,indent=2,allow_nan=False)
    print(json.dumps(report,allow_nan=False),flush=True)
