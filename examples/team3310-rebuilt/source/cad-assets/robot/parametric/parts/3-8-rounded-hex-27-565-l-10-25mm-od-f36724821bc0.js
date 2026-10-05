import {buildPrismaticPart} from '../profile.js';

// 3/8" Rounded Hex (27.565"L 10.25mm OD): manufacturing profile reconstructed from the measured team STEP.
// Keep mounting cutouts aligned with the mating assembly; depth is the stock thickness or tube length.
export const parameters = {depth: 700.151, holeScale: 1};
export const profile = {
  "origin": [
    0,
    0,
    0
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
  "depth": 700.151,
  "outline": [
    {
      "kind": "line",
      "from": [
        -1.8932033039,
        -4.7625
      ],
      "to": [
        1.8932033039,
        -4.7625
      ]
    },
    {
      "kind": "arc",
      "from": [
        1.8932033039,
        -4.7625
      ],
      "mid": [
        2.5625,
        -4.4383801944
      ],
      "to": [
        3.1778443336,
        -4.0208121557
      ]
    },
    {
      "kind": "line",
      "from": [
        3.1778443336,
        -4.0208121557
      ],
      "to": [
        5.0710476375,
        -0.7416878443
      ]
    },
    {
      "kind": "arc",
      "from": [
        5.0710476375,
        -0.7416878443
      ],
      "mid": [
        5.125,
        0
      ],
      "to": [
        5.0710476375,
        0.7416878443
      ]
    },
    {
      "kind": "line",
      "from": [
        5.0710476375,
        0.7416878443
      ],
      "to": [
        3.1778443336,
        4.0208121557
      ]
    },
    {
      "kind": "arc",
      "from": [
        3.1778443336,
        4.0208121557
      ],
      "mid": [
        2.5625,
        4.4383801944
      ],
      "to": [
        1.8932033039,
        4.7625
      ]
    },
    {
      "kind": "line",
      "from": [
        1.8932033039,
        4.7625
      ],
      "to": [
        -1.8932033039,
        4.7625
      ]
    },
    {
      "kind": "arc",
      "from": [
        -1.8932033039,
        4.7625
      ],
      "mid": [
        -2.5625,
        4.4383801944
      ],
      "to": [
        -3.1778443336,
        4.0208121557
      ]
    },
    {
      "kind": "line",
      "from": [
        -3.1778443336,
        4.0208121557
      ],
      "to": [
        -5.0710476375,
        0.7416878443
      ]
    },
    {
      "kind": "arc",
      "from": [
        -5.0710476375,
        0.7416878443
      ],
      "mid": [
        -5.125,
        0
      ],
      "to": [
        -5.0710476375,
        -0.7416878443
      ]
    },
    {
      "kind": "line",
      "from": [
        -5.0710476375,
        -0.7416878443
      ],
      "to": [
        -3.1778443336,
        -4.0208121557
      ]
    },
    {
      "kind": "arc",
      "from": [
        -3.1778443336,
        -4.0208121557
      ],
      "mid": [
        -2.5625,
        -4.4383801944
      ],
      "to": [
        -1.8932033039,
        -4.7625
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
        "radius": 2.0955
      }
    ]
  ]
};
export default function build(overrides = {}) {
  return buildPrismaticPart(profile, {...parameters, ...overrides});
}
