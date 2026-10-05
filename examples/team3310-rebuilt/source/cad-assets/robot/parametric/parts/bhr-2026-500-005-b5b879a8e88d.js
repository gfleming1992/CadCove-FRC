import {fuseAll, unwrap} from 'brepjs';
import {buildPrismaticPart} from '../profile.js';

// BHR-2026-500-005: hex drive stock with two round bearing seats.
// Preserve the bearing seats and their shoulders when changing the shaft.
export const profiles = [
  {
    "origin": [
      0,
      0,
      343.2302
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
    "depth": 5.930899999999951,
    "outline": [
      {
        "kind": "circle",
        "center": [
          -267.6276917393,
          -278.5671002165
        ],
        "radius": 4.749799999999993
      }
    ],
    "cutouts": []
  },
  {
    "origin": [
      0,
      0,
      349.1611
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
    "depth": 38.93820000000005,
    "outline": [
      {
        "kind": "line",
        "from": [
          -264.8778242393,
          -273.8041899924
        ],
        "to": [
          -262.1279567393,
          -278.5671002165
        ]
      },
      {
        "kind": "line",
        "from": [
          -262.1279567393,
          -278.5671002165
        ],
        "to": [
          -264.8778242393,
          -283.3300104405
        ]
      },
      {
        "kind": "line",
        "from": [
          -264.8778242393,
          -283.3300104405
        ],
        "to": [
          -270.3775592393,
          -283.3300104405
        ]
      },
      {
        "kind": "line",
        "from": [
          -270.3775592393,
          -283.3300104405
        ],
        "to": [
          -273.1274267393,
          -278.5671002165
        ]
      },
      {
        "kind": "line",
        "from": [
          -273.1274267393,
          -278.5671002165
        ],
        "to": [
          -270.3775592393,
          -273.8041899924
        ]
      },
      {
        "kind": "line",
        "from": [
          -270.3775592393,
          -273.8041899924
        ],
        "to": [
          -264.8778242393,
          -273.8041899924
        ]
      }
    ],
    "cutouts": []
  },
  {
    "origin": [
      0,
      0,
      388.0993
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
    "depth": 5.930899999999951,
    "outline": [
      {
        "kind": "circle",
        "center": [
          -267.6276917393,
          -278.5671002165
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
