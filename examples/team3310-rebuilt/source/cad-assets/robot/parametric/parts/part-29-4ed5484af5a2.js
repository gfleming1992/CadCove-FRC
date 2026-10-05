import {buildPrismaticPart} from '../profile.js';

// Part 29: manufacturing profile reconstructed from the measured team STEP.
// Keep mounting cutouts aligned with the mating assembly; depth is the stock thickness or tube length.
export const parameters = {depth: 670.56, holeScale: 1};
export const profile = {
  "origin": [
    161.9261483586,
    -335.28,
    405.2583912359
  ],
  "u": [
    1,
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
    -1,
    0
  ],
  "direction": [
    0,
    1,
    0
  ],
  "depth": 670.56,
  "outline": [
    {
      "kind": "arc",
      "from": [
        -4.1790987575,
        -5.4615886221
      ],
      "mid": [
        -3.438525,
        -5.9557000031
      ],
      "to": [
        -2.640325113,
        -6.35
      ]
    },
    {
      "kind": "line",
      "from": [
        -2.640325113,
        -6.35
      ],
      "to": [
        2.640325113,
        -6.35
      ]
    },
    {
      "kind": "arc",
      "from": [
        2.640325113,
        -6.35
      ],
      "mid": [
        3.438525,
        -5.9557000031
      ],
      "to": [
        4.1790987575,
        -5.4615886221
      ]
    },
    {
      "kind": "line",
      "from": [
        4.1790987575,
        -5.4615886221
      ],
      "to": [
        6.8194238706,
        -0.8884113779
      ]
    },
    {
      "kind": "arc",
      "from": [
        6.8194238706,
        -0.8884113779
      ],
      "mid": [
        6.87705,
        0
      ],
      "to": [
        6.8194238705,
        0.8884113779
      ]
    },
    {
      "kind": "line",
      "from": [
        6.8194238705,
        0.8884113779
      ],
      "to": [
        4.1790987575,
        5.4615886221
      ]
    },
    {
      "kind": "arc",
      "from": [
        4.1790987575,
        5.4615886221
      ],
      "mid": [
        3.438525,
        5.9557000031
      ],
      "to": [
        2.640325113,
        6.35
      ]
    },
    {
      "kind": "line",
      "from": [
        2.640325113,
        6.35
      ],
      "to": [
        -2.640325113,
        6.35
      ]
    },
    {
      "kind": "arc",
      "from": [
        -2.640325113,
        6.35
      ],
      "mid": [
        -3.438525,
        5.9557000031
      ],
      "to": [
        -4.1790987575,
        5.4615886221
      ]
    },
    {
      "kind": "line",
      "from": [
        -4.1790987575,
        5.4615886221
      ],
      "to": [
        -6.8194238705,
        0.8884113779
      ]
    },
    {
      "kind": "arc",
      "from": [
        -6.8194238705,
        0.8884113779
      ],
      "mid": [
        -6.87705,
        0
      ],
      "to": [
        -6.8194238705,
        -0.8884113779
      ]
    },
    {
      "kind": "line",
      "from": [
        -6.8194238706,
        -0.8884113779
      ],
      "to": [
        -4.1790987575,
        -5.4615886221
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
        "radius": 2.5527
      }
    ]
  ]
};
export default function build(overrides = {}) {
  return buildPrismaticPart(profile, {...parameters, ...overrides});
}
