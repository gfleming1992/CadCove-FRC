import {buildPrismaticPart} from '../profile.js';

// Part 17: manufacturing profile reconstructed from the measured team STEP.
// Keep mounting cutouts aligned with the mating assembly; depth is the stock thickness or tube length.
export const parameters = {depth: 1.27, holeScale: 1};
export const profile = {
  "origin": [
    328.7725454,
    -11.176,
    512.7371
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
  "depth": 1.27,
  "outline": [
    {
      "kind": "circle",
      "center": [
        0,
        0
      ],
      "radius": 12.7
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
