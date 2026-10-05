import {buildPrismaticPart} from '../profile.js';

// Can Wire #2: manufacturing profile reconstructed from the measured team STEP.
// Keep mounting cutouts aligned with the mating assembly; depth is the stock thickness or tube length.
export const parameters = {depth: 25.4, holeScale: 1};
export const profile = {
  "origin": [
    -301.2104392034,
    -174.4717669254,
    420.2557
  ],
  "u": [
    0,
    -1,
    0
  ],
  "v": [
    0,
    0,
    1
  ],
  "normal": [
    -1,
    0,
    0
  ],
  "direction": [
    1,
    0,
    0
  ],
  "depth": 25.4,
  "outline": [
    {
      "kind": "arc",
      "from": [
        -0.4868316627,
        0.4868316627
      ],
      "mid": [
        -0.0615918668,
        0.6857233973
      ],
      "to": [
        0.392284521,
        0.5657941235
      ]
    },
    {
      "kind": "arc",
      "from": [
        -0.4868316627,
        -0.4868316627
      ],
      "mid": [
        -0.68848394,
        0
      ],
      "to": [
        -0.4868316627,
        0.4868316627
      ]
    },
    {
      "kind": "arc",
      "from": [
        0.392284521,
        -0.5657941235
      ],
      "mid": [
        -0.0615918668,
        -0.6857233973
      ],
      "to": [
        -0.4868316627,
        -0.4868316627
      ]
    },
    {
      "kind": "arc",
      "from": [
        0.392284521,
        0.5657941235
      ],
      "mid": [
        0.68848394,
        0
      ],
      "to": [
        0.392284521,
        -0.5657941235
      ]
    }
  ],
  "cutouts": []
};
export default function build(overrides = {}) {
  return buildPrismaticPart(profile, {...parameters, ...overrides});
}
