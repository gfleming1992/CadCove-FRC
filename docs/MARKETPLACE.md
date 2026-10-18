# Marketplace publishing

## One-time account connection

Sign in to [Visual Studio Marketplace](https://marketplace.visualstudio.com/manage)
with the Microsoft account associated with `gfleming1992@gmail.com`. Create or use
publisher **gfleming1992**, with display name **CadCove**. Keeping the publisher ID
preserves the extension identity used by existing VSIX installations.

Configure a **trusted publishing policy** for:

- GitHub repository: `gfleming1992/CadCove-FRC`
- Workflow: `.github/workflows/toolbox-source.yml`
- Branch/ref: `refs/heads/main`
- GitHub OIDC issuer: `https://token.actions.githubusercontent.com`
- Subject: `repo:gfleming1992/CadCove-FRC:ref:refs/heads/main`
- Audience: `marketplace.visualstudio.com`

After the publisher and policy are ready, set the repository Actions variable
`MARKETPLACE_PUBLISH_ENABLED` to `true`. It is deliberately disabled until then.
No Microsoft password, PAT, or other long-lived publishing secret is stored in GitHub.
Account verification, publisher terms and permission grants require the owner's
participation. A Microsoft account alone does not create a Marketplace publisher.

## Automatic updates

Push to **main**. The workflow gives all four packages the same automatic version:
`<major>.<minor>.<GitHub workflow run number>`. For example, base `0.2.1` and run 23
produce `0.2.23`. Gaps are normal; failed and branch-only runs do not publish.
Retrying a run retains its version. Change major/minor in
`extensions/vscode/package.json` for a new release series. Do not rename/recreate
the workflow without reviewing its version counter against the Marketplace.

Publication waits for every platform job to pass. It downloads that run's exact
VSIX files, checks their source commit, platform, extension identity, version and
SHA-256 against the test reports, then uploads all four targets. macOS/Linux must
also have passed installed-editor checks for those exact files; Windows CI's
scope remains native/CLI/package validation with separate device qualification.
No package is rebuilt after validation.

Pull requests, forks and the release branch never publish. A superseded main run
is skipped. Active main runs are not interrupted during publication. A failed
partial upload can be retried: already-published platform versions are skipped.
The workflow can also be dispatched manually on main after account setup.

The Marketplace serves the appropriate platform package to VS Code. GitHub release
creation remains separate; this automation does not replace existing release assets.

## Authentication

Publishing obtains a short-lived GitHub OIDC token, exchanges it for a Marketplace
session credential, and supplies it in memory to the pinned `@vscode/vsce` publisher.
The token exchange uses the documented `FederatedToken` header and `7.2-preview.1`
endpoint. That small adapter is needed because vsce 4.0.0's packaged OIDC exchange
predates the current protocol; it can be removed when the pinned release supports it.
Authentication failure stops publication and never falls back to a saved credential.

References: [Microsoft trusted publishing](https://github.com/microsoft/vscode-vsce#trusted-publishing)
and [publishing extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).
