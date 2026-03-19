import { invoke } from "@tauri-apps/api/core";
import { CollectionLoaded, CollectionMeta, HttpResponseDto, Request } from "../types.ts";



export async function initDefault(setStatus: (s: string) => void, setCollections: (cols: CollectionMeta[]) => void) {
    try {
        setStatus("Init default collection...");
        await invoke("init_default_collection");
        await refreshCollections(setCollections, setStatus);
        setStatus("✅ Default collection ready");
    } catch (e) {
        setStatus(`❌ Init failed: ${String(e)}`);
    }
}

export async function refreshCollections(setCollections: (cols: CollectionMeta[]) => void, setStatus: (s: string) => void) {
    try {
        const list = await invoke<CollectionMeta[]>("list_collections");
        setCollections(list);
    } catch (e) {
        setStatus(`❌ List failed: ${String(e)}`);
    }
}

export async function loadCollection(id: string,requestId:string|null ,  setCurrent: (c: CollectionLoaded) => void, setSelectedRequestId: (id: string | null) => void, setResp: (r: HttpResponseDto | null) => void, setStatus: (s: string) => void) {
    try {
        setStatus(`Loading ${id}...`);
        const col = await invoke<CollectionLoaded>("load_collection", { id });
        setCurrent(col);
        setSelectedRequestId(requestId ?? null);
        setResp(null);
        setStatus(`✅ Loaded ${id}`);
    } catch (e) {
        setStatus(`❌ Load failed: ${String(e)}`);
    }
}

export async function overwriteDefault(setStatus: (s: string) => void, setCollections: (cols: CollectionMeta[]) => void) {
    try {
        setStatus("Overwriting default collection...");
        await invoke("overwrite_default");
        await refreshCollections(setCollections, setStatus);
        setStatus("✅ Default collection overwritten");
    } catch (e) {
        setStatus(`❌ Overwrite failed: ${String(e)}`);
    }
}
export async function devCreate(
    current: CollectionLoaded | null,
    setCurrent: (c: CollectionLoaded) => void,
    setSelectedRequestId: (id: string | null) => void,
    setResp: (r: HttpResponseDto | null) => void,
    setStatus: (s: string) => void,
    setSelection: (r: Request) => void,
    parentFolderId?: string | null,
    requestName?: string
) {
    if (!current) return;
    let id = crypto.randomUUID();
    const nextName = requestName?.trim() || "New Request";
   const req: Request = {
     id: id,
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
        request: req,
        parentFolderId: parentFolderId ?? null,
    });
    await loadCollection(current.meta.id, req.id, setCurrent, setSelectedRequestId, setResp, setStatus); // reload
    setSelection(req);
}


export async function devDelete(current: CollectionLoaded | null, selectedRequestId: string | null,  setCurrent: (c: CollectionLoaded) => void, setSelectedRequestId: (id: string | null) => void, setResp: (r: HttpResponseDto | null) => void, setStatus: (s: string) => void) {
    if (!current || !selectedRequestId) return;
    await invoke("delete_request", { collectionId: current.meta.id, requestId: selectedRequestId });
    await loadCollection(current.meta.id, null ,setCurrent, setSelectedRequestId, setResp, setStatus);
}


export async function devDuplicate(
    current: CollectionLoaded | null,
    selectedRequestId: string | null,
    setCurrent: (c: CollectionLoaded) => void,
    setSelectedRequestId: (id: string | null) => void,
    setResp: (r: HttpResponseDto | null) => void,
    setStatus: (s: string) => void,
    targetFolderId?: string | null
) {
    if (!current || !selectedRequestId) return;

    const source = current.requests.find((r) => r.id === selectedRequestId);
    if (!source) return;

    const newId = crypto.randomUUID();
    const newName = `${source.name} Copy`;

    try {
        setStatus("Duplicating request...");
        await invoke("duplicate_request", {
            collectionId: current.meta.id,
            sourceRequestId: source.id,
            newRequestId: newId,
            newName,
            targetFolderId: targetFolderId ?? null,
        });

        await loadCollection(
            current.meta.id,
            newId,
            setCurrent,
            setSelectedRequestId,
            setResp,
            setStatus
        );

        setSelectedRequestId(newId);
        setStatus("✅ Request duplicated");
    } catch (e) {
        setStatus(`❌ Duplicate failed: ${String(e)}`);
    }
}

export async function devRename(
    current: CollectionLoaded | null,
    selectedRequestId: string | null,
    newName: string,
    setCurrent: (c: CollectionLoaded) => void,
    setSelectedRequestId: (id: string | null) => void,
    setResp: (r: HttpResponseDto | null) => void,
    setStatus: (s: string) => void
): Promise<boolean> {
    if (!current || !selectedRequestId) return false;

    const trimmedName = newName.trim();

    if (!trimmedName) {
        setStatus("❌ Request name cannot be empty");
        return false;
    }

    try {
        setStatus("Renaming request...");
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
            setResp,
            setStatus
        );

        setSelectedRequestId(selectedRequestId);
        setStatus("✅ Request renamed");
        return true;
    } catch (e) {
        setStatus(`❌ Rename failed: ${String(e)}`);
        return false;
    }
}
