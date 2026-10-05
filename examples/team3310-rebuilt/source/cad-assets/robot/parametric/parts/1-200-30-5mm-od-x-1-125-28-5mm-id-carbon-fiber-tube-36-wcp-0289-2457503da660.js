import {cut,compound,unwrap} from 'brepjs';
import {buildPrismaticPart} from '../profile.js';
// 1.200" (30.5mm) OD x .1.125" (28.5mm) ID (Carbon Fiber Tube, 36") (WCP-0289): extruded stock, cross-drilling, and explicit machined pockets.
// The catalog name describes uncut vendor stock; depth is the actual team cut length.
// Cross-drilled holes retain the roller/hub mounting pattern.
// Hole and pocket positions are fixed in the original part coordinate system.
export const parameters={depth:583.837796,holeScale:1};
export const stock={
  "origin": [
    -291.918898,
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
  "depth": 583.837796,
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
        6.12323399573802e-17
      ],
      "at": [
        -279.218898,
        -14.067172123279988,
        1.1662049469389379e-15
      ],
      "length": 1.1745060968900134
    },
    {
      "radius": 2.4892,
      "axis": [
        0,
        -1,
        6.123233995727922e-17
      ],
      "at": [
        279.218898,
        -14.067172123279988,
        1.1662049469389972e-15
      ],
      "length": 1.1745060968900134
    },
    {
      "radius": 2.4892,
      "axis": [
        0,
        -1,
        6.12323399573802e-17
      ],
      "at": [
        279.218898,
        15.241678220159997,
        -6.284445410502612e-16
      ],
      "length": 1.1745060968900134
    },
    {
      "radius": 2.4892,
      "axis": [
        0,
        -1,
        6.12323399573802e-17
      ],
      "at": [
        -279.218898,
        15.241678220159997,
        -6.284445410502612e-16
      ],
      "length": 1.1745060968900134
    },
    {
      "radius": 2.4892,
      "axis": [
        0,
        0,
        1
      ],
      "at": [
        279.218898,
        3.0483908124377954e-16,
        -15.240005579429976
      ],
      "length": 1.172833060959988
    },
    {
      "radius": 2.4892,
      "axis": [
        0,
        0,
        1
      ],
      "at": [
        279.218898,
        3.0483908124377954e-16,
        14.067172123360024
      ],
      "length": 1.1745060968900134
    },
    {
      "radius": 2.4892,
      "axis": [
        0,
        0,
        1
      ],
      "at": [
        -279.218898,
        3.0483908124377954e-16,
        -15.240005579429976
      ],
      "length": 1.172833060959988
    },
    {
      "radius": 2.4892,
      "axis": [
        0,
        0,
        1
      ],
      "at": [
        -279.218898,
        3.0483908124377954e-16,
        14.067172123360024
      ],
      "length": 1.1745060968900134
    }
  ]
};
export const pockets=[];
export default function build(overrides={}) { const base=buildPrismaticPart(stock,{...parameters,...overrides});return pockets.length?unwrap(cut(base,compound(pockets.map(p=>buildPrismaticPart(p))))):base; }
