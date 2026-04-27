import { invoke } from "@tauri-apps/api/core";
import type { CollectionLoaded, CollectionMeta, HttpResponseDto, Request } from "../types.ts";

export async function refreshCollections(setCollections: (cols: CollectionMeta[]) => void): Promise<void> {
    const list = await invoke<CollectionMeta[]>("list_collections");
    setCollections(list);
}

export async function loadCollection(
    id: string,
    requestId: string | null,
    setCurrent: (c: CollectionLoaded) => void,
    setSelectedRequestId: (id: string | null) => void,
    setResp: (r: HttpResponseDto | null) => void
): Promise<void> {
    const collection = await invoke<CollectionLoaded>("load_collection", { id });
    setCurrent(collection);
    setSelectedRequestId(requestId ?? null);
    setResp(null);
}

export async function devCreate(
    current: CollectionLoaded | null,
    setCurrent: (c: CollectionLoaded) => void,
    setSelectedRequestId: (id: string | null) => void,
    setResp: (r: HttpResponseDto | null) => void,
    setSelection: (r: Request) => void,
    parentFolderId?: string | null,
    requestName?: string
): Promise<void> {
    if (!current) return;

    const id = crypto.randomUUID();
    const nextName = requestName?.trim() || "New Request";
    const request: Request = {
        id,
        name: nextName,
        method: "get",
        url: "",
        headers: [],
        query: [],
        body: { type: "none" },
        auth: { type: "none" },
        extractors: [],
        scripts: { pre_request: "", post_response: "" },
    };

    await invoke("create_request", {
        collectionId: current.meta.id,
        request,
        parentFolderId: parentFolderId ?? null,
    });
    await loadCollection(current.meta.id, request.id, setCurrent, setSelectedRequestId, setResp);
    setSelection(request);
}

export async function devDelete(
    current: CollectionLoaded | null,
    selectedRequestId: string | null,
    setCurrent: (c: CollectionLoaded) => void,
    setSelectedRequestId: (id: string | null) => void,
    setResp: (r: HttpResponseDto | null) => void
): Promise<void> {
    if (!current || !selectedRequestId) return;
    await invoke("delete_request", { collectionId: current.meta.id, requestId: selectedRequestId });
    await loadCollection(current.meta.id, null, setCurrent, setSelectedRequestId, setResp);
}

export async function devDuplicate(
    current: CollectionLoaded | null,
    selectedRequestId: string | null,
    setCurrent: (c: CollectionLoaded) => void,
    setSelectedRequestId: (id: string | null) => void,
    setResp: (r: HttpResponseDto | null) => void,
    targetFolderId?: string | null
): Promise<void> {
    if (!current || !selectedRequestId) return;

    const source = current.requests.find((request) => request.id === selectedRequestId);
    if (!source) return;

    const newId = crypto.randomUUID();
    const newName = `${source.name} Copy`;

    await invoke("duplicate_request", {
        collectionId: current.meta.id,
        sourceRequestId: source.id,
        newRequestId: newId,
        newName,
        targetFolderId: targetFolderId ?? null,
    });

    await loadCollection(current.meta.id, newId, setCurrent, setSelectedRequestId, setResp);
    setSelectedRequestId(newId);
}

export async function devRename(
    current: CollectionLoaded | null,
    selectedRequestId: string | null,
    newName: string,
    setCurrent: (c: CollectionLoaded) => void,
    setSelectedRequestId: (id: string | null) => void,
    setResp: (r: HttpResponseDto | null) => void
): Promise<boolean> {
    if (!current || !selectedRequestId) return false;

    const trimmedName = newName.trim();
    if (!trimmedName) return false;

    await invoke("rename_request", {
        collectionId: current.meta.id,
        requestId: selectedRequestId,
        newName: trimmedName,
    });

    await loadCollection(
        current.meta.id,
        selectedRequestId,
        setCurrent,
        setSelectedRequestId,
        setResp
    );

    setSelectedRequestId(selectedRequestId);
    return true;
}
