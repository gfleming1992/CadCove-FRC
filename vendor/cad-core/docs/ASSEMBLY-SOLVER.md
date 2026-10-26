# Assembly constraints

The core owns `src/native/mate_contract.py`, a solver-independent request validator
and trajectory residual checker. The embedding product selects its native solver.
CadCove uses Rapier for fixed, revolute and slider mates, including closed loops
and supported rotary couplings. Solver trajectories remain separate from dynamic
physics: prescribed motion does not establish mass, contact or motor behavior.

`mechanism.json` retains the existing CAD motion tree. Its optional `physical`
member supplies a richer SI physical graph through `core/physical-model.js`.
It supports free bodies, fixed/revolute/prismatic joints, full inertia tensors,
collisions, transmissions and motor properties. Closed physical joint loops are
represented as a graph; a tree alone cannot express all dependencies.
