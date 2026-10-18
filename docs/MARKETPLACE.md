# Marketplace publishing

## One-time account connection

The **CadCove** publisher (`gfleming1992`) is live. GitHub authentication through
Microsoft Entra workload identity federation has been verified, its identity has
publisher **Contributor** access, and automatic publication is enabled. The steps
below document how to recreate that connection.

Sign in to [Visual Studio Marketplace](https://marketplace.visualstudio.com/manage)
with the Microsoft account associated with `gfleming1992@gmail.com`. Create or use
publisher **gfleming1992**, with display name **CadCove**. Keeping the publisher ID
preserves the extension identity used by existing VSIX installations.

Register the single-tenant application **CadCove GitHub Marketplace Publisher**
in the owner's Microsoft Entra directory. No redirect URI, client secret,
delegated Graph permissions, or Azure subscription roles are needed. Configure
its federated credential for:

- GitHub repository: `gfleming1992/CadCove-FRC`
- Branch/ref: `refs/heads/main`
- GitHub OIDC issuer: `https://token.actions.githubusercontent.com`
- Subject: `repo:gfleming1992@7612360/CadCove-FRC@1405824070:ref:refs/heads/main`
- Audience: `api://AzureADTokenExchange`

This repository uses GitHub's immutable subject format, including the owner and
repository IDs. Inspect `gh api repos/gfleming1992/CadCove-FRC/actions/oidc/customization/sub`
before recreating the trust; a name-only subject will not match its tokens.

Set GitHub repository variables `AZURE_TENANT_ID` and `AZURE_CLIENT_ID` to the
directory and application IDs (these IDs are not secrets). Dispatch **Check
Marketplace publishing identity** on main. It requests a short-lived token and
prints only the Marketplace profile ID and display name. Add that profile ID
to the CadCove publisher's Members tab with **Contributor** access.

The Entra credential trusts this repository's main branch; it does not constrain
the workflow filename. Keep main-branch workflow changes under maintainer review.
The release workflow publishes only after the whole build matrix passes. The
separate identity-check workflow is manual and does not upload packages.

After the publisher and policy are ready, set the repository Actions variable
`MARKETPLACE_PUBLISH_ENABLED` to `true`. Set it to `false` to pause automatic uploads.
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

Publishing obtains a short-lived GitHub OIDC token, exchanges it at the configured
Entra tenant's OAuth endpoint for an Azure DevOps resource token, and supplies it
in memory to the pinned `@vscode/vsce` publisher, as its Azure credential path does.
The resource scope is `499b84ac-1321-427f-aa17-267ca6975798/.default`. Credentials
are masked in GitHub logs and never written to artifacts or persistent storage.
Authentication failure stops publication and never falls back to a saved credential.

Reference: [Microsoft's publishing and Entra authentication guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#secure-automated-publishing-to-visual-studio-marketplace).
