import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src/native'))
import cadquery as cq
from physical_properties import mass_properties
p=mass_properties(cq.Workplane().box(100,200,300).val(),1000,'known test density')
assert abs(p['mass']-6)<1e-7,p
for got,want in zip(p['tensor'],[.065,.05,.025,0,0,0]):assert abs(got-want)<1e-7,(got,want)
try:mass_properties(cq.Workplane().box(1,1,1).val(),0,'invalid')
except ValueError:pass
else:raise AssertionError('accepted zero density')
print('mass properties: analytic box and invalid density passed')
