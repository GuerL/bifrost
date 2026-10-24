import { test, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import YAML from 'yaml';
import assert from 'node:assert/strict';
import { parseSemver } from './set-version.js';
import { compareVersions, validateVersions, assertIncreasing, validateCurrentVersion } from './validate-version.js';

test('main branch workflows retain PR validation, auto-tagging, and all release entry points', () => {
    const workflow = name => YAML.parse(fs.readFileSync(`.github/workflows/${name}.yml`, 'utf8'));
    const validation = workflow('version-check');
    assert.deepEqual(validation.on, { pull_request: { branches: ['main'] } });
    const validateStep = validation.jobs['version-check'].steps.find(step => step.run === 'node scripts/validate-version.js');
    assert.equal(validateStep.env.BASE_SHA, '${{ github.event.pull_request.base.sha }}');

    assert.equal(fs.existsSync('.github/workflows/auto-tag.yml'), false);
    const release = workflow('release');
    assert.equal(release.name, 'Release');
    assert.deepEqual(Object.keys(release.jobs), ['auto-tag', 'validate-tag', 'publish-tauri']);
    assert.deepEqual(release.on.push, { branches: ['main'], tags: ['v*'] });
    assert.equal(release.on.workflow_call, undefined);
    assert.equal(release.on.workflow_dispatch.inputs.tag.required, true);
    assert.equal(release.jobs['validate-tag'].needs, 'auto-tag');
    assert.equal(release.jobs['publish-tauri'].needs, 'validate-tag');
    assert.match(release.jobs['validate-tag'].if, /always\(\)/);
    assert.match(release.jobs['publish-tauri'].if, /always\(\)/);
    assert.equal(release.jobs['auto-tag'].outputs.sha, '${{ github.sha }}');
    assert.equal(release.jobs['auto-tag'].outputs.publish, "${{ steps.create.outputs.created || 'false' }}");
    assert.equal(release.concurrency.group, 'bifrost-release');
    assert.equal(release.concurrency['cancel-in-progress'], false);
    assert.equal(release.jobs['publish-tauri'].strategy['max-parallel'], 1);
    assert.deepEqual(release.jobs['publish-tauri'].strategy.matrix.include.map(entry => entry.runner),
        ['macos-26', 'macos-26-intel', 'windows-latest']);
    const resolve = release.jobs['validate-tag'].steps.find(step => step.id === 'resolve');
    assert.equal(resolve.env.TAG, '${{ needs.auto-tag.outputs.tag || inputs.tag || github.ref_name }}');
    assert.equal(resolve.env.EXPECTED_SHA, '${{ needs.auto-tag.outputs.sha }}');
    assert.ok(resolve.run.includes('[ "$sha" != "$EXPECTED_SHA" ]'));
    assert.equal(release.jobs['validate-tag'].outputs.tag, '${{ steps.resolve.outputs.tag }}');
    const tauri = release.jobs['publish-tauri'].steps.find(step => step.id === 'tauri_release');
    assert.equal(tauri.with.tagName, '${{ needs.validate-tag.outputs.tag }}');
    assert.equal(tauri.with.releaseName, 'Bifrost ${{ needs.validate-tag.outputs.tag }}');
    assert.match(resolve.run, /git merge-base --is-ancestor "\$sha" origin\/main \|\|/);
    assert.match(resolve.run, /VALIDATION_REF="\$sha" EXPECTED_TAG="\$TAG" node scripts\/validate-version.js/);
    assert.equal(release.jobs['publish-tauri'].steps.find(step => step.name === 'Checkout').with.ref,
        '${{ needs.validate-tag.outputs.sha }}');
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
    ['push-error', 1, null],
    ['lookup-error', 1, null],
])('tag push handling: %s (all Git commands are simulated)', (mode, status, expected) => {
    const workflow = YAML.parse(fs.readFileSync('.github/workflows/release.yml', 'utf8'));
    const script = workflow.jobs['auto-tag'].steps.find(step => step.id === 'create').run;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-tag-race-'));
    const output = path.join(dir, 'output');
    fs.writeFileSync(path.join(dir, 'git'), `#!/bin/bash
case "$1" in
  config|tag) exit 0 ;;
  push)
    if [ "$MODE" = success ]; then printf '*\\trefs/tags/v1.3.0:refs/tags/v1.3.0\\t[new tag]\\n'; exit 0; fi
    if [ "$MODE" = up-to-date ]; then printf '=\\trefs/tags/v1.3.0:refs/tags/v1.3.0\\t[up to date]\\n'; exit 0; fi
    exit 1 ;;
  ls-remote)
    if [ "$MODE" = lookup-error ]; then exit 1; fi
    if [ "$MODE" = race ]; then echo 'abc refs/tags/v1.3.0'; fi
    exit 0 ;;
  *) exit 99 ;;
esac
`, { mode: 0o755 });
    try {
        const result = spawnSync('bash', ['-c', script], { encoding: 'utf8', env: {
            ...process.env, PATH: `${dir}:${process.env.PATH}`, MODE: mode,
            TAG: 'v1.3.0', GITHUB_SHA: 'fixture-sha', GITHUB_OUTPUT: output,
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
    ['new main version', 'push', 'refs/heads/main', 'success', 'true', true],
    ['unchanged main version', 'push', 'refs/heads/main', 'success', '', false],
    ['existing main tag', 'push', 'refs/heads/main', 'success', 'false', false],
    ['invalid main version', 'push', 'refs/heads/main', 'failure', '', false],
    ['manual existing tag', 'workflow_dispatch', 'refs/heads/main', 'skipped', '', true],
    ['external tag push', 'push', 'refs/tags/v1.17.0', 'skipped', '', true],
])('validation entry gate: %s', (_, event, ref, result, publish, expected) => {
    const workflow = YAML.parse(fs.readFileSync('.github/workflows/release.yml', 'utf8'));
    const expression = workflow.jobs['validate-tag'].if.replaceAll('needs.auto-tag', 'needs.autoTag');
    const evaluate = new Function('github', 'needs', 'always', 'startsWith', 'return ' + expression);
    assert.equal(evaluate({ event_name: event, ref }, { autoTag: { result, outputs: { publish } } },
        () => true, (value, prefix) => value.startsWith(prefix)), expected);
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

test.each([
    ['valid inputs', 'v1.16.2', 'a'.repeat(40), 0],
    ['missing SHA', 'v1.16.2', '', 1],
    ['branch instead of SHA', 'v1.16.2', 'main', 1],
    ['missing tag', '', 'a'.repeat(40), 1],
    ['invalid tag ref', 'v1.16.2..invalid', 'a'.repeat(40), 1],
])('release checkout fails closed: %s', (_, tag, sha, expected) => {
    const workflow = YAML.parse(fs.readFileSync('.github/workflows/release.yml', 'utf8'));
    const steps = workflow.jobs['publish-tauri'].steps;
    const guard = steps.find(step => step.name === 'Require validated release inputs');
    assert.ok(steps.indexOf(guard) < steps.findIndex(step => step.name === 'Checkout'));
    assert.equal(guard.env.RELEASE_TAG, '${{ needs.validate-tag.outputs.tag }}');
    assert.equal(guard.env.RELEASE_SHA, '${{ needs.validate-tag.outputs.sha }}');
    assert.equal(workflow.jobs['validate-tag'].outputs.sha, '${{ steps.resolve.outputs.sha }}');
    const result = spawnSync('bash', ['-c', guard.run], { encoding: 'utf8', env: {
        ...process.env, RELEASE_TAG: tag, RELEASE_SHA: sha,
    } });
    assert.equal(result.status, expected, result.stderr);
});

test('release checkout verifies HEAD before any dependency install or build', () => {
    const workflow = YAML.parse(fs.readFileSync('.github/workflows/release.yml', 'utf8'));
    const steps = workflow.jobs['publish-tauri'].steps;
    const verify = steps.find(step => step.name === 'Verify release checkout');
    assert.ok(steps.indexOf(verify) > steps.findIndex(step => step.name === 'Checkout'));
    assert.ok(steps.indexOf(verify) < steps.findIndex(step => step.name === 'Setup Node.js'));
    assert.equal(verify.env.RELEASE_SHA, '${{ needs.validate-tag.outputs.sha }}');
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    for (const [sha, status] of [[head, 0], ['0'.repeat(40), 1]]) {
        const result = spawnSync('bash', ['-c', verify.run], { encoding: 'utf8', env: {
            ...process.env, RELEASE_SHA: sha,
        } });
        assert.equal(result.status, status, result.stderr);
    }
});
