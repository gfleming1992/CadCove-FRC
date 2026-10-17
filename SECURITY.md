# Security and execution boundary

CadCove runs CAD Python and the team's compiled robot program locally. Use
trusted workspaces and review generated code. The extension disables untrusted
and virtual workspaces. Its verified bundled runtime is selected by the extension,
not by an arbitrary workspace download URL. The CLI uses a separately installed,
pinned Bun interpreter; `CADCOVE_BUN` selects an explicit executable. Review that
configuration like any other local toolchain path.

Simulation control/viewer services bind to loopback and use per-session credentials.
Do not expose those APIs through a tunnel or commit generated session files.
WPILib/CTRE diagnostics may have separate networking behavior; these are not
isolated by the CadCove control token. Run one robot simulation per host until
port isolation is configured and tested. Desktop simulation commands do not
implicitly authorize deployment to real hardware.

For a vulnerability in a published repository, use GitHub's **Report a
vulnerability** private advisory when enabled. Do not put working credentials or
private robot data in public issues. If private reporting is unavailable, ask the
maintainer for a private channel without including exploit details publicly.
Maintainers must enable private reporting before advertising it as available.

Ordinary bugs belong in issues with the extension/runtime version, OS/architecture,
smallest distributable reproduction and redacted diagnostics. Update support and
release qualification are recorded in the release notes; this project does not
claim a security audit or a guaranteed response SLA.
