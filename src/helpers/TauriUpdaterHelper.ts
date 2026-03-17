import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type AvailableUpdateInfo = {
    version: string;
};

export type InstalledUpdateInfo = {
    version: string;
};

let pendingUpdate: Update | null = null;

export async function checkForUpdate(): Promise<AvailableUpdateInfo | null> {
    try {
        const update = await check();

        if (!update) {
            console.log("No update available");
            pendingUpdate = null;
            return null;
        }

        console.log("Update found:", update.version);
        pendingUpdate = update;
        return { version: update.version };
    } catch (error) {
        console.error("Updater flow failed:", error);
        pendingUpdate = null;
        return null;
    }
}

export async function downloadAndInstallPendingUpdate(): Promise<InstalledUpdateInfo | null> {
    if (!pendingUpdate) {
        console.warn("No pending update to install");
        return null;
    }

    const updateToInstall = pendingUpdate;

    try {
        await updateToInstall.downloadAndInstall();
        console.log("Update installed:", updateToInstall.version);
        pendingUpdate = null;
        return { version: updateToInstall.version };
    } catch (error) {
        console.error("Update download/install failed:", error);
        return null;
    }
}

export async function restartAfterUpdate(): Promise<void> {
    await relaunch();
}
