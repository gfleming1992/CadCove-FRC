import {fuseAll, unwrap} from 'brepjs';
import {buildPrismaticPart} from '../profile.js';

// 1/2" Rounded Hex (7.843 in): custom-length hex drive stock with a turned bearing seat.
// Preserve the bearing seats and their shoulders when changing the shaft.
export const profiles = [
  {
    "origin": [
      0,
      -269.5736036,
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
          504.3031769594,
          -241.7813071495
        ],
        "radius": 4.749799999999993
      }
    ],
    "cutouts": [
      [
        {
          "kind": "circle",
          "center": [
            504.3031769594,
            -241.7813071495
          ],
          "radius": 2
        }
      ]
    ]
  },
  {
    "origin": [
      0,
      -262.4362036,
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
    "depth": 199.25029999999998,
    "outline": [
      {
        "kind": "line",
        "from": [
          500.1202732165,
          -236.3252150244
        ],
        "to": [
          497.4866107022,
          -240.8868523093
        ]
      },
      {
        "kind": "arc",
        "from": [
          497.4866107022,
          -240.8868523092
        ],
        "mid": [
          497.4281769594,
          -241.7813071495
        ],
        "to": [
          497.4866107022,
          -242.6757619898
        ]
      },
      {
        "kind": "line",
        "from": [
          497.4866107022,
          -242.6757619898
        ],
        "to": [
          500.1202732166,
          -247.2373992747
        ]
      },
      {
        "kind": "arc",
        "from": [
          500.1202732166,
          -247.2373992747
        ],
        "mid": [
          500.8656769594,
          -247.7352318005
        ],
        "to": [
          501.669514445,
          -248.131854115
        ]
      },
      {
        "kind": "line",
        "from": [
          501.669514445,
          -248.131854115
        ],
        "to": [
          506.9368394738,
          -248.131854115
        ]
      },
      {
        "kind": "arc",
        "from": [
          506.9368394737,
          -248.131854115
        ],
        "mid": [
          507.7406769594,
          -247.7352318005
        ],
        "to": [
          508.4860807022,
          -247.2373992747
        ]
      },
      {
        "kind": "line",
        "from": [
          508.4860807022,
          -247.2373992747
        ],
        "to": [
          511.1197432165,
          -242.6757619898
        ]
      },
      {
        "kind": "arc",
        "from": [
          511.1197432166,
          -242.6757619898
        ],
        "mid": [
          511.1781769594,
          -241.7813071495
        ],
        "to": [
          511.1197432166,
          -240.8868523092
        ]
      },
      {
        "kind": "line",
        "from": [
          511.1197432166,
          -240.8868523093
        ],
        "to": [
          508.4860807022,
          -236.3252150244
        ]
      },
      {
        "kind": "arc",
        "from": [
          508.4860807022,
          -236.3252150243
        ],
        "mid": [
          507.7406769594,
          -235.8273824985
        ],
        "to": [
          506.9368394738,
          -235.4307601841
        ]
      },
      {
        "kind": "line",
        "from": [
          506.9368394738,
          -235.4307601841
        ],
        "to": [
          501.669514445,
          -235.4307601841
        ]
      },
      {
        "kind": "arc",
        "from": [
          501.669514445,
          -235.4307601841
        ],
        "mid": [
          500.8656769593,
          -235.8273824985
        ],
        "to": [
          500.1202732165,
          -236.3252150244
        ]
      }
    ],
    "cutouts": [
      [
        {
          "kind": "circle",
          "center": [
            504.3031769594,
            -241.7813071495
          ],
          "radius": 2
        }
      ]
    ]
  }
];
export const parameters = {bearingRadiusScale: 1};
export default function build({bearingRadiusScale = parameters.bearingRadiusScale} = {}) {
  if (!Number.isFinite(bearingRadiusScale) || bearingRadiusScale <= 0) throw Error('Bearing radius scale must be positive');
  return unwrap(fuseAll(profiles.map(p => buildPrismaticPart({...p, outline:p.outline.map(e => e.kind === 'circle' ? {...e, radius:e.radius*bearingRadiusScale} : e)}))));
}
