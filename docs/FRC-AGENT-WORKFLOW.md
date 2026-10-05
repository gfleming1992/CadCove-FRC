# FRC content and agent workflow

The main detailed example is [Amarillo + REBUILT](../examples/team3310-rebuilt/README.md).
The [small training robot](../examples/training-robot/README.md) remains the quick
independent integration regression. Large example data is separate from the
generic CAD core and extension. Users can replace robot and field independently,
with explicit recompiled bindings and calibration; no Team 3310 constants enter
the generic core.

`cadcove init` exports six reusable skills to `.cadcove/skills/`, linked from the
shared agent instructions used by AGENTS.md, CLAUDE.md and Copilot. The router loads
only relevant workflows: requirements/season rules, CAD/mechanisms, CTRE code,
Limelight vision, and simulation validation. These are ordinary local files,
usable by a filesystem agent without MCP, a hosted agent, or an API key.

## Updating an existing workspace

After installing a newer toolbox runtime, the agent can run:

```sh
cadcove guidance-update --workspace . --dry-run
cadcove guidance-update --workspace .
```

The initializer records generated instruction hashes in
`.cadcove/guidance-state.json`. Updates replace only files that still match that
baseline, add new skills, and leave robot source, simulation/CAD configuration,
season selection and existing root instruction blocks untouched. Missing CadCove
discovery blocks are appended to AGENTS.md, CLAUDE.md and Copilot instructions. Edited or deleted
guidance produces reviewable replacements under `.cadcove/guidance-updates/` and
exit status 1. The agent can compare and merge them with the team's instructions.
An exact replacement is adopted on the next update; customized merges stay
protected and may need another review on future releases. Retired guidance files
are reported and retained rather than deleted.

Older workspaces without a baseline are treated conservatively: matching files
are adopted, missing new skills are added, and differing old instructions receive
proposals. No ownership is inferred from a familiar filename. Dry-run writes
nothing. Concurrent CLI updates are serialized by a PID-bearing lock; after an
abnormal exit, check that process before removing a stale lock. Updates are
atomic per file, with the baseline written last; they are not an atomic swap of
the entire instruction directory. A retry protects files changed during a partial
update rather than overwriting them blindly.

## Season knowledge

The shipped 2026 descriptor contains official source links, not manual text.
FIRST's [season page](https://www.firstinspires.org/resources/library/frc/season-materials)
asks that its posted content not be re-hosted or redistributed. Teams can import
their locally supplied PDF for private use:

```sh
cadcove season-import --workspace . --pack .cadcove/seasons/2026.json --pdf /path/to/2026GameManual.pdf --revision "revision printed in this PDF"
```

This uses `pdftotext` if installed. For a portable agent-assisted extraction, pass
`--pages extracted-pages.json` containing:

```json
{"sourceSha256":"SHA256_OF_THE_EXACT_PDF","pages":["Text on PDF page 1","Text on PDF page 2"]}
```

Include every PDF page, including empty strings for image-only pages. This is a
text conversion, not OCR or a guarantee of accurate tables/figures. The importer
preserves the PDF and immutable per-page Markdown files with hashes. It validates
the supplied PDF identity; it cannot prove manually supplied text is a faithful
extraction. Retain that limitation in rule decisions.

Imports live under `.cadcove/knowledge/<season>/<kind>-<content-hash>/` and are
ignored by Git. Each revision preserves its PDF, metadata, page index and page
text. Imports never overwrite earlier revisions or download third-party files.
Set `.cadcove/frc.json.seasonKnowledge` to the chosen directory (workspace-relative).
Import Team Updates separately with `--kind updates`; record their directories
alongside the manual, e.g. `seasonUpdates: [".cadcove/knowledge/..."]`.

```sh
cadcove season-search --directory .cadcove/knowledge/SELECTED_IMPORT --query "bumper extension"
```

Search checks file integrity and returns whole-token lexical matches ranked by
BM25, with PDF page references, page rule IDs, revision and source digest. Ranking
does not establish rule authority. Follow `nextOffset` using `--offset N` to page
through all matches; `--limit` defaults to 8 and accepts 1–20. Search synonyms and
singular/plural forms explicitly. Markdown is also available for an agent's
own semantic index; no embeddings service is embedded or claimed. Search isn't
rule adjudication. Inspect definitions, exceptions, updates and original diagrams,
then record rule ID/revision/page beside design requirements and their tests.

For another season, provide a descriptor with schema 1, id `frc-YEAR-slug`, integer
year, game, language `en`, and HTTPS manualUrl, updatesUrl, sourcePage. Keep the
old revision pinned for old projects. Selecting knowledge does not change field
geometry, AprilTags or runtime scoring; those are separate reviewed changes using
the SeasonPlugin interface. A stale local PDF is not asserted to be current.

## Actual parts, not generic lookalikes

The team's CAD contains WCP Swerve X2 and X2 molded drive wheels, Stealth mechanism
wheels, Kraken motors and CANcoder components. Code supplies the device instances
and gyro. Camera variant/mount uncertainty remains recorded. The component
reference links official WCP, CTRE, Limelight and WPILib documentation and requires
exact variants, source pins and actual dimensions before reuse. These preferences
do not override another team's BOM or imply market-share statistics.

Export with `--component-catalog COMPONENTS_JSON` to carry that robot's inventory
into `.cadcove/example/components.json`. The workspace-relative `componentCatalog`
in `.cadcove/frc.json` lets installed agents find it without the development repo.
The exporter includes the catalog's digest in example provenance. On robot
replacement, select the new robot's catalog as well as its geometry and bindings.
