"""Explicit developer build of the pinned, unmodified shared solver and bridge."""
import argparse
import json
from pathlib import Path
import subprocess
import shutil

here=Path(__file__).resolve().parent
pin=json.loads((here/'upstream.json').read_text())
p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--jobs',type=int,default=4);args=p.parse_args()
root=Path(args.output).resolve()
if root.exists(): raise SystemExit('Choose a new build directory; existing builds are never replaced')
if not 1<=args.jobs<=32: raise SystemExit('jobs must be 1–32')
root.mkdir(parents=True)
def run(*argv): subprocess.run(list(map(str,argv)),check=True)
source=root/'source';build=root/'library';bridge=root/'bridge'
run('git','init',source)
run('git','-C',source,'remote','add','origin',pin['repository'])
run('git','-C',source,'fetch','--depth','1','origin',pin['revision'])
run('git','-C',source,'checkout','--detach',pin['revision'])
actual=subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip()
if actual!=pin['revision']: raise SystemExit('Upstream pin mismatch')
run('cmake','-S',source,'-B',build,'-DCMAKE_BUILD_TYPE=Release','-DONDSELSOLVER_BUILD_EXE=OFF','-DONDSELSOLVER_BUILD_TESTS=OFF')
run('cmake','--build',build,'--config','Release','--parallel',args.jobs)
libs=list(build.rglob('libOndselSolver.dylib'))+list(build.rglob('libOndselSolver.so'))
if len(libs)!=1: raise SystemExit('Expected one shared library. This build path is currently supported on macOS/Linux only; no static fallback.')
run('cmake','-S',here,'-B',bridge,'-DCMAKE_BUILD_TYPE=Release','-DONDSEL_SOURCE='+str(source),'-DONDSEL_LIBRARY='+str(libs[0]))
run('cmake','--build',bridge,'--config','Release','--parallel',args.jobs)
shutil.copy(source/'LICENSE',root/'ONDSEL-LICENSE.txt')
(root/'provenance.json').write_text(json.dumps({**pin,'source':str(source),'library':str(libs[0]),'bridge':str(bridge/'cadcove-ondsel'),'distributionQualified':False},indent=2))
print('Set CADCOVE_MATE_SOLVER='+str(bridge/'cadcove-ondsel'))
