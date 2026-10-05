import {buildPrismaticPart} from '../profile.js';

// BHR-2026-300-003: manufacturing profile reconstructed from the measured team STEP.
// Keep mounting cutouts aligned with the mating assembly; depth is the stock thickness or tube length.
export const parameters = {depth: 685.8, holeScale: 1};
export const profile = {
  "origin": [
    -17.4759660498,
    -343.1701036,
    136.5360808311
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
  "depth": 685.8,
  "outline": [
    {
      "kind": "circle",
      "center": [
        0,
        0
      ],
      "radius": 6.35
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
        "radius": 3.2766
      }
    ]
  ]
};
export default function build(overrides = {}) {
  return buildPrismaticPart(profile, {...parameters, ...overrides});
}
