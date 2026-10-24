import { test, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import YAML from 'yaml';
import assert from 'node:assert/strict';
import { parseSemver } from './set-version.js';
import { compareVersions, validateVersions, assertIncreasing, validateCurrentVersion } from './validate-version.js';

test('independent tag dispatch orchestration and preserved build configuration', () => {
    const load = name => YAML.parse(fs.readFileSync(`.github/workflows/${name}.yml`, 'utf8'));
    const auto = load('auto-tag'), release = load('release');
    assert.deepEqual(auto.on, { push: { branches: ['main'] } });
    assert.deepEqual(Object.keys(auto.jobs), ['auto-tag', 'validate-tag', 'dispatch-release']);
    assert.equal(auto.jobs['validate-tag'].needs, 'auto-tag');
    assert.equal(auto.jobs['dispatch-release'].needs, 'validate-tag');
    assert.equal(auto.jobs['dispatch-release'].permissions.actions, 'write');
    assert.equal(auto.jobs['validate-tag'].if, "needs.auto-tag.outputs.publish == 'true'");
    assert.equal(auto.jobs['dispatch-release'].if, "needs.validate-tag.outputs.publish == 'true'");
    assert.equal(release.name, 'Release');
    assert.deepEqual(Object.keys(release.on), ['workflow_dispatch']);
    assert.deepEqual(Object.keys(release.jobs), ['validate-tag', 'publish-tauri']);
    assert.equal(release.concurrency['cancel-in-progress'], false);
    assert.equal(auto.concurrency['cancel-in-progress'], false);
    const build = release.jobs['publish-tauri'];
    assert.equal(build.strategy['max-parallel'], 1);
    assert.equal(build.strategy['fail-fast'], false);
    assert.deepEqual(build.strategy.matrix.include, [
        { label: 'macOS ARM64', runner: 'macos-26', args: '', tauri_timeout: 45 },
        { label: 'macOS Intel', runner: 'macos-26-intel', args: '', tauri_timeout: 45 },
        { label: 'Windows', runner: 'windows-latest', args: '--config src-tauri/tauri.windows.conf.json', tauri_timeout: 45 },
    ]);
    assert.equal(build.steps.find(s => s.name === 'Checkout').with.ref, '${{ needs.validate-tag.outputs.sha }}');
    const resolve = release.jobs['validate-tag'].steps.find(s => s.id === 'resolve');
    assert.equal(resolve.env.TAG, '${{ github.ref_name }}');
    assert.equal(resolve.env.EXPECTED_SHA, '${{ github.sha }}');
    assert.match(resolve.run, /FETCH_HEAD\^\{commit\}/);
    assert.match(resolve.run, /git merge-base --is-ancestor/);
    assert.match(resolve.run, /remote_object.*git ls-remote/);
    assert.ok(build.steps.some(s => s.name === 'Remove updater signature assets from release'));
});

test('shared parser accepts SemVer and rejects numeric leading zeroes', () => {
    for (const v of ['1.2.3', '0.0.0', '1.2.3-alpha-1', '1.2.3-rc.1+build.01', '1.2.3-01a']) assert.ok(parseSemver(v), v);
    for (const v of ['v1.2.3', '01.2.3', '1.2', '1.2.3-01', '1.2.3-rc.01', '1.2.3-', '1.2.3\n', null]) assert.equal(parseSemver(v), null, String(v));
});
test('SemVer ordering handles numeric prereleases and ignores metadata', () => {
    const ordered = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.0.1', '1.1.0', '2.0.0'];
    for (let i = 1; i < ordered.length; i++) {
        assert.equal(compareVersions(ordered[i - 1], ordered[i]), -1);
        assert.equal(compareVersions(ordered[i], ordered[i - 1]), 1);
    }
    assert.equal(compareVersions('1.0.0+first', '1.0.0+second'), 0);
    assert.throws(() => assertIncreasing('1.0.0+second', '1.0.0+first', 'release'), /must be greater/);
    assert.throws(() => assertIncreasing('1.0.0', '2.0.0', 'release'), /must be greater/);
});
test('only the Cargo package version is used and all three files must agree', () => {
    const cargo = '[package]\nname = "Bifrost"\nversion = "1.2.3" # app\n\n[dependencies]\nversion = "9.0.0"\n';
    assert.equal(validateVersions({ version: '1.2.3' }, cargo, { version: '1.2.3' }), '1.2.3');
    assert.throws(() => validateVersions({ version: '1.2.4' }, cargo, { version: '1.2.4' }), /Cargo.toml/);
    assert.throws(() => validateVersions({ version: '1.2.3' }, cargo, {}), /tauri.conf.json/);
    assert.throws(() => validateVersions({ version: '1.2.3' }, '[dependencies]\nversion = "1.2.3"', { version: '1.2.3' }), /missing/);
});

vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal(), execFileSync: vi.fn() }));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

