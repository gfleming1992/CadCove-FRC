import {cylinder,cone,compound,cut,unwrap} from 'brepjs';
import {buildPrismaticPart} from '../profile.js';
// Rounded hex drive shaft. Coaxial stepped bores retain the drill-point transitions.
// Change bore radii together so the mounting bores meet the core hole continuously.
export const parameters={boreRadiusScale:1};
export const profile={
  "origin": [
    0,
    -213.1856036,
    0
  ],
  "normal": [
    0,
    1,
    0
  ],
  "u": [
    0,
    0,
    1
  ],
  "v": [
    1,
    0,
    0
  ],
  "direction": [
    0,
    1,
    0
  ],
  "depth": 79.375,
  "outline": [
    {
      "kind": "line",
      "from": [
        358.9000428556,
        -68.0017402825
      ],
      "to": [
        361.53370537,
        -63.4401029976
      ]
    },
    {
      "kind": "arc",
      "from": [
        361.53370537,
        -63.4401029976
      ],
      "mid": [
        362.2791091128,
        -62.9422704718
      ],
      "to": [
        363.0829465984,
        -62.5456481573
      ]
    },
    {
      "kind": "line",
      "from": [
        363.0829465984,
        -62.5456481574
      ],
      "to": [
        368.3502716272,
        -62.5456481574
      ]
    },
    {
      "kind": "arc",
      "from": [
        368.3502716272,
        -62.5456481573
      ],
      "mid": [
        369.1541091128,
        -62.9422704718
      ],
      "to": [
        369.8995128556,
        -63.4401029976
      ]
    },
    {
      "kind": "line",
      "from": [
        369.8995128556,
        -63.4401029976
      ],
      "to": [
        372.53317537,
        -68.0017402825
      ]
    },
    {
      "kind": "arc",
      "from": [
        372.53317537,
        -68.0017402825
      ],
      "mid": [
        372.5916091128,
        -68.8961951228
      ],
      "to": [
        372.53317537,
        -69.7906499631
      ]
    },
    {
      "kind": "line",
      "from": [
        372.53317537,
        -69.7906499631
      ],
      "to": [
        369.8995128556,
        -74.352287248
      ]
    },
    {
      "kind": "arc",
      "from": [
        369.8995128556,
        -74.352287248
      ],
      "mid": [
        369.1541091128,
        -74.8501197738
      ],
      "to": [
        368.3502716272,
        -75.2467420882
      ]
    },
    {
      "kind": "line",
      "from": [
        368.3502716272,
        -75.2467420882
      ],
      "to": [
        363.0829465984,
        -75.2467420882
      ]
    },
    {
      "kind": "arc",
      "from": [
        363.0829465984,
        -75.2467420882
      ],
      "mid": [
        362.2791091128,
        -74.8501197738
      ],
      "to": [
        361.53370537,
        -74.352287248
      ]
    },
    {
      "kind": "line",
      "from": [
        361.53370537,
        -74.352287248
      ],
      "to": [
        358.9000428556,
        -69.7906499631
      ]
    },
    {
      "kind": "arc",
      "from": [
        358.9000428556,
        -69.7906499631
      ],
      "mid": [
        358.8416091128,
        -68.8961951228
      ],
      "to": [
        358.9000428556,
        -68.0017402825
      ]
    }
  ],
  "cutouts": []
};
export const bores=[
  {
    "radius": 2,
    "at": [
      -68.89619512279484,
      -193.376175863611,
      365.71660911276985
    ],
    "length": 39.756144527222006
  },
  {
    "radius": 3.2639,
    "at": [
      -68.89619512279484,
      -213.1856036,
      365.71660911276985
    ],
    "length": 19.05000000000001
  },
  {
    "radius": 3.2639,
    "at": [
      -68.89619512279484,
      -152.86060360000002,
      365.71660911276985
    ],
    "length": 19.05000000000001
  }
];
export const transitions=[
  {
    "at": [
      -68.89619512279484,
      -194.1356036,
      365.71660911276985
    ],
    "length": 0.7594277363890001,
    "r1": 3.2638999999998077,
    "r2": 1.9999999999987494
  },
  {
    "at": [
      -68.89619512279484,
      -153.620031336389,
      365.71660911276985
    ],
    "length": 0.7594277363890001,
    "r1": 1.9999999999990905,
    "r2": 3.263900000000149
  }
];
export default function build({boreRadiusScale=parameters.boreRadiusScale}={}) {
 if(!Number.isFinite(boreRadiusScale)||boreRadiusScale<=0)throw Error('Bore radius scale must be positive');
 const tools=[...bores.map(h=>cylinder(h.radius*boreRadiusScale,h.length+.00002,{at:h.at.map((v,i)=>v-(i===1?.00001:0)),axis:[0,1,0]})),...transitions.map(h=>cone(h.r1*boreRadiusScale,h.r2*boreRadiusScale,h.length,{at:h.at,axis:[0,1,0]}))];
 return unwrap(cut(buildPrismaticPart(profile),compound(tools)));
}
