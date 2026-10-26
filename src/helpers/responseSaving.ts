import type { HttpResponseDto } from "../types.ts";

// Persisted previews survive restarts; Rust's original byte store does not.
// Never rebuild a file from a potentially lossy text preview.
export function invalidateStoredResponseBytes(response: HttpResponseDto | null): HttpResponseDto | null {
    if (!response?.body) return response;
    return {
        ...response,
        body_text: response.body.kind === "binary" ? "" : response.body_text,
        body: { ...response.body, body_id: "", available: false, downloadable: false },
    };
}

export function responseSaveErrorMessage(error: unknown): string {
    if (error === "response_data_unavailable") return "No response data available to save.";
    if (error === "save_permission_denied") return "Unable to save response. Check the selected location's permissions.";
    return "Unable to save response.";
}
