# Building models with a local agent

The app is a local browser workspace, not an agent host. Use your usual filesystem tools and browser controls. No MCP connector or application API is needed.

## Entry point

`model.js` exports a default build function (synchronous or async). Use plain JavaScript. Relative ES-module imports work, including nested component files. Bare `brepjs` resolves to the installed full library.

```js
import { box, cylinder, translate, cut, unwrap } from "brepjs";

export default function build({ brepjs, occt, adapter }) {
  // Clearance allows this plate to slide over the mating mounting studs.
  let plate = box(80, 40, 6);
  for (const x of [12, 68]) {
    const hole = translate(cylinder(4, 10), [x, 20, -2]);
    plate = unwrap(cut(plate, hole));
  }
  return [
    {
      id: "mounting-plate",
      name: "Mounting plate",
      color: "#cf8355",
      shape: plate,
    },
  ];
}
```

Coordinates conventionally use millimeters and Z-up. Return one brepjs shape or an array of `{id, name, color, shape}`. IDs must be unique. Colors are `#RRGGBB`. Retain stable IDs across edits. Geometry must be valid and tessellatable. Operations that return a Result should use brepjs `unwrap` or explicitly handle errors; do not mistake a Result for a shape.

Keep semantic design explanations in comments where they add purpose or constraints beyond the code. The saved JavaScript is the semantic source of truth, not generated tessellations. Put component logic in local files and reuse it with imports. Do not save OCCT handles across executions.

`brepjs` exposes its full namespace. `occt` is the loaded OcctKernel, and `adapter` is its brepjs adapter. Consult this project's pinned dependency declarations and examples for exact API signatures. No primitive allowlist restricts model code. This also means unsupported/mistyped calls produce ordinary JavaScript errors that must be corrected.

## Feedback loop

1. Read model sources, then edit the desired files in the connected directory.
2. Allow the visible browser's automatic sync to finish, or click Rebuild.
3. Read `.instantcad/status.json`; verify `ok`, revision and geometry measurements. On failure this file describes the failed attempt and the last committed revision.
4. Inspect `.instantcad/preview.png` or the current browser canvas. Rotate/pan/zoom using the standard controls.
5. Use the **Inspect** button for additional exact-geometry queries. It opens a JavaScript input prompt and executes the expression body in the live worker with `brepjs`, `occt`, `adapter`, `parts`. Example:

```js
return parts.map((p) => ({
  id: p.id,
  valid: adapter.isValid(p.shape.wrapped),
  volume: adapter.volume(p.shape.wrapped),
  bounds: adapter.boundingBox(p.shape.wrapped),
}));
```

The result is shown at the bottom and written to `.instantcad/status.json`. Inspection is intended for queries; mutating shapes during inspection does not constitute a committed model edit. Put intended changes into source and rebuild.

6. Correct mistakes and repeat. A build error keeps the last good canvas. Never infer success solely from the fact that something remains visible.

The `.instantcad` files are generated feedback/cache, not input modules. Do not edit their contents to change the design. Their scene cache is overwritten in place; normal agent source edits do not accumulate a new heavy file per revision.

## Page bridge

If the browser-control environment permits application JavaScript calls, `window.instantcad` provides these convenience methods. Environments restricted to read-only evaluation can still use filesystem editing, standard controls and the Inspect prompt.

| Method                                  | Behavior                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------ |
| `state()`                               | Accepted revision, build state, parts/metrics, errors, timings, camera and render counters |
| `readFiles()`                           | Clone of current source snapshot                                                           |
| `sync()`                                | Scan connected directory for changes                                                       |
| `build()`                               | Execute current sources; returns accepted result or throws                                 |
| `cancel()`                              | Terminate CAD worker; keep last good mesh                                                  |
| `inspect(code)`                         | Execute JavaScript query in loaded CAD worker; returns JSON-compatible data                |
| `capture()`                             | PNG data URL of the current view                                                           |
| `fit()`                                 | Frame scene without changing orbit angles                                                  |
| `view(name)`                            | Set `front`, `right`, `top` or `iso` camera orientation                                    |
| `writeFiles(changes, expectedRevision)` | Write `{relativePath: javascript}` with stale-revision protection, then rebuild            |
| `exportSTEP()`                          | Return STEP text for the accepted geometry                                                 |

