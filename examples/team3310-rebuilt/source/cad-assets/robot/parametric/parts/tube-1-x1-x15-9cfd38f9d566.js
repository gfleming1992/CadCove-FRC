import {buildPrismaticPart} from '../profile.js';

// Tube 1"x1"x15": manufacturing profile reconstructed from the measured team STEP.
// Keep mounting cutouts aligned with the mating assembly; depth is the stock thickness or tube length.
export const parameters = {depth: 381, holeScale: 1};
export const profile = {
  "origin": [
    20.32,
    -304.8,
    152.4
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
  "depth": 381,
  "outline": [
    {
      "kind": "line",
      "from": [
        -12.7,
        12.7
      ],
      "to": [
        12.7,
        12.7
      ]
    },
    {
      "kind": "line",
      "from": [
        -12.7,
        -12.7
      ],
      "to": [
        -12.7,
        12.7
      ]
    },
    {
      "kind": "line",
      "from": [
        -12.7,
        -12.7
      ],
      "to": [
        12.7,
        -12.7
      ]
    },
    {
      "kind": "line",
      "from": [
        12.7,
        -12.7
      ],
      "to": [
        12.7,
        12.7
      ]
    }
  ],
  "cutouts": [
    [
      {
        "kind": "line",
        "from": [
          -11.176,
          -11.176
        ],
        "to": [
          -11.176,
          11.176
        ]
      },
      {
        "kind": "line",
        "from": [
          -11.176,
          11.176
        ],
        "to": [
          11.176,
          11.176
        ]
      },
      {
        "kind": "line",
        "from": [
          11.176,
          -11.176
        ],
        "to": [
          11.176,
          11.176
        ]
      },
      {
        "kind": "line",
        "from": [
          -11.176,
          -11.176
        ],
        "to": [
          11.176,
          -11.176
        ]
      }
    ]
  ],
  "crossHoles": [
    {
      "radius": 2.4892,
      "at": [
        7.619999999999891,
        -304.8,
        520.6999999999998
      ],
      "axis": [
        1,
        0,
        0
      ],
      "length": 1.5240000000001146
    },
    {
      "radius": 2.4892,
      "at": [
        7.619999999999891,
        -304.8,
        165.0999999999998
      ],
      "axis": [
        1,
        0,
        0
      ],
      "length": 1.5240000000001146
    },
    {
      "radius": 2.4892,
      "at": [
        31.495999999999867,
        -304.8,
        520.6999999999998
      ],
      "axis": [
        1,
        0,
        0
      ],
      "length": 1.5240000000001146
    },
    {
      "radius": 2.4892,
      "at": [
        31.495999999999867,
        -304.8,
        165.0999999999998
      ],
      "axis": [
        1,
        0,
        0
      ],
      "length": 1.5240000000001146
    },
    {
      "radius": 2.4892,
      "at": [
        20.32,
        -292.09999999964,
        520.7
      ],
      "axis": [
        0,
        -1,
        0
      ],
      "length": 1.5240000000001146
    },
    {
      "radius": 2.4892,
      "at": [
        20.32,
        -292.09999999964,
        165.1
      ],
      "axis": [
        0,
        -1,
        0
      ],
      "length": 1.5240000000001146
    },
    {
      "radius": 2.4892,
      "at": [
        20.32,
        -315.97599999963995,
        520.7
      ],
      "axis": [
        0,
        -1,
        0
      ],
      "length": 1.5240000000001146
    },
    {
      "radius": 2.4892,
      "at": [
        20.32,
        -315.97599999963995,
        165.1
      ],
      "axis": [
        0,
        -1,
        0
      ],
      "length": 1.5240000000001146
    }
  ]
};
export default function build(overrides = {}) {
  return buildPrismaticPart(profile, {...parameters, ...overrides});
}
