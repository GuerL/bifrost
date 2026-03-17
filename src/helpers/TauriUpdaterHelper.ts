import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type InstalledUpdateInfo = {
    version: string;
};

export async function checkForUpdate(): Promise<InstalledUpdateInfo | null> {
    try {
        const update = await check();

        if (!update) {
            console.log("No update available");
            return null;
        }

        console.log("Update found:", update.version);
        await update.downloadAndInstall();
        console.log("Update installed:", update.version);
        return { version: update.version };
    } catch (error) {
        console.error("Updater flow failed:", error);
        return null;
    }
}

export async function restartAfterUpdate(): Promise<void> {
    await relaunch();
}
