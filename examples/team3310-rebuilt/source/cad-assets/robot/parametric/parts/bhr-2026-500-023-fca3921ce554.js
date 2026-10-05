import {fillet,getEdges,getBounds,facesOfEdge,normalAt,curvePointAt,cylinder,compound,cut,unwrap} from 'brepjs';
import {buildPrismaticPart} from '../profile.js';
// BHR-2026-500-023: U-shaped shaft clamp. Round the mounting ears before the small
// edge breaks; cross-drill afterward so the screw-hole mouths remain sharp.
export const parameters={holeScale:1,earRadius:3.175,edgeRadius:1};
export const profile={
  "origin": [
    0,
    0,
    324.1802
  ],
  "normal": [
    0,
    0,
    1
  ],
  "u": [
    1,
    0,
    0
  ],
  "v": [
    0,
    1,
    0
  ],
  "direction": [
    0,
    0,
    1
  ],
  "depth": 12.699999999999989,
  "outline": [
    {
      "kind": "line",
      "from": [
        -288.9893284422,
        -246.5231036
      ],
      "to": [
        -288.9893284422,
        -252.8731036
      ]
    },
    {
      "kind": "line",
      "from": [
        -304.8643284422,
        -252.8731036
      ],
      "to": [
        -288.9893284422,
        -252.8731036
      ]
    },
    {
      "kind": "arc",
      "from": [
        -304.8643284422,
        -252.8731036
      ],
      "mid": [
        -307.1093924725,
        -251.9431676303
      ],
      "to": [
        -308.0393284422,
        -249.6981036
      ]
    },
    {
      "kind": "line",
      "from": [
        -308.0393284422,
        -249.6981036
      ],
      "to": [
        -308.0393284422,
        -246.5231036
      ]
    },
    {
      "kind": "arc",
      "from": [
        -308.0393284422,
        -246.5231036
      ],
      "mid": [
        -314.3893284422,
        -240.1731036
      ],
      "to": [
        -320.7393284422,
        -246.5231036
      ]
    },
    {
      "kind": "line",
      "from": [
        -320.7393284422,
        -249.6981036
      ],
      "to": [
        -320.7393284422,
        -246.5231036
      ]
    },
    {
      "kind": "arc",
      "from": [
        -323.9143284422,
        -252.8731036
      ],
      "mid": [
        -321.6692644119,
        -251.9431676303
      ],
      "to": [
        -320.7393284422,
        -249.6981036
      ]
    },
    {
      "kind": "line",
      "from": [
        -339.7893284422,
        -252.8731036
      ],
      "to": [
        -323.9143284422,
        -252.8731036
      ]
    },
    {
      "kind": "line",
      "from": [
        -339.7893284422,
        -246.5231036
      ],
      "to": [
        -339.7893284422,
        -252.8731036
      ]
    },
    {
      "kind": "line",
      "from": [
        -329.9435883089,
        -246.5231036
      ],
      "to": [
        -339.7893284422,
        -246.5231036
      ]
    },
    {
      "kind": "arc",
      "from": [
        -329.9435883089,
        -246.5231036
      ],
      "mid": [
        -327.9355419947,
        -245.8074480248
      ],
      "to": [
        -326.8327363356,
        -243.9831036
      ]
    },
    {
      "kind": "arc",
      "from": [
        -301.9459205489,
        -243.9831036
      ],
      "mid": [
        -314.3893284422,
        -233.8231036
      ],
      "to": [
        -326.8327363355,
        -243.9831036
      ]
    },
    {
      "kind": "arc",
      "from": [
        -301.9459205489,
        -243.9831036
      ],
      "mid": [
        -300.8431148898,
        -245.8074480248
      ],
      "to": [
        -298.8350685756,
        -246.5231036
      ]
    },
    {
      "kind": "line",
      "from": [
        -288.9893284422,
        -246.5231036
      ],
      "to": [
        -298.8350685756,
        -246.5231036
      ]
    }
  ],
  "cutouts": []
};
export const holes=[
  {
    "radius": 2.286,
    "at": [
      -295.3393284422,
      -246.52310359999998,
      330.5302
    ],
    "axis": [
      0,
      -1,
      0
    ],
    "length": 6.350000000000001
  },
  {
    "radius": 2.286,
    "at": [
      -333.4393284422,
      -246.52310359999998,
      330.5302
    ],
    "axis": [
      0,
      -1,
      0
    ],
    "length": 6.350000000000001
  }
];
export default function build({holeScale=parameters.holeScale,earRadius=parameters.earRadius,edgeRadius=parameters.edgeRadius}={}){
 if(![holeScale,earRadius,edgeRadius].every(v=>Number.isFinite(v)&&v>0))throw Error('Hole scale and round radii must be positive');
 let shape=buildPrismaticPart(profile);const bounds=getBounds(shape);
 const earEdges=getEdges(shape).filter(e=>{const box=getBounds(e);return box.xMax-box.xMin<1e-5&&box.zMax-box.zMin<1e-5&&(Math.abs(box.xMin-bounds.xMin)<1e-5||Math.abs(box.xMin-bounds.xMax)<1e-5);});
 shape=unwrap(fillet(shape,earEdges,earRadius));
 const sharpEdges=getEdges(shape).filter(e=>{const faces=facesOfEdge(shape,e);if(faces.length!==2)return false;
  const point=curvePointAt(e,.5),normals=faces.map(f=>normalAt(f,point));
  return Math.abs(normals[0].reduce((sum,v,i)=>sum+v*normals[1][i],0))<.999;
 });
 shape=unwrap(fillet(shape,sharpEdges,edgeRadius));
 return unwrap(cut(shape,compound(holes.map(h=>cylinder(h.radius*holeScale,h.length+.00002,{at:h.at.map((v,i)=>v-h.axis[i]*.00001),axis:h.axis})))));
}