Use ordinary filesystem tools for deletion, renaming, and Git history. The app hashes all mirrored JavaScript, including component deletions. IndexedDB source snapshots are retained, but a full history browser, branches and assembly linking UI are not part of this initial project.

## Local binary assets

The build context also provides `readAsset(relativePath, sha256)`. It reads a file inside the connected project directory in the worker, verifies the pinned SHA-256 and returns a Uint8Array. Example:

```js
export default async function build({ readAsset, occt, brepjs }) {
  const bytes = await readAsset('part.step', 'PUT_THE_64_CHARACTER_SHA256_HERE');
  const step = new TextDecoder().decode(bytes);
  // Use the pinned OCCT / brepjs import API with this STEP text.
}
```

Compute the digest using your normal filesystem tools (on macOS, `shasum -a 256 part.step`). Asset hashes in JavaScript bind them to the model revision. Replacing an asset also requires updating its hash; assets are not polled every second or copied into source snapshots. A cached mesh still displays without reading the asset. Rebuilding or restoring exact shapes requires reconnecting the folder. See `models/frc-robot` for an XCAF STEP assembly importer preserving part colors and placements.

## Incremental component builds

For large assemblies, wrap each placed leaf part in `await cache.part(spec, factory)`
using the build context's `cache`. Return these parts from the assembly as usual:

```js
import buildPlate from './parts/plate.js';
export default async function build({cache}) {
  return [await cache.part({
    id:'plate-left', name:'Left plate', color:'#cc3322',
    dependencies:['parts/plate.js'], inputs:{thickness:4},
  }, () => buildPlate({thickness:4}))];
}
```

Factories must be deterministic, return one **placed** brepjs shape and have no
side effects. Declare every source module whose values the factory uses in
`dependencies` (project-root paths). Their transitive imports are hashed too.
For a registry that only selects a separately declared builder, also declare
`{path:'parts/registry.js',transitive:false}`. This invalidates selections when
the registry itself changes without invalidating unrelated parts on a leaf edit.
Use `[]` for a component made only from kernel operations or a pinned asset.
Put every external parameter, asset SHA-256, placement and repair setting in
`inputs`, as JSON-compatible values. Do not hide dependencies in mutable globals,
time, random values or undeclared closure state. Root assembly source changes
invalidate all its components conservatively. Uncached legacy builders still work.

Only newly built geometry is validated, measured and tessellated. Previously
validated meshes are reused by content key, including after a disk-cache reload.
The worker sends changed meshes; unchanged GPU batches stay allocated. Camera
rotation, pan and zoom are preserved during edits, including input while building.
Failed builds keep the last valid scene. Old/removed component mesh entries are
pruned after success, with a 256 MiB cache budget. The normal scene disk snapshot
replaces its previous version; component caching does not add revision files.

Exact inspection/STEP export lazily reconstructs unchanged shapes when needed;
fast view updates do not imply all exact BREP shapes are already resident.
`timings.components` reports hits, misses and retained bytes; editor feedback also
reports GPU batches uploaded/reused and time to the first updated GPU frame.

## Repeatable project/model navigation

Use `/project/model` links rather than reconnecting the folder on every visit.
`instantcad.state()` includes `project`, `model`, `entry`, and `url`;
`instantcad.listModels()` returns the registered local model links. The Models
button provides the same navigation and lets you link any JavaScript entry file.
An entry may return a single part or an assembly. `readFiles()` and `writeFiles()`
use paths relative to the project root; `readAsset()` uses paths relative to the
selected entry file's directory. JavaScript relative imports retain standard
module semantics. Each entry is a distinct source revision/cache identity.

If permission or a folder handle is lost, use Reconnect folder and select the
project root at its new location. The model entry path and stable link remain
unchanged. The URL cannot itself bypass the user's browser folder permission.
