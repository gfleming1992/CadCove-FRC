import {buildPrismaticPart} from '../profile.js';

// Black Wire #2: manufacturing profile reconstructed from the measured team STEP.
// Keep mounting cutouts aligned with the mating assembly; depth is the stock thickness or tube length.
export const parameters = {depth: 25.4, holeScale: 1};
export const profile = {
  "origin": [
    -301.2104392034,
    -176.6731036,
    417.0807
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
        -2.6092058766,
        1.8090521535
      ],
      "mid": [
        -2.2450640303,
        2.2450640303
      ],
      "to": [
        -1.8090521536,
        2.6092058765
      ]
    },
    {
      "kind": "arc",
      "from": [
        -3.175,
        0
      ],
      "mid": [
        -3.0302519415,
        0.947733175
      ],
      "to": [
        -2.6092058765,
        1.8090521535
      ]
    },
    {
      "kind": "arc",
      "from": [
        0,
        -3.175
      ],
      "mid": [
        -2.2450640303,
        -2.2450640303
      ],
      "to": [
        -3.175,
        0
      ]
    },
    {
      "kind": "arc",
      "from": [
        0,
        3.175
      ],
      "mid": [
        3.175,
        0
      ],
      "to": [
        0,
        -3.175
      ]
    },
    {
      "kind": "arc",
      "from": [
        -1.8090521536,
        2.6092058764
      ],
      "mid": [
        -0.9477331751,
        3.0302519415
      ],
      "to": [
        0,
        3.175
      ]
    }
  ],
  "cutouts": []
};
export default function build(overrides = {}) {
  return buildPrismaticPart(profile, {...parameters, ...overrides});
}
