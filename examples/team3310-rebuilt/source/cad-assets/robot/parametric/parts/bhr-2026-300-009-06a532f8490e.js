import {buildPrismaticPart} from '../profile.js';

// BHR-2026-300-009: manufacturing profile reconstructed from the measured team STEP.
// Keep mounting cutouts aligned with the mating assembly; depth is the stock thickness or tube length.
export const parameters = {depth: 215.9, holeScale: 1};
export const profile = {
  "origin": [
    -61.3150601389,
    0,
    5.588
  ],
  "u": [
    -1,
    0,
    0
  ],
  "v": [
    0,
    1,
    0
  ],
  "normal": [
    0,
    0,
    -1
  ],
  "direction": [
    0,
    0,
    1
  ],
  "depth": 215.9,
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
        "radius": 3.2258
      }
    ]
  ]
};
export default function build(overrides = {}) {
  return buildPrismaticPart(profile, {...parameters, ...overrides});
}
