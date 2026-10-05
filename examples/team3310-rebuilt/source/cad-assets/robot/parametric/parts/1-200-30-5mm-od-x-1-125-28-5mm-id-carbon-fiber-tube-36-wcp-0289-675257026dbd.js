import {cut,compound,unwrap} from 'brepjs';
import {buildPrismaticPart} from '../profile.js';
// 1.200" (30.5mm) OD x .1.125" (28.5mm) ID (Carbon Fiber Tube, 36") (WCP-0289): extruded stock, cross-drilling, and explicit machined pockets.
// The catalog name describes uncut vendor stock; depth is the actual team cut length.
// Cross-drilled holes retain the roller/hub mounting pattern.
// Hole and pocket positions are fixed in the original part coordinate system.
export const parameters={depth:104.514396,holeScale:1};
export const stock={
  "origin": [
    -52.257198,
    0,
    0
  ],
  "normal": [
    1,
    0,
    0
  ],
  "u": [
    0,
    1,
    0
  ],
  "v": [
    0,
    0,
    1
  ],
  "direction": [
    1,
    0,
    0
  ],
  "depth": 104.514396,
  "outline": [
    {
      "kind": "circle",
      "center": [
        0,
        0
      ],
      "radius": 15.24
    }
  ],
  "cutouts": [
    [
      {
        "kind": "circle",
        "center": [
          0,
          0
        ],
        "radius": 14.2875
      }
    ]
  ],
  "crossHoles": [
    {
      "radius": 2.4892,
      "axis": [
        0,
        -1,
        6.123233995738107e-17
      ],
      "at": [
        -39.557198,
        -14.067172123269998,
        1.1662049469344224e-15
      ],
      "length": 1.174506096889985
    },
    {
      "radius": 2.4892,
      "axis": [
        0,
        -1,
        6.123233995738107e-17
      ],
      "at": [
        39.557198,
        -14.067172123269998,
        1.1662049469344224e-15
      ],
      "length": 1.174506096889985
    },
    {
      "radius": 2.4892,
      "axis": [
        0,
        -1,
        6.12323399573802e-17
      ],
      "at": [
        39.557198,
        15.241678220164005,
        -6.284445410544086e-16
      ],
      "length": 1.1745060968890044
    },
    {
      "radius": 2.4892,
      "axis": [
        0,
        -1,
        6.12323399573802e-17
      ],
      "at": [
        -39.557198,
        15.241678220164005,
        -6.284445410544086e-16
      ],
      "length": 1.1745060968890044
    },
    {
      "radius": 2.4892,
      "axis": [
        0,
        0,
        1
      ],
      "at": [
        39.557198,
        3.0483908124377954e-16,
        -15.240005579443007
      ],
      "length": 1.1728330609579984
    },
    {
      "radius": 2.4892,
      "axis": [
        0,
        0,
        1
      ],
      "at": [
        39.557198,
        3.0483908124377954e-16,
        14.06717212334
      ],
      "length": 1.174506096889985
    },
    {
      "radius": 2.4892,
      "axis": [
        0,
        0,
        1
      ],
      "at": [
        -39.557198,
        3.0483908124377954e-16,
        -15.240005579443007
      ],
      "length": 1.1728330609579984
    },
    {
      "radius": 2.4892,
      "axis": [
        0,
        0,
        1
      ],
      "at": [
        -39.557198,
        3.0483908124377954e-16,
        14.06717212334
      ],
      "length": 1.174506096889985
    }
  ]
};
export const pockets=[];
export default function build(overrides={}) { const base=buildPrismaticPart(stock,{...parameters,...overrides});return pockets.length?unwrap(cut(base,compound(pockets.map(p=>buildPrismaticPart(p))))):base; }
