#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseSemver } from './set-version.js';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

export function compareVersions(a, b) {
    const left = parseSemver(a);
    const right = parseSemver(b);
    if (!left || !right) throw new Error(`Cannot compare invalid SemVer: ${a}, ${b}`);
    for (let i = 0; i < 3; i++) {
        const x = BigInt(left.core[i]), y = BigInt(right.core[i]);
        if (x !== y) return x > y ? 1 : -1;
    }
    const x = left.prerelease, y = right.prerelease;
    if (!x.length || !y.length) return x.length === y.length ? 0 : x.length ? -1 : 1;
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        if (x[i] === undefined) return -1;
        if (y[i] === undefined) return 1;
        if (x[i] === y[i]) continue;
        const xn = /^\d+$/.test(x[i]), yn = /^\d+$/.test(y[i]);
        if (xn && yn) return BigInt(x[i]) > BigInt(y[i]) ? 1 : -1;
        if (xn !== yn) return xn ? -1 : 1;
        return x[i] > y[i] ? 1 : -1;
    }
    return 0;
}

export function validateVersions(packageJson, cargoToml, tauri) {
    const version = packageJson.version;
    if (!parseSemver(version)) throw new Error(`package.json has invalid SemVer: ${JSON.stringify(version)}`);
    const section = cargoToml.match(/^\[package\]\s*\r?\n([\s\S]*?)(?=^\[|(?![\s\S]))/m)?.[1];
    const cargo = section?.match(/^\s*version\s*=\s*"([^"]+)"\s*(?:#.*)?$/m)?.[1];
    if (cargo !== version) throw new Error(`src-tauri/Cargo.toml [package].version (${cargo ?? 'missing'}) must equal package.json (${version}). Run npm run version:set -- ${version}`);
    if (tauri.version !== version) throw new Error(`src-tauri/tauri.conf.json version (${tauri.version ?? 'missing'}) must equal package.json (${version}).`);
    return version;
}

export function assertIncreasing(version, baseline, source) {
    if (compareVersions(version, baseline) <= 0) {
        throw new Error(`${version} must be greater than ${baseline} (${source}); build metadata does not increase SemVer precedence.`);
    }
}

async function publishedVersions() {
    const versions = [];
    for (let page = 1; ; page++) {
        const response = await fetch(`${process.env.GITHUB_API_URL || 'https://api.github.com'}/repos/${process.env.GITHUB_REPOSITORY}/releases?per_page=100&page=${page}`, {
            signal: AbortSignal.timeout(30_000),
            headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
        });
        if (!response.ok) throw new Error(`Cannot read published releases: HTTP ${response.status}`);
        const releases = await response.json();
        for (const release of releases) {
            const version = release.tag_name?.startsWith('v') ? release.tag_name.slice(1) : '';
            if (!release.draft && release.published_at && parseSemver(version)) versions.push(version);
        }
        if (releases.length < 100) return versions;
    }
}

export async function validateCurrentVersion() {
    const read = file => process.env.VALIDATION_REF ? git('show', `${process.env.VALIDATION_REF}:${file}`) : fs.readFileSync(file, 'utf8');
    const version = validateVersions(JSON.parse(read('package.json')),
        read('src-tauri/Cargo.toml'), JSON.parse(read('src-tauri/tauri.conf.json')));
    const tag = `v${version}`;
    if (process.env.EXPECTED_TAG && process.env.EXPECTED_TAG !== tag) throw new Error(`Requested tag ${process.env.EXPECTED_TAG} does not match application tag ${tag}.`);
    let changed = true;
    // PR validation supplies the target main branch's base SHA, not its moving tip.
    if (process.env.BASE_SHA) {
        const base = JSON.parse(git('show', `${process.env.BASE_SHA}:package.json`)).version;
        changed = base !== version;
        if (changed) assertIncreasing(version, base, 'PR base');
    }
    // Automatic pushes compare against their immutable previous main commit.
    const releaseBase = process.env.RELEASE_BASE_SHA;
    if (releaseBase && !/^0+$/.test(releaseBase)) {
        const base = JSON.parse(git('show', `${releaseBase}:package.json`)).version;
        changed = base !== version;
        if (changed) assertIncreasing(version, base, 'previous main commit');
    }
    if (process.env.CHECK_REMOTE === 'true') {
        // A failed remote lookup must fail validation, never masquerade as an absent tag.
        const exists = git('ls-remote', '--refs', 'origin', `refs/tags/${tag}`) !== '';
        if (process.env.BASE_SHA && changed && exists) throw new Error(`Requested tag ${tag} already exists on origin. Choose a new version.`);
        const releases = process.env.SKIP_PUBLISHED === 'true' || (changed && !exists) ? await publishedVersions() : [];
        const published = process.env.SKIP_PUBLISHED === 'true' && releases.includes(version);
        if ((changed && !exists && !published) || (process.env.RELEASE_ELIGIBILITY === 'true' && !published)) {
            const relevant = releases.filter(v => parseSemver(version).prerelease.length || !parseSemver(v).prerelease.length);
            const latest = relevant.sort(compareVersions).at(-1);
            if (latest) assertIncreasing(version, latest, 'latest relevant published release');
        }
        if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `exists=${exists}\npublished=${published}\n`);
    }
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\ntag=${tag}\nprerelease=${parseSemver(version).prerelease.length > 0}\n`);
    console.log(`Validated ${tag}${process.env.BASE_SHA ? ` (version ${changed ? 'changed' : 'unchanged'})` : ''}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    validateCurrentVersion().catch(error => { console.error(`Version validation failed: ${error.message}`); process.exitCode = 1; });
}
