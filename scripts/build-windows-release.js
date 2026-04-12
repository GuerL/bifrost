#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const packageJsonPath = path.join(projectRoot, "package.json");
const tauriConfigPath = path.join(projectRoot, "src-tauri", "tauri.conf.json");
const nsisBundleDirPath = path.join(projectRoot, "src-tauri", "target", "release", "bundle", "nsis");
const latestJsonPath = path.join(nsisBundleDirPath, "latest.json");

const DEFAULT_RELEASE_URL_TEMPLATE =
    "https://github.com/GuerL/bifrost/releases/download/v${version}/${artifact}";
const SEMVER_REGEX =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function fail(message) {
    console.error(`\n❌ ${message}`);
    process.exit(1);
}

function log(message) {
    console.log(`ℹ️  ${message}`);
}

function success(message) {
    console.log(`✅ ${message}`);
}

function readJson(filePath) {
    try {
        const raw = fs.readFileSync(filePath, "utf8");
        return JSON.parse(raw);
    } catch (error) {
        fail(`Impossible de lire ${path.relative(projectRoot, filePath)}: ${String(error)}`);
    }
}

function runCommand(command, args, cwd, options = {}) {
    const { allowFailure = false, env = process.env } = options;

    const result = spawnSync(command, args, {
        cwd,
        env,
        stdio: "inherit",
        shell: process.platform === "win32",
    });

    if (result.error) {
        fail(`Impossible d'exécuter "${command} ${args.join(" ")}": ${String(result.error)}`);
    }

    const status = typeof result.status === "number" ? result.status : 1;

    if (!allowFailure && status !== 0) {
        fail(`La commande "${command} ${args.join(" ")}" a échoué avec le code ${result.status}.`);
    }

    return status;
}

function walkFiles(dirPath) {
    if (!fs.existsSync(dirPath)) return [];

    const files = [];
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        const absolutePath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...walkFiles(absolutePath));
            continue;
        }
        if (entry.isFile()) {
            files.push(absolutePath);
        }
    }

    return files;
}

function findLatestFile(paths) {
    return [...paths].sort((a, b) => {
        const aMtime = fs.statSync(a).mtimeMs;
        const bMtime = fs.statSync(b).mtimeMs;
        return bMtime - aMtime;
    })[0] ?? null;
}

function applyTemplate(template, variables) {
    return template.replace(/\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_, key) => {
        const value = variables[key];
        return value === undefined ? "" : String(value);
    });
}

function resolveBuildEnvWithSigningKey() {
    const nextEnv = { ...process.env };
    const inlinePrivateKey = nextEnv.TAURI_SIGNING_PRIVATE_KEY?.trim();

    if (inlinePrivateKey) {
        return nextEnv;
    }

    const configuredPath =
        nextEnv.TAURI_SIGNING_PRIVATE_KEY_PATH?.trim() ||
        nextEnv.BIFROST_TAURI_SIGNING_PRIVATE_KEY_PATH?.trim() ||
        "";

    if (!configuredPath) {
        fail(
            "Clé de signature manquante. Définis TAURI_SIGNING_PRIVATE_KEY " +
                "ou TAURI_SIGNING_PRIVATE_KEY_PATH (ou BIFROST_TAURI_SIGNING_PRIVATE_KEY_PATH)."
        );
    }

    const absolutePath = path.isAbsolute(configuredPath)
        ? configuredPath
        : path.resolve(projectRoot, configuredPath);

    if (!fs.existsSync(absolutePath)) {
        fail(`Fichier de clé introuvable: ${absolutePath}`);
    }

    const keyContent = fs.readFileSync(absolutePath, "utf8");
    if (!keyContent.trim()) {
        fail(`Le fichier de clé est vide: ${absolutePath}`);
    }

    nextEnv.TAURI_SIGNING_PRIVATE_KEY = keyContent;
    log(`Clé de signature chargée depuis ${path.relative(projectRoot, absolutePath)}.`);
    return nextEnv;
}

function resolveWindowsPlatformKey(artifactName) {
    if (process.env.BIFROST_RELEASE_PLATFORM?.trim()) {
        return process.env.BIFROST_RELEASE_PLATFORM.trim();
    }

    const normalized = artifactName.toLowerCase();
    if (normalized.includes("arm64") || normalized.includes("aarch64")) {
        return "windows-aarch64";
    }
    if (normalized.includes("x64") || normalized.includes("x86_64")) {
        return "windows-x86_64";
    }
    if (normalized.includes("x86") || normalized.includes("i686")) {
        return "windows-i686";
    }

    const archMap = {
        arm64: "aarch64",
        x64: "x86_64",
        ia32: "i686",
    };

    const archSuffix = archMap[process.arch] ?? null;
    if (!archSuffix) {
        fail(
            `Impossible de déduire la plateforme updater Windows (artifact="${artifactName}", arch="${process.arch}"). ` +
                "Définis BIFROST_RELEASE_PLATFORM manuellement."
        );
    }

    return `windows-${archSuffix}`;
}

