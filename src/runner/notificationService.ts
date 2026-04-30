import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
    isPermissionGranted,
    requestPermission,
    sendNotification,
} from "@tauri-apps/plugin-notification";

export type NativeNotificationPayload = {
    title: string;
    body?: string;
};

export async function shouldSendRunnerSystemNotification(): Promise<boolean> {
    if (!isTauri()) {
        return false;
    }

    try {
        const currentWindow = getCurrentWindow();
        const [focused, minimized] = await Promise.all([
            currentWindow.isFocused().catch(() => true),
            currentWindow.isMinimized().catch(() => false),
        ]);
        return !focused || minimized;
    } catch (error) {
        console.warn("Failed to read app focus/minimized state for runner notifications.", error);
        return false;
    }
}

async function ensureNotificationPermission(): Promise<boolean> {
    try {
        let granted = await isPermissionGranted();
        if (granted) return true;

        const permission = await requestPermission();
        granted = permission === "granted";
        return granted;
    } catch (error) {
        console.warn("Runner notification permission check failed.", error);
        return false;
    }
}

export async function sendNativeNotification(payload: NativeNotificationPayload): Promise<void> {
    if (!isTauri()) {
        return;
    }

    const granted = await ensureNotificationPermission();
    if (!granted) {
        return;
    }

    try {
        sendNotification({
            title: payload.title,
            body: payload.body,
        });
    } catch (error) {
        console.warn("Failed to send runner system notification.", error);
    }
}
