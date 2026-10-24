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
3. `Auto Tag Bifrost` validates the merged commit, checks the remote tag, and
   creates annotated tag `v1.3.0` pointing at that push's exact commit SHA.
4. Only the job that successfully pushes the new tag calls `release.yml`, passing
   `v1.3.0` and inheriting the existing repository/organization signing secrets.
5. Release validation resolves that tag to a commit SHA, requires that commit to
   be reachable from `main`, and checks its configuration versions against the
   tag. Both macOS and Windows check out that exact SHA. The existing sequential
   matrix, signing, notarization, release notes, and asset publication run as before.

No PAT is needed. Tags pushed with `GITHUB_TOKEN` do not start another tag-push
workflow, so the caller explicitly invokes the reusable workflow. Human-pushed
`v*` tags still start the same release workflow. See
[GitHub's reusable workflow documentation](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows).

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
jobs of **Auto Tag Bifrost** finds the existing tag and skips release, by design.
Do not delete or move a published tag to retry. A deliberate manual retry can
update an existing release and its assets; it is not a new version release.

## Repository setup

- Enable GitHub Actions and permit the actions already used by the release pipeline.
  Repository/organization policies and tag rulesets must allow `github-actions[bot]`
  to create `v*` tags. Workflows request `contents: write` only for tagging/releasing;
  validation jobs request `contents: read`. No global write-token default is needed.
- Keep existing repository/organization secrets: `TAURI_SIGNING_PRIVATE_KEY`,
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `APPLE_CERTIFICATE`,
  `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`,
  `APPLE_PASSWORD`, and `APPLE_TEAM_ID`. The reusable call uses `secrets: inherit`.
- Protect `main`, require **Version validation**, and require the branch to be
  up to date. Review workflow changes carefully. Restrict tag creation/deletion
  to trusted maintainers and the tagging automation. Branch/tag rules are the
  trust boundary for code built with signing secrets.
- No repository settings, secrets, tags, or releases are changed by this implementation.

## Reliability and updater behavior

Auto-tag runs are serialized across tagging and their called releases. Existing
tags skip release; a rejected push is rechecked remotely to handle a competing
tag creator. Only the successful creator calls the reusable workflow. Lookup or
push failures without an existing remote tag fail the run. Release runs use the
same per-tag concurrency group for reusable calls, manual tag pushes, and manual
dispatches, so builds for the same tag cannot overlap. Different tags can still
have manual release runs concurrently; avoid manually publishing different
versions at the same time while the automatic release is running.

GitHub concurrency retains at most one running and one pending run; a newer push
can replace a pending auto-tag run. The latest main commit is validated and
released, so rapid merges may skip intermediate, untagged versions. Space release
bumps apart if each intermediate version must be published. There is no automatic
retry after a tag was created: use the recovery path above if the run is interrupted
between tag creation and release invocation. Explicit manual retries are allowed;
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
