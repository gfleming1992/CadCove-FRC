import {bezier,threePointArc,wireLoop,face,extrude,cylinder,cone,cut,fuseAll,unwrap} from 'brepjs';
import {buildPrismaticPart} from '../profile.js';
// Source curve coefficients and independent mass/surface checks verified.
// 26-tooth belt pulley with a 15-spline motor shaft bore and retaining flanges.
// The six cubic spans preserve one original spline flank pair exactly; the
// circular pattern makes the fit editable without duplicating 15 sets of data.
export const parameters={boreScale:1};
export const toothProfile={
  "origin": [
    0,
    0,
    -5.143500000000001
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
  "depth": 10.287000000000003,
  "outline": [
    {
      "kind": "arc",
      "from": [
        18.1809672255,
        1.0227005304
      ],
      "mid": [
        17.3924010364,
        2.1118198268
      ],
      "to": [
        17.8974096173,
        3.3580075373
      ]
    },
    {
      "kind": "arc",
      "from": [
        17.8974096173,
        3.3580075373
      ],
      "mid": [
        18.5356564414,
        3.7331018189
      ],
      "to": [
        19.2557694878,
        3.9048339621
      ]
    },
    {
      "kind": "arc",
      "from": [
        19.6296651591,
        4.4154709902
      ],
      "mid": [
        19.5587745457,
        4.0751737327
      ],
      "to": [
        19.2557694878,
        3.9048339621
      ]
    },
    {
      "kind": "arc",
      "from": [
        19.4331769813,
        5.2126548646
      ],
      "mid": [
        19.5354878248,
        4.8150652923
      ],
      "to": [
        19.6296651591,
        4.4154709902
      ]
    },
    {
      "kind": "arc",
      "from": [
        18.8648039467,
        5.4910435156
      ],
      "mid": [
        19.2122624395,
        5.481028611
      ],
      "to": [
        19.4331769813,
        5.2126548645
      ]
    },
    {
      "kind": "arc",
      "from": [
        18.8648039467,
        5.4910435156
      ],
      "mid": [
        18.1473676043,
        5.3084515575
      ],
      "to": [
        17.4079131037,
        5.3439729607
      ]
    }
  ],
  "cutouts": []
};
export const splineSegments=[
  [
    [
      3.534754809102,
      -0.477537807437
    ],
    [
      3.6741781165850003,
      -0.4356234667580002
    ],
    [
      3.8040116138311273,
      -0.3684559502606007
    ],
    [
      3.933139231098628,
      -0.30084594207773446
    ]
  ],
  [
    [
      3.933139231098628,
      -0.30084594207773446
    ],
    [
      3.9977030397321918,
      -0.26704093798640066
    ],
    [
      4.062090378371093,
      -0.23312531097370004
    ],
    [
      4.117085194592715,
      -0.18296588347384896
    ]
  ],
  [
    [
      4.117085194592715,
      -0.18296588347384896
    ],
    [
      4.172080010814334,
      -0.1328064559739976
    ],
    [
      4.217682304618667,
      -0.06640322798699526
    ],
    [
      4.217682304618666,
      4.7253867485608225e-15
    ]
  ],
  [
    [
      4.217682304618666,
      4.7253867485608225e-15
    ],
    [
      4.21768230461867,
      0.0664032279870051
    ],
    [
      4.172080010814331,
      0.13280645597400206
    ],
    [
      4.117085194592745,
      0.18296588347383547
    ]
  ],
  [
    [
      4.117085194592745,
      0.18296588347383547
    ],
    [
      4.062090378371153,
      0.23312531097366826
    ],
    [
      3.99770303973231,
      0.26704093798633693
    ],
    [
      3.933139231098706,
      0.3008459420776357
    ]
  ],
  [
    [
      3.933139231098706,
      0.3008459420776357
    ],
    [
      3.8040116138308773,
      0.3684559502605592
    ],
    [
      3.6741781165839993,
      0.43562346675799984
    ],
    [
      3.534754809102,
      0.477537807437
    ]
  ]
];
export const rings=[
  {
    "r": 22.225,
    "at": [
      -5.9330318435968366e-12,
      5.784648648376497e-15,
      5.1434999999999995
    ],
    "length": 1.2128500000000004
  },
  {
    "r": 22.225,
    "at": [
      -5.9330318435968366e-12,
      5.784648648376497e-15,
      -6.35635
    ],
    "length": 1.2128500000000004
  }
];
export const cones=[
  {
    "at": [
      -5.9330318435968366e-12,
      5.644671519233972e-15,
      -7.150100000000903
    ],
    "length": 0.7937500000009035,
    "r1": 19.9390000000003,
    "r2": 22.225
  },
  {
    "at": [
      -5.9330318435968366e-12,
      5.644671519233953e-15,
      6.356349999999097
    ],
    "length": 0.7937500000009035,
    "r1": 22.224999999999703,
    "r2": 19.939
  }
];
const rotate=([x,y],angle)=>[x*Math.cos(angle)-y*Math.sin(angle),x*Math.sin(angle)+y*Math.cos(angle)];
export function buildBore({boreScale=1}={}){
 const bottom=-7.1501-.00001,point=p=>[p[0]*boreScale,p[1]*boreScale,bottom],edges=[];
 const pitch=2*Math.PI/15,start=splineSegments[0][0],end=splineSegments.at(-1)[3],radius=Math.hypot(...end);
 for(let i=0;i<15;i++){
  const angle=i*pitch;
  for(const segment of splineSegments)edges.push(unwrap(bezier(segment.map(p=>point(rotate(p,angle))))));
  const middle=[radius*Math.cos(angle+pitch/2),radius*Math.sin(angle+pitch/2)];
  edges.push(threePointArc(point(rotate(end,angle)),point(middle),point(rotate(start,angle+pitch))));
 }
 return unwrap(extrude(unwrap(face(unwrap(wireLoop(edges)))),[0,0,14.3002+.00002]));
}
export function buildStock(){
 const outline=Array.from({length:26},(_,i)=>toothProfile.outline.map(e=>({...e,from:rotate(e.from,i*2*Math.PI/26),mid:rotate(e.mid,i*2*Math.PI/26),to:rotate(e.to,i*2*Math.PI/26)}))).flat();
 return unwrap(fuseAll([buildPrismaticPart({...toothProfile,outline}),...rings.map(h=>cylinder(h.r,h.length,{at:h.at})),...cones.map(h=>cone(h.r1,h.r2,h.length,{at:h.at}))]));
}
export default function build({boreScale=parameters.boreScale}={}){
 if(!Number.isFinite(boreScale)||boreScale<=0)throw Error('Bore scale must be positive');
 return unwrap(cut(buildStock(),buildBore({boreScale})));
}
