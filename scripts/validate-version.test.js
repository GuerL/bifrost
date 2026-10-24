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

    const autoTag = workflow('auto-tag');
    assert.deepEqual(autoTag.on, { push: { branches: ['main'] } });
    assert.equal(autoTag.jobs.release.uses, './.github/workflows/release.yml');
    assert.equal(autoTag.jobs.release.with.tag, '${{ needs.auto-tag.outputs.tag }}');

    const release = workflow('release');
    assert.deepEqual(release.on.push, { tags: ['v*'] });
    for (const event of ['workflow_call', 'workflow_dispatch']) {
        assert.equal(release.on[event].inputs.tag.required, true);
        assert.equal(release.on[event].inputs.tag.type, 'string');
    }
    const resolve = release.jobs['validate-tag'].steps.find(step => step.id === 'resolve');
    assert.equal(resolve.env.TAG, '${{ inputs.tag || github.ref_name }}');
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

async function scenario({ base, exists = false, releases = [], remoteError = false, apiError = false, pages } = {}) {
    const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
    vi.stubEnv('BASE_SHA', base === undefined ? '' : 'base-sha');
    vi.stubEnv('EXPECTED_TAG', '');
    vi.stubEnv('VALIDATION_REF', '');
    vi.stubEnv('CHECK_REMOTE', 'true');
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
