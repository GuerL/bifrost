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
3. **Release** validates the merged commit, checks published releases and the remote
   tag, and creates an annotated tag only for a new, increasing version.
4. In the same workflow run, `auto-tag → validate-tag → publish-tauri` passes
   the tag and push SHA explicitly. Validation requires the tag to resolve to
   that SHA, be reachable from `main`, and match all three version files.
5. The sequential matrix builds macOS ARM64, macOS Intel, and Windows from the
   validated SHA, preserving signing, notarization, updater assets, and release notes.

No PAT is needed. Tags pushed with `GITHUB_TOKEN` do not start another tag-push
workflow ([GitHub documentation](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow)).
Human-pushed `v*` tags and manual dispatches enter the same **Release** workflow,
skipping automatic tagging. All entry points share one concurrency group.

## PR check policy

`Version validation` runs on every PR to `main`, without path filters. Use its
job named **Version validation** as a required branch protection check. It uses
`pull_request`, a read-only token, and no signing secrets or release jobs.

Every PR must have syntactically valid, synchronized versions. A PR is a version
change only when the candidate `package.json` version differs from the PR base
commit's version. Such PRs must:

- Increase SemVer precedence relative to the PR base.
- Request a tag that does not already exist remotely.
- Exceed the highest relevant published release by SemVer precedence, regardless
  of publication date. Stable candidates compare against stable versions;
  prerelease candidates compare against both stable and prerelease versions.
  Draft releases and tags that are not `v` followed by valid SemVer are ignored.
  All release API pages are checked; lookup failures fail validation.

Unrelated PRs with an unchanged version may reuse the existing tag and need no
version bump. Synchronization is checked even when only a Rust/Tauri version is
changed. The check runs against GitHub's PR merge commit and compares with the PR
base SHA. Enable the branch protection option requiring branches to be up to date
before merging, so concurrent version PRs are revalidated against the latest base.
Auto-tagging repeats the checks after merge; an existing tag is always skipped.

## Manual releases and recovery

For a new manual release, bump and merge the version first. If automatic tagging
has already created the tag, use the recovery path below. Otherwise, a maintainer
can create an annotated tag on the merged commit and push it using their usual
Git credentials:

```sh
git tag -a v1.3.0 <merged-commit-sha> -m 'Bifrost v1.3.0'
git push origin refs/tags/v1.3.0
```

For an existing tag, open **Actions → Release → Run workflow**, select `main`
(the workflow implementation), and supply the tag, such as `v1.3.0`. The tag must
already exist and match the application version in its commit. This also supports
older tags whose commits predate the new validation script. The build still uses
the tagged commit. Only release trusted commits merged into `main`.

If a build fails after tag creation, the failure remains a failed Actions run.
Re-run failed jobs, or dispatch **Release** for the existing tag. Re-running all
jobs of **Release** finds the existing tag and skips release, by design.
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

All release runs are serialized across tagging, validation, and publication.
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
