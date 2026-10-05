import {buildPrismaticPart} from '../profile.js';

// 1/2" Rounded Hex (24.996" L, 13.75mm OD): manufacturing profile reconstructed from the measured team STEP.
// Keep mounting cutouts aligned with the mating assembly; depth is the stock thickness or tube length.
export const parameters = {depth: 634.8984, holeScale: 1};
export const profile = {
  "origin": [
    0,
    634.8984,
    0
  ],
  "u": [
    -1,
    0,
    0
  ],
  "v": [
    0,
    0,
    1
  ],
  "normal": [
    0,
    1,
    0
  ],
  "direction": [
    0,
    -1,
    0
  ],
  "depth": 634.8984,
  "outline": [
    {
      "kind": "arc",
      "from": [
        -2.6349810246,
        -6.35
      ],
      "mid": [
        -3.4375,
        -5.953924651
      ],
      "to": [
        -4.1817708017,
        -5.4569605058
      ]
    },
    {
      "kind": "line",
      "from": [
        2.6349810246,
        -6.35
      ],
      "to": [
        -2.6349810246,
        -6.35
      ]
    },
    {
      "kind": "arc",
      "from": [
        4.1817708017,
        -5.4569605058
      ],
      "mid": [
        3.4375,
        -5.953924651
      ],
      "to": [
        2.6349810246,
        -6.35
      ]
    },
    {
      "kind": "line",
      "from": [
        6.8167518263,
        -0.8930394942
      ],
      "to": [
        4.1817708017,
        -5.4569605058
      ]
    },
    {
      "kind": "arc",
      "from": [
        6.8167518263,
        0.8930394942
      ],
      "mid": [
        6.875,
        0
      ],
      "to": [
        6.8167518263,
        -0.8930394942
      ]
    },
    {
      "kind": "line",
      "from": [
        4.1817708017,
        5.4569605058
      ],
      "to": [
        6.8167518263,
        0.8930394942
      ]
    },
    {
      "kind": "arc",
      "from": [
        2.6349810246,
        6.35
      ],
      "mid": [
        3.4375,
        5.953924651
      ],
      "to": [
        4.1817708017,
        5.4569605058
      ]
    },
    {
      "kind": "line",
      "from": [
        -2.6349810246,
        6.35
      ],
      "to": [
        2.6349810246,
        6.35
      ]
    },
    {
      "kind": "arc",
      "from": [
        -4.1817708017,
        5.4569605058
      ],
      "mid": [
        -3.4375,
        5.953924651
      ],
      "to": [
        -2.6349810246,
        6.35
      ]
    },
    {
      "kind": "line",
      "from": [
        -6.8167518263,
        0.8930394942
      ],
      "to": [
        -4.1817708017,
        5.4569605058
      ]
    },
    {
      "kind": "arc",
      "from": [
        -6.8167518263,
        -0.8930394942
      ],
      "mid": [
        -6.875,
        0
      ],
      "to": [
        -6.8167518263,
        0.8930394942
      ]
    },
    {
      "kind": "line",
      "from": [
        -4.1817708017,
        -5.4569605058
      ],
      "to": [
        -6.8167518263,
        -0.8930394942
      ]
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
        "radius": 2.0193
      }
    ]
  ]
};
export default function build(overrides = {}) {
  return buildPrismaticPart(profile, {...parameters, ...overrides});
}
