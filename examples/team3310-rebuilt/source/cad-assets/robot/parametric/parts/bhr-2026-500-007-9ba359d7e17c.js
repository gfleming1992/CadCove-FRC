import {fuseAll, unwrap} from 'brepjs';
import {buildPrismaticPart} from '../profile.js';

// BHR-2026-500-007: hex drive stock with two round bearing seats.
// Preserve the bearing seats and their shoulders when changing the shaft.
export const profiles = [
  {
    "origin": [
      0,
      -292.5225036,
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
    "depth": 7.137400000000014,
    "outline": [
      {
        "kind": "circle",
        "center": [
          290.2714844261,
          -229.5883922246
        ],
        "radius": 4.749799999999993
      }
    ],
    "cutouts": []
  },
  {
    "origin": [
      0,
      -285.3851036,
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
    "depth": 38.176199999999966,
    "outline": [
      {
        "kind": "line",
        "from": [
          287.5216169261,
          -224.8254820006
        ],
        "to": [
          284.7717494261,
          -229.5883922246
        ]
      },
      {
        "kind": "line",
        "from": [
          284.7717494261,
          -229.5883922246
        ],
        "to": [
          287.5216169261,
          -234.3513024487
        ]
      },
      {
        "kind": "line",
        "from": [
          287.5216169261,
          -234.3513024487
        ],
        "to": [
          293.0213519261,
          -234.3513024487
        ]
      },
      {
        "kind": "line",
        "from": [
          293.0213519261,
          -234.3513024487
        ],
        "to": [
          295.7712194261,
          -229.5883922246
        ]
      },
      {
        "kind": "line",
        "from": [
          295.7712194261,
          -229.5883922246
        ],
        "to": [
          293.0213519261,
          -224.8254820006
        ]
      },
      {
        "kind": "line",
        "from": [
          293.0213519261,
          -224.8254820006
        ],
        "to": [
          287.5216169261,
          -224.8254820006
        ]
      }
    ],
    "cutouts": []
  },
  {
    "origin": [
      0,
      -247.2089036,
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
    "depth": 7.137400000000014,
    "outline": [
      {
        "kind": "circle",
        "center": [
          290.2714844261,
          -229.5883922246
        ],
        "radius": 4.749799999999993
      }
    ],
    "cutouts": []
  }
];
export const parameters = {bearingRadiusScale: 1};
export default function build({bearingRadiusScale = parameters.bearingRadiusScale} = {}) {
  if (!Number.isFinite(bearingRadiusScale) || bearingRadiusScale <= 0) throw Error('Bearing radius scale must be positive');
  return unwrap(fuseAll(profiles.map(p => buildPrismaticPart({...p, outline:p.outline.map(e => e.kind === 'circle' ? {...e, radius:e.radius*bearingRadiusScale} : e)}))));
}
