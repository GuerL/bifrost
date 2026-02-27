import { invoke } from "@tauri-apps/api/core";

export async function isPending(requestId: string): Promise<boolean> {
    return invoke<boolean>("is_pending", { requestId });
}