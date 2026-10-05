import {buildPrismaticPart} from '../profile.js';

// BHR-2026-500-032: manufacturing profile reconstructed from the measured team STEP.
// Keep mounting cutouts aligned with the mating assembly; depth is the stock thickness or tube length.
export const parameters = {depth: 139.7, holeScale: 1};
export const profile = {
  "origin": [
    -308.0393284422,
    -244.9229036,
    330.5302
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
  "depth": 139.7,
  "outline": [
    {
      "kind": "circle",
      "center": [
        0,
        0
      ],
      "radius": 4.7625
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
