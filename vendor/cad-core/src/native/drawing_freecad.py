"""Optional FreeCAD TechDraw backend. Run with FreeCADCmd and offscreen Qt.

No GUI interaction, user preferences, custom STEP parser or raster tracing.
A Qt scene is required by TechDraw's page exporters, even without a window.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import time
import traceback
from xml.sax.saxutils import escape


def run(root):
    import FreeCAD as App
    import FreeCADGui as Gui
    if hasattr(Gui,'showMainWindow'): Gui.showMainWindow()
    Gui.getMainWindow().hide()
    import Part
    import TechDrawGui
    from PySide import QtCore
    App.ParamGet('User parameter:BaseApp/Preferences/Units').SetInt('UserSchema',0)
    App.ParamGet('User parameter:BaseApp/Preferences/Mod/TechDraw/General').SetBool('DrawViewFrames',False)
    job=json.loads((root/'input.json').read_text());request=job['request']
    if hashlib.sha256((root/'geometry.brep').read_bytes()).hexdigest()!=job['geometrySha256']:
        raise ValueError('Drawing BREP hash mismatch')
    doc=App.newDocument('CadCoveDrawing')
    source=doc.addObject('PartDesign::Feature','SourcePart');shape=Part.Shape();shape.read(str(root/'geometry.brep'));source.Shape=shape
    if not source.Shape.isValid() or len(source.Shape.Solids)!=1: raise ValueError('Invalid drawing solid')
    page=doc.addObject('TechDraw::DrawPage','Page')
    template=doc.addObject('TechDraw::DrawSVGTemplate','Template')
    views={}
    specs={'top':((0,0,1),(1,0,0),70,140),'front':((0,-1,0),(1,0,0),70,65),'right':((1,0,0),(0,1,0),210,65),'isometric':((1,-1,1),(1,1,0),210,140)}
    # Layout fits projected geometry, reserving whitespace for dimensions.
    bounds=source.Shape.BoundBox
    corners=[App.Vector(x,y,z) for x in (bounds.XMin,bounds.XMax) for y in (bounds.YMin,bounds.YMax) for z in (bounds.ZMin,bounds.ZMax)]
    fit=10
    for normal,xaxis,_,_ in specs.values():
        n=App.Vector(*normal);n.normalize();x=App.Vector(*xaxis);x.normalize();y=n.cross(x)
        xs=[p.dot(x) for p in corners];ys=[p.dot(y) for p in corners]
        fit=min(fit,100/max(max(xs)-min(xs),1e-6),48/max(max(ys)-min(ys),1e-6))
    requested=request.get('scale','fit')
    choices=[.01,.02,.05,.1,.2,.25,.5,1,2,4,5,10]
    if fit < .01: raise ValueError('Part is too large for the A4 drawing template')
    scale=max(s for s in choices if s<=fit) if requested=='fit' else requested
    if scale>fit+1e-6: raise ValueError('Requested scale does not fit the page; use scale: fit or a smaller scale')
    page.Scale=scale
    title=escape(request.get('title',request['part']))
    # Original template; no redistributed FreeCAD templates or fonts.
    texts=[(12,184,title,5),(12,191,'CADCOVE  /  PART DRAWING',2.5),(12,197,'Dimensions in mm | Print at 100% | Orthographic views: third-angle arrangement',2.5),(225,184,'SCALE '+format(scale,'.4g')+':1  |  A4',3),(225,191,'SHEET 1 / 1',2.5),(225,197,'Source '+job['shapeHash'][:12],2.5),(70,114,'TOP',2.8),(70,175,'FRONT',2.8),(210,175,'RIGHT',2.8),(210,105,'ISOMETRIC',2.8)]
    for i,note in enumerate(request.get('notes',[])):texts.append((12,14+5*i,escape(note),2.8))
    svg='<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 297 210"><g fill="none" stroke="#263844" stroke-width="0.25"><rect x="7" y="7" width="283" height="196"/><path d="M7 178H290 M220 178V203"/></g><g font-family="Arial" fill="#172733">'
    svg+=''.join('<text x="%s" y="%s" font-size="%s">%s</text>'%(x,y,size,text) for x,y,text,size in texts)+'</g></svg>'
    (root/'template.svg').write_text(svg)
    template.Template=str(root/'template.svg');page.Template=template
    Gui.getDocument(doc.Name).getObject(page.Name).show()
    for name,(normal,xaxis,x,y) in specs.items():
        view=doc.addObject('TechDraw::DrawViewPart',name.capitalize());page.addView(view);view.Source=[source]
        view.Direction=normal;view.XDirection=xaxis;view.X=x;view.Y=y;view.HardHidden=False
        view.ViewObject.LineWidth=.25
        views[name]=view
    def settle():
        doc.recompute()
        deadline=time.monotonic()+30
        # HLR runs asynchronously. Process Qt events until all views finish.
        while time.monotonic()<deadline:
            loop=QtCore.QEventLoop();QtCore.QTimer.singleShot(100,loop.quit);loop.exec_()
            if all('Up-to-date' in v.State and v.getVisibleEdges() for v in views.values()):
                return
        raise RuntimeError('TechDraw projection timed out')
    settle()
    measured=[]
    for index,spec in enumerate(request.get('dimensions',[])):
        view=views[spec['view']]
        dim=doc.addObject('TechDraw::DrawViewDimension','Dimension'+str(index+1));page.addView(dim)
        dim.Type={'horizontal':'DistanceX','vertical':'DistanceY','distance':'Distance','diameter':'Diameter'}[spec['type']]
        if spec['type']=='diameter':
            center=App.Vector(*spec['center']);projected=view.projectPoint(center-view.getGeometricCenter())
            # Resolve a projected circular edge by geometric center and radius.
            matches=[]
            for i in range(len(view.getVisibleEdges())+len(view.getHiddenEdges())+32):
                try: edge=view.getEdgeByIndex(i)
                except Exception: continue
                curve=edge.Curve
                if isinstance(curve,Part.Circle) and abs(curve.Radius-spec['radiusMm'])<1e-5 and (curve.Center-projected).Length<1e-5:
                    matches.append(i)
            if len(matches)!=1: raise ValueError('Dimension '+spec['id']+' has missing or ambiguous projected circle')
            dim.References2D=[(view,['Edge'+str(matches[0])])]
            expected=2*spec['radiusMm']
        else:
            projected=[];refs=[]
            for point in spec['points']:
                target=view.projectPoint(App.Vector(*point)-view.getGeometricCenter());projected.append(target)
                candidates=[]
                for i in range(len(view.getVisibleVertexes())+len(view.getHiddenVertexes())+32):
                    try: vertex=view.getVertexByIndex(i)
                    except Exception: continue
                    if (vertex.Point-target).Length<1e-5:candidates.append(i)
                if not candidates: raise ValueError('Dimension '+spec['id']+' point is not a projected vertex')
                # Multiple depths can project to the same exact 2D point.
                refs.append('Vertex'+str(min(candidates)))
            dim.References2D=[(view,refs)]
            delta=projected[1]-projected[0]
            expected=abs(delta.x) if spec['type']=='horizontal' else abs(delta.y) if spec['type']=='vertical' else delta.Length
        if expected<1e-5: raise ValueError('Dimension '+spec['id']+' collapses in this view')
        dim.X=spec['positionMm'][0]-view.X.Value;dim.Y=spec['positionMm'][1]-view.Y.Value;dim.FormatSpec=('⌀%.2f' if spec['type']=='diameter' else '%.2f');dim.ShowUnits=False
        dim.ViewObject.Font='Arial';dim.ViewObject.Fontsize=3
        doc.recompute()
        actual=float(dim.getRawValue())
        if not math.isclose(actual,expected,rel_tol=1e-6,abs_tol=1e-5): raise ValueError('TechDraw dimension measurement mismatch: '+spec['id'])
        measured.append(dict(id=spec['id'],type=spec['type'],view=spec['view'],valueMm=actual))
    settle()
    source.Visibility=False
    doc.recompute()
    doc.saveAs(str(root/'drawing.FCStd'))
    TechDrawGui.exportPageAsSvg(page,str(root/'drawing.svg'))
    # TechDraw's direct PDF export can omit circles in offscreen Qt. Its SVG
    # includes the complete scene; render that vector page with Qt's PDF writer.
    from PySide import QtGui, QtSvg
    renderer=QtSvg.QSvgRenderer(str(root/'drawing.svg'))
    if not renderer.isValid(): raise RuntimeError('Invalid TechDraw SVG export')
    pdf=QtGui.QPdfWriter(str(root/'drawing.pdf'))
    pdf.setPageSize(QtGui.QPageSize(QtCore.QSizeF(297,210),QtGui.QPageSize.Millimeter))
    pdf.setPageMargins(QtCore.QMarginsF(0,0,0,0))
    pdf.setResolution(300)
    painter=QtGui.QPainter(pdf)
    if not painter.isActive(): raise RuntimeError('Could not start PDF writer')
    painter.fillRect(painter.viewport(),QtGui.QColor('white'))
    renderer.render(painter,QtCore.QRectF(0,0,pdf.width(),pdf.height()))
    painter.end()
    del pdf
    files={}
    for name in ('drawing.pdf','drawing.svg','drawing.FCStd'):
        data=(root/name).read_bytes()
        if len(data)<100: raise RuntimeError('Empty drawing export: '+name)
        files[name]=dict(bytes=len(data),sha256=hashlib.sha256(data).hexdigest())
    return dict(ok=True,backend='FreeCAD TechDraw',freecadVersion=App.Version()[:3],units='mm',page='A4 landscape',scale=scale,shapeHash=job['shapeHash'],dimensions=measured,files=files,reviewRequired=True)

if os.environ.get('CADCOVE_DRAWING_JOB'):
    root=Path(os.environ['CADCOVE_DRAWING_JOB'])
    try:
        result=run(root);code=0
    except Exception as error:
        result=dict(ok=False,error=str(error),traceback=traceback.format_exc());code=1
    (root/'result.json').write_text(json.dumps(result,indent=2))
    # Avoid a GUI event loop/dialog on shutdown in a headless subprocess.
    os._exit(code)
