# Versioning and releases

Use the existing version script; do not edit the version files separately:

```sh
npm run version:set -- 1.3.0
# Or: npm run version:minor
# Prerelease example: npm run version:set -- 1.3.0-rc.1
node scripts/validate-version.js
npm test
```

The script synchronizes `package.json`, `[package].version` in
`src-tauri/Cargo.toml`, and the fixed version in `src-tauri/tauri.conf.json`.
These three files are the release version sources. Lockfiles are not release
version sources and the existing bump script does not update them.
SemVer includes prereleases and build metadata. Numeric prerelease identifiers
must not have leading zeroes (`rc.1` is valid; `rc.01` is invalid). The bump script
and CI use the same parser. Build metadata does not increase version precedence.
Existing Tauri/platform packaging restrictions still apply.

## Example: 1.2.0 to 1.3.0

1. Starting with 1.2.0, run `npm run version:set -- 1.3.0` on a feature branch.
2. Commit the three version files, open a PR targeting `main`, and merge once
   checks pass. Do not create a tag yourself for the automatic path.
3. **Auto Tag Bifrost** validates the merged commit and remote publication state,
   then creates an annotated tag for an eligible version. It validates the exact
   tag/SHA and dispatches the separate **Release** workflow on that tag.
4. **Release** validates the tag again and builds macOS ARM64, macOS Intel, and
   Windows sequentially from the validated SHA, preserving signing, notarization,
   updater assets, and release notes.

No PAT is needed. Auto Tag explicitly dispatches Release with `GITHUB_TOKEN`;
creating a tag with this token does not itself trigger another workflow.
Human-pushed tags do not start Release automatically; dispatch Release on the tag.

## PR check policy

`Version validation` runs on every PR to `main`, without path filters. Use its
job named **Version validation** as a required branch protection check. It uses
`pull_request`, a read-only token, and no signing secrets or release jobs.

Every PR must have valid, synchronized versions. Application changes require a
strictly higher SemVer version than the target branch, even when the version was
previously left unchanged. Mixed application/documentation PRs require a bump.
Unknown paths require a bump, including validation scripts and their tests.

The complete exemption allowlist is:

- Root-level `*.md` files (case insensitive).
- Only Markdown (`*.md`) files under `docs/` and `design/` (case insensitive).
- `.github/workflows/*.yml` and `*.yaml`, with no nested directories.
- Direct `.md`, `.yml`, or `.yaml` files in `.github/ISSUE_TEMPLATE/` or
  `.github/PULL_REQUEST_TEMPLATE/`, and `.github/PULL_REQUEST_TEMPLATE.md`.
- `.github/FUNDING.yml` (the GitHub path patterns are case insensitive).
- Exactly `LICENSE`, `LICENSE.md`, `LICENSE.txt`, `.gitignore`, `.gitattributes`,
  `CODEOWNERS`, and `.github/CODEOWNERS`.

Markdown elsewhere, dependencies/lockfiles, frontend and backend sources, styles,
resources, tests, and build/application configuration are release-relevant.
Only PRs exclusively changing exempt paths (or having an empty diff) may retain
an unchanged version. They explicitly report that no release-relevant changes
were detected. Consistency and remote lookup checks still run.

Choose patch for compatible fixes, minor for compatible new functionality, and
major for incompatible changes. Use `npm run version:patch`, `version:minor`,
`version:major`, or `version:set -- <version>` and commit all three synchronized
version files in the release PR. The validator suggests versions but never picks
or changes one. Prereleases use SemVer ordering; build metadata alone is no bump.

Version-changing PRs must also request an unused remote tag and exceed the
relevant published versions using the existing publication checks. Invalid
SemVer, mismatched declarations, decreases, missing required bumps, occupied tags,
and publication lookup failures fail validation. Draft releases and invalid
version tags are ignored; all release API pages are checked.