function main() {
    const args = process.argv.slice(2);
    const unknownArgs = args.filter((arg) => arg !== "--skip-build");
    if (unknownArgs.length > 0) {
        fail(`Argument inconnu: ${unknownArgs.join(", ")}. Seul --skip-build est supporté.`);
    }

    const skipBuild = args.includes("--skip-build");
    const packageJson = readJson(packageJsonPath);

    if (typeof packageJson.version !== "string") {
        fail("package.json doit contenir une clé version de type string.");
    }

    const version = packageJson.version.trim();
    if (!SEMVER_REGEX.test(version)) {
        fail(`Version invalide dans package.json: "${packageJson.version}"`);
    }

    const tauriConfig = readJson(tauriConfigPath);
    const productName =
        typeof tauriConfig.productName === "string" && tauriConfig.productName.trim().length > 0
            ? tauriConfig.productName.trim()
            : "Bifrost";

    if (!skipBuild) {
        const buildEnv = resolveBuildEnvWithSigningKey();
        log("Build Windows en cours via `npm run tauri:build:windows`...");
        const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
        runCommand(npmCommand, ["run", "tauri:build:windows"], projectRoot, { env: buildEnv });
    } else {
        log("Mode --skip-build activé: build ignoré.");
    }

    log("Recherche des artefacts updater Windows (NSIS)...");
    const allNsisFiles = walkFiles(nsisBundleDirPath);
    const setupCandidates = allNsisFiles.filter((filePath) =>
        filePath.toLowerCase().endsWith("setup.exe")
    );

    if (setupCandidates.length === 0) {
        fail(
            "Aucun setup.exe trouvé dans src-tauri/target/release/bundle/nsis après build. " +
                "Vérifie que le bundling NSIS est activé et que le build Windows a réussi."
        );
    }

    const setupPath = findLatestFile(setupCandidates);
    if (!setupPath) {
        fail("Impossible de sélectionner un setup.exe.");
    }

    if (setupCandidates.length > 1) {
        log(
            `Plusieurs setup.exe détectés (${setupCandidates.length}), utilisation du plus récent: ` +
                path.basename(setupPath)
        );
    }

    const signaturePath = `${setupPath}.sig`;
    if (!fs.existsSync(signaturePath)) {
        fail(
            `Signature manquante pour ${path.basename(setupPath)}. ` +
                `Fichier attendu: ${path.relative(projectRoot, signaturePath)}`
        );
    }

    const signature = fs.readFileSync(signaturePath, "utf8").trim();
    if (!signature) {
        fail(`Le fichier de signature est vide: ${path.relative(projectRoot, signaturePath)}`);
    }

    const artifactName = path.basename(setupPath);
    const platformKey = resolveWindowsPlatformKey(artifactName);
    const notes = process.env.BIFROST_RELEASE_NOTES?.trim() || `Release v${version}`;
    const releaseUrlTemplate =
        process.env.BIFROST_WINDOWS_RELEASE_URL_TEMPLATE ||
        process.env.BIFROST_RELEASE_URL_TEMPLATE ||
        DEFAULT_RELEASE_URL_TEMPLATE;
    const url = applyTemplate(releaseUrlTemplate, {
        version,
        artifact: artifactName,
        productName,
    });

    if (!url) {
        fail("URL de release invalide: template vide après interpolation.");
    }

    const latestJson = {
        version,
        notes,
        pub_date: new Date().toISOString(),
        platforms: {
            [platformKey]: {
                signature,
                url,
            },
        },
    };

    fs.mkdirSync(nsisBundleDirPath, { recursive: true });
    fs.writeFileSync(latestJsonPath, `${JSON.stringify(latestJson, null, 2)}\n`, "utf8");

    success("Build Windows + latest.json généré.");
    log(`Version: ${version}`);
    log(`Setup: ${path.relative(projectRoot, setupPath)}`);
    log(`Signature: ${path.relative(projectRoot, signaturePath)}`);
    log(`Plateforme: ${platformKey}`);
    log(`URL: ${url}`);
    log(`latest.json: ${path.relative(projectRoot, latestJsonPath)}`);
}

main();