async function scenario({ base, exists = false, releases = [], remoteError = false, apiError = false, pages, automatic = false, releaseBase = false } = {}) {
    const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
    vi.stubEnv('RELEASE_BASE_SHA', releaseBase ? 'previous-main' : '');
    vi.stubEnv('BASE_SHA', base === undefined || releaseBase ? '' : 'base-sha');
    vi.stubEnv('EXPECTED_TAG', '');
    vi.stubEnv('VALIDATION_REF', '');
    vi.stubEnv('CHECK_REMOTE', 'true');
    vi.stubEnv('SKIP_PUBLISHED', automatic ? 'true' : '');
    vi.stubEnv('GITHUB_REPOSITORY', 'fixture/repo');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-version-'));
    const output = path.join(dir, 'output');
    vi.stubEnv('GITHUB_OUTPUT', output);
    execFileSync.mockImplementation((command, args) => {
        if (args[0] === 'show') return JSON.stringify({ version: base });
        if (remoteError) throw new Error('remote unavailable');
        return exists ? `abc refs/tags/v${version}` : '';
    });
    let page = 0;
    const api = vi.fn(async () => ({ ok: !apiError, status: 403, json: async () => pages ? pages[page++] : releases }));
    vi.stubGlobal('fetch', api);
    try {
        await validateCurrentVersion();
        return { output: fs.readFileSync(output, 'utf8'), api };
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('unchanged PR passes even when its existing tag is published', async () => {
    const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
    const result = await scenario({ base: version, exists: true });
    assert.match(result.output, /exists=true/);
    assert.equal(result.api.mock.calls.length, 0);
});
test('version-changing PR rejects occupied tags and downgrades', async () => {
    await assert.rejects(scenario({ base: '0.1.0', exists: true }), /already exists/);
    await assert.rejects(scenario({ base: '999.0.0' }), /PR base/);
});
test('new tag requires a newer published version; drafts and unrelated tags are ignored', async () => {
    await assert.rejects(scenario({ releases: [{ tag_name: 'v999.0.0', published_at: 'today' }] }), /latest relevant published/);
    const result = await scenario({ base: '0.1.0', releases: [
        { tag_name: 'v999.0.0', draft: true, published_at: 'today' },
        { tag_name: 'v999.0.0-alpha.1', published_at: 'today' },
        { tag_name: 'unrelated', published_at: 'today' },
        { tag_name: 'v0.1.0', published_at: 'today' },
    ] });
    assert.match(result.output, /exists=false/);
    assert.equal(result.api.mock.calls.length, 1);
});
test('network and API failures fail closed', async () => {
    await assert.rejects(scenario({ remoteError: true }), /remote unavailable/);
    await assert.rejects(scenario({ apiError: true }), /HTTP 403/);
});

test('release comparison reads later API pages', async () => {
    await assert.rejects(scenario({ pages: [
        Array.from({ length: 100 }, () => ({ tag_name: 'unrelated' })),
        [{ tag_name: 'v999.0.0', published_at: 'today' }],
    ] }), /latest relevant published/);
});

test.each([
    ['success', 0, 'created=true'],
    ['race', 0, 'created=false'],
    ['up-to-date', 0, 'created=false'],
    ['recover', 0, 'created=true'],
    ['occupied', 1, null],
    ['push-error', 1, null],
    ['lookup-error', 1, null],
])('tag push handling: %s (all Git commands are simulated)', (mode, status, expected) => {
    const workflow = YAML.parse(fs.readFileSync('.github/workflows/auto-tag.yml', 'utf8'));
    const script = workflow.jobs['auto-tag'].steps.find(step => step.id === 'create').run;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-tag-race-'));
    const output = path.join(dir, 'output');
    fs.writeFileSync(path.join(dir, 'git'), `#!/bin/bash
case "$1" in
  config|tag) exit 0 ;;
  push)
    if [ "$MODE" = success ]; then printf '*\\trefs/tags/v1.3.0:refs/tags/v1.3.0\\t[new tag]\\n'; exit 0; fi
    if [ "$MODE" = up-to-date ]; then printf '=\\trefs/tags/v1.3.0:refs/tags/v1.3.0\\t[up to date]\\n'; exit 0; fi
    touch "$RACE_MARKER"
    exit 1 ;;
  ls-remote)
    if [ "$MODE" = recover ]; then printf 'object\\trefs/tags/v1.3.0\\nfixture-sha\\trefs/tags/v1.3.0^{}\\n'; fi
    if [ "$MODE" = occupied ]; then echo 'other refs/tags/v1.3.0'; fi
    if [ "$MODE" = lookup-error ]; then exit 1; fi
    if [ "$MODE" = race ] && [ -f "$RACE_MARKER" ]; then echo 'abc refs/tags/v1.3.0'; fi
    exit 0 ;;
  *) exit 99 ;;
esac
`, { mode: 0o755 });
    try {
        const result = spawnSync('bash', ['-c', script], { encoding: 'utf8', env: {
            ...process.env, PATH: `${dir}:${process.env.PATH}`, MODE: mode,
            RACE_MARKER: path.join(dir, 'pushed'), TAG: 'v1.3.0', GITHUB_SHA: 'fixture-sha', GITHUB_OUTPUT: output,
        } });
        assert.equal(result.status, status, result.stderr);
        if (expected) assert.match(fs.readFileSync(output, 'utf8'), new RegExp(expected));
        else assert.equal(fs.existsSync(output), false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('automatic release skips a published version even if its tag is missing', async () => {
    const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
    const result = await scenario({ automatic: true, releases: [{ tag_name: 'v' + version, published_at: 'today' }] });
    assert.match(result.output, /exists=false/);
    assert.match(result.output, /published=true/);
});
test('automatic release allows a new version and skips an existing tag', async () => {
    assert.match((await scenario({ automatic: true, exists: true })).output, /exists=true/);
    const result = await scenario({ automatic: true });
    assert.match(result.output, /exists=false/);
    assert.match(result.output, /published=false/);
});

test('unchanged automatic version skips tagging even without a remote tag', async () => {
    const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
    assert.match((await scenario({ base: version, releaseBase: true, automatic: true })).output, /changed=false/);
});
test('automatic pushes reject regression against previous main', async () => {
    await assert.rejects(scenario({ base: '999.0.0', releaseBase: true, automatic: true }), /previous main commit/);
});

test.each([
    ['unpublished tag', null, 404, 'true'],
    ['draft release', { draft: true }, null, 'true'],
    ['published release', { draft: false, published_at: 'today' }, null, 'false'],
    ['API failure', null, 403, null],
])('publication gate: %s', async (_, release, status, expected) => {
    const workflow = YAML.parse(fs.readFileSync('.github/workflows/release.yml', 'utf8'));
    const script = workflow.jobs['validate-tag'].steps.find(step => step.id === 'publication').with.script;
    const execute = new Function('github', 'context', 'core', 'return (async () => {' + script + '})()');
    const setOutput = vi.fn();
    const github = { rest: { repos: { getReleaseByTag: async () => {
        if (status) throw Object.assign(new Error('API error'), { status });
        return { data: release };
    } } } };
    const run = execute(github, { repo: { owner: 'fixture', repo: 'repo' } }, { setOutput });
    if (expected === null) await assert.rejects(run, /API error/);
    else {
        await run;
        assert.deepEqual(setOutput.mock.calls, [['publish', expected]]);
    }
});

test.each(['new', 'existing', 'moved', 'api-error', 'workflow-mismatch'])(
    'dispatch request uses the actual tag and fails closed: %s', async mode => {
        const workflow = YAML.parse(fs.readFileSync('.github/workflows/auto-tag.yml', 'utf8'));
        const script = workflow.jobs['dispatch-release'].steps.at(-1).with.script;
        const execute = new Function('github', 'context', 'core', 'require', 'return (async () => {' + script + '})()');
        vi.stubEnv('TAG', 'v1.16.3');
        vi.stubEnv('SHA', 'expected-commit');
        const config = fs.readFileSync('.github/workflows/release.yml', 'utf8');
        const dispatch = vi.fn(async () => { if (mode === 'api-error') throw new Error('HTTP 403'); });
        const github = {
            paginate: async () => mode === 'existing' ? [{ head_branch: 'v1.16.3' }] : [],
            rest: {
                repos: {
                    get: async () => ({ data: { default_branch: 'main' } }),
                    getContent: async () => ({ data: { content: Buffer.from(mode === 'workflow-mismatch' ? 'old config' : config).toString('base64') } }),
                },
                actions: { listWorkflowRuns: () => {}, createWorkflowDispatch: dispatch },
                git: {
                    getRef: async () => ({ data: { object: { type: 'tag', sha: 'annotated-object' } } }),
                    getTag: async () => ({ data: { object: { type: 'commit', sha: mode === 'moved' ? 'other' : 'expected-commit' } } }),
                },
            },
        };
        const run = execute(github, { repo: { owner: 'fixture', repo: 'repo' } }, { info: vi.fn() }, () => ({ readFileSync: () => config }));
        if (['moved', 'api-error', 'workflow-mismatch'].includes(mode)) await assert.rejects(run);
        else await run;
        if (['new', 'api-error'].includes(mode)) assert.deepEqual(dispatch.mock.calls, [[{
            owner: 'fixture', repo: 'repo', workflow_id: 'release.yml', ref: 'v1.16.3',
        }]]);
        else assert.equal(dispatch.mock.calls.length, 0);
    });

test.each([
    ['valid annotated tag', 'refs/tags/v1.2.3', '', 'valid', 0],
    ['branch ref', 'refs/heads/main', '', 'valid', 1],
    ['mismatched input', 'refs/tags/v1.2.3', 'v9.0.0', 'valid', 1],
    ['wrong commit', 'refs/tags/v1.2.3', '', 'wrong-commit', 1],
    ['moved tag object', 'refs/tags/v1.2.3', '', 'moved', 1],
    ['metadata mismatch', 'refs/tags/v1.2.3', '', 'metadata', 1],
    ['not on main', 'refs/tags/v1.2.3', '', 'not-main', 1],
    ['missing remote tag', 'refs/tags/v1.2.3', '', 'missing', 1],
])('Release validation: %s (no real Git writes or API calls)', (_, ref, input, mode, expected) => {
    const workflow = YAML.parse(fs.readFileSync('.github/workflows/release.yml', 'utf8'));
    const script = workflow.jobs['validate-tag'].steps.find(s => s.id === 'resolve').run;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-release-ref-'));
    fs.writeFileSync(path.join(dir, 'git'), `#!/bin/bash
case "$1" in
  check-ref-format) exit 0 ;;
  fetch) [ "$MODE" != missing ]; exit $? ;;
  rev-parse)
    if [ "$2" = FETCH_HEAD ]; then echo annotated-object;
    elif [ "$MODE" = wrong-commit ]; then echo other; else echo expected-commit; fi ;;
  merge-base) [ "$MODE" != not-main ]; exit $? ;;
  show) cat .github/workflows/release.yml ;;
  ls-remote)
    if [ "$MODE" = moved ]; then echo other; else printf 'annotated-object\\trefs/tags/v1.2.3\\n'; fi ;;
  *) exit 99 ;;
esac
`, { mode: 0o755 });
    fs.writeFileSync(path.join(dir, 'node'), '#!/bin/bash\n[ "$MODE" != metadata ]\n', { mode: 0o755 });
    try {
        const result = spawnSync('bash', ['-c', script], { encoding: 'utf8', env: {
            ...process.env, PATH: `${dir}:${process.env.PATH}`, MODE: mode,
            TAG: 'v1.2.3', EXPECTED_SHA: 'expected-commit', REQUIRE_TAG_REF: 'true', INPUT_TAG: input,
            GITHUB_REF: ref, GITHUB_EVENT_NAME: 'workflow_dispatch', RUNNER_TEMP: dir,
            GITHUB_OUTPUT: path.join(dir, 'output'),
        } });
        assert.equal(result.status, expected, result.stderr);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('release eligibility rejects an older existing unpublished tag', async () => {
    vi.stubEnv('RELEASE_ELIGIBILITY', 'true');
    await assert.rejects(scenario({ automatic: true, exists: true,
        releases: [{ tag_name: 'v999.0.0', published_at: 'today' }] }), /latest relevant published/);
});