The workflow checks out the exact PR head SHA and fetches the immutable base and
head SHAs from the PR event with complete history. It reads the target version
from that base SHA, and compares the head tree with its merge base using a
NUL-delimited Git diff across the entire PR. Rename detection is disabled so
removed and added paths are both checked. Missing commits/history or an invalid
base version fail with a diagnostic. No local branch or release tag is used.
Require branches to be up to date before merging so concurrent PRs are validated
against the latest target version.

After merge, Auto Tag repeats its existing release checks. An unchanged version
already tagged/published does not create a new release. An incremented eligible
version follows Auto Tag → tag validation → Release → signed/notarized builds.

## Manual releases and recovery

For a new manual release, bump and merge the version first. If automatic tagging
has already created the tag, use the recovery path below. Otherwise, a maintainer
can create an annotated tag on the merged commit and push it using their usual
Git credentials:

```sh
git tag -a v1.3.0 <merged-commit-sha> -m 'Bifrost v1.3.0'
git push origin refs/tags/v1.3.0
```

For an existing tag, open **Actions → Release → Run workflow**, select the existing tag
(such as `v1.3.0`) as the workflow ref. The optional tag input must match it. The tag must
already exist and match the application version in its commit. The tag must contain the current Release workflow and validation scripts;
the build uses the tagged commit. Only release trusted commits merged into `main`.

If a build fails after tag creation, the failure remains a failed Actions run.
Re-run failed jobs, or dispatch **Release** for the existing tag. Already published releases are skipped on reruns.
Do not delete or move a published tag to retry. Already published releases are
skipped, including manual dispatches; historical release artifacts are never updated by a new run. For an interrupted published
release, re-run its failed publication job to finish the original matrix.

## Repository setup

- Enable GitHub Actions and permit the actions already used by the release pipeline.
  Repository/organization policies and tag rulesets must allow `github-actions[bot]`
  to create `v*` tags. Workflows request `contents: write` only for tagging/releasing;
  validation jobs request `contents: read`. No global write-token default is needed.
- Keep existing repository/organization secrets: `TAURI_SIGNING_PRIVATE_KEY`,
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `APPLE_CERTIFICATE`,
  `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`,
  `APPLE_PASSWORD`, and `APPLE_TEAM_ID`. Jobs use these secrets directly.
- Protect `main`, require **Version validation**, and require the branch to be
  up to date. Review workflow changes carefully. Restrict tag creation/deletion
  to trusted maintainers and the tagging automation. Branch/tag rules are the
  trust boundary for code built with signing secrets.
- No repository settings, secrets, tags, or releases are changed by this implementation.

## Reliability and updater behavior

Auto Tag and Release each retain their existing separate concurrency groups.
Unchanged versions, existing tags, and published versions skip automatic release.
A rejected push is rechecked remotely to handle a competing tag creator; only the
successful creator proceeds. Lookup and push failures fail closed.

GitHub concurrency retains at most one running and one pending run; a newer push
can replace a pending release run. Each automatic run compares its version with
the push event’s previous main commit, so rapid merges may skip intermediate,
untagged versions. Space release
bumps apart if each intermediate version must be published. There is no automatic
retry after a tag was created: use the recovery path above if the run is interrupted
between tag creation and validation. Explicit manual retries are allowed;
concurrency serializes them rather than treating them as new automatic releases.

Updater configuration, public key, `createUpdaterArtifacts`, Tauri private signing
keys, `latest.json` generation, and NSIS preference are unchanged. The existing
`.sig` asset cleanup still runs after the Tauri action: it deletes standalone
signature assets only, leaving signatures embedded in `latest.json` intact.
Prerelease status is derived from SemVer prerelease identifiers, so a hyphen in
build metadata alone does not incorrectly mark a stable version as a prerelease.

Local validation: `npm test`, `npm run build`, `node scripts/validate-version.js`,
and `actionlint .github/workflows/*.yml`. Real signing, notarization, GitHub token
policies, and updater downloads require an actual trusted release run to verify.
