# Robot CAD conversion

109 team part designs (178 occurrences) are editable plain JavaScript through brepjs. The full robot contains 1,958 occurrences.

Edit the matching file under `parametric/parts/`; follow its imports to named parameters, profiles, hole patterns, or shared builders. `model.js` and `parametric/registry.js` select converted builders while preserving instance IDs, transforms and colors.

23 other custom designs and 22 unclassified designs remain the original STEP by user direction. Vendor and standard hardware also remain STEP. See `parametric/migration.json` for each design and `parametric/conversion-summary.json` for this handoff. Original STEP files remain available for reference.

Verification: all installed converted solids passed recorded geometric checks; the full 1,958-component assembly rebuilt in the installed extension. The latest five additions passed live physical parameter changes and restoration. The native simulator with actual Java/Phoenix code passed a drive smoke test. This verifies conversion integration, not real robot hardware calibration.
