#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const packageJsonPath = path.join(projectRoot, "package.json");
const cargoTomlPath = path.join(projectRoot, "src-tauri", "Cargo.toml");
const tauriConfigPath = path.join(projectRoot, "src-tauri", "tauri.conf.json");

const semverRegex =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function fail(message) {
    console.error(`❌ ${message}`);
    process.exit(1);
}

function loadJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
        fail(`Impossible de lire ${path.relative(projectRoot, filePath)}: ${String(error)}`);
    }
}

function writeJson(filePath, value) {
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function parseSemver(version) {
    const match = semverRegex.exec(version);
    if (!match) return null;
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
    };
}

function bumpVersion(version, bumpType) {
    const parsed = parseSemver(version);
    if (!parsed) return null;

    if (bumpType === "patch") {
        return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
    }
    if (bumpType === "minor") {
        return `${parsed.major}.${parsed.minor + 1}.0`;
    }
    if (bumpType === "major") {
        return `${parsed.major + 1}.0.0`;
    }

    return null;
}

function updateCargoTomlVersion(content, nextVersion) {
    const eol = content.includes("\r\n") ? "\r\n" : "\n";
    const hasTrailingNewline = /\r?\n$/.test(content);
    const rawLines = content.split(/\r?\n/);
    const lines = hasTrailingNewline ? rawLines.slice(0, -1) : rawLines;
    let inPackageSection = false;
    let updated = false;
    let previousVersion = null;

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const trimmed = line.trim();

        if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
            inPackageSection = trimmed === "[package]";
            continue;
        }

        if (!inPackageSection) continue;
        if (!/^\s*version\s*=/.test(line)) continue;

        const match = line.match(/^(\s*version\s*=\s*")([^"]*)(".*)$/);
        if (!match) {
            fail("Impossible de parser la ligne version dans src-tauri/Cargo.toml.");
        }

        previousVersion = match[2];
        const replaced = `${match[1]}${nextVersion}${match[3]}`;
        if (previousVersion !== nextVersion) {
            lines[index] = replaced;
        }

        updated = true;
        break;
    }

    if (!updated) {
        fail("Aucune clé version trouvée dans la section [package] de src-tauri/Cargo.toml.");
    }

    const nextContent = `${lines.join(eol)}${hasTrailingNewline ? eol : ""}`;
    return {
        content: nextContent,
        previousVersion,
    };
}

function parseArguments(argv) {
    if (argv.length === 0) {
        fail("Version manquante. Usage: npm run version:set -- 1.2.3");
    }

    if (argv[0] === "--bump") {
        const bumpType = argv[1];
        if (!bumpType || !["patch", "minor", "major"].includes(bumpType)) {
            fail("Bump invalide. Utilise --bump patch|minor|major");
        }
        return { type: "bump", bumpType };
    }

    if (argv[0].startsWith("--")) {
        fail(`Argument inconnu: ${argv[0]}`);
    }

    return { type: "set", version: argv[0] };
}

function main() {
    const args = parseArguments(process.argv.slice(2));

    const packageJson = loadJson(packageJsonPath);
    if (typeof packageJson.version !== "string") {
        fail("package.json doit contenir une clé version de type string.");
    }

    const currentVersion = packageJson.version.trim();
    if (!parseSemver(currentVersion)) {
        fail(`Version actuelle invalide dans package.json: "${packageJson.version}"`);
    }

    const targetVersion =
        args.type === "set" ? args.version.trim() : bumpVersion(currentVersion, args.bumpType);

    if (!targetVersion) {
        fail("Impossible de calculer la version cible.");
    }

    if (!parseSemver(targetVersion)) {
        fail(`Version cible invalide: "${targetVersion}"`);
    }

    const cargoTomlBefore = fs.readFileSync(cargoTomlPath, "utf8");
    const tauriConfig = loadJson(tauriConfigPath);

    const previousPackageVersion = packageJson.version;
    packageJson.version = targetVersion;
    writeJson(packageJsonPath, packageJson);

    const cargoUpdate = updateCargoTomlVersion(cargoTomlBefore, targetVersion);
    if (cargoUpdate.content !== cargoTomlBefore) {
        fs.writeFileSync(cargoTomlPath, cargoUpdate.content, "utf8");
    }

    let tauriConfigMessage = "tauri.conf.json: pas de champ version fixe (inchangé)";
    if (typeof tauriConfig.version === "string") {
        const previousTauriVersion = tauriConfig.version;
        tauriConfig.version = targetVersion;
        writeJson(tauriConfigPath, tauriConfig);
        tauriConfigMessage = `tauri.conf.json: ${previousTauriVersion} -> ${targetVersion}`;
    }

    console.log(`✅ Version synchronisée: ${targetVersion}`);
    console.log(`   package.json: ${previousPackageVersion} -> ${targetVersion}`);
    console.log(`   src-tauri/Cargo.toml: ${cargoUpdate.previousVersion} -> ${targetVersion}`);
    console.log(`   ${tauriConfigMessage}`);
}

main();
