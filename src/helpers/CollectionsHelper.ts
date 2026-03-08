import { invoke } from "@tauri-apps/api/core";
import {CollectionLoaded, CollectionMeta, HttpResponseDto, Request} from "../App.tsx";



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
        setSelectedRequestId(requestId ?? col.requests[0]?.id ?? null);
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
export async function devCreate(current: CollectionLoaded | null, setCurrent: (c: CollectionLoaded) => void, setSelectedRequestId: (id: string | null) => void, setResp: (r: HttpResponseDto | null) => void, setStatus: (s: string) => void, setSelection:(r:Request)=>void) {
    if (!current) return;
    let id = crypto.randomUUID();
   const req: Request = {
     id: id,
     name: "New Request",
     method: "get",
     url: "",
     headers: [],
     query: [],
     body: { type: "none" },
   };

    await invoke("create_request", { collectionId: current.meta.id, request: req });
    await loadCollection(current.meta.id, req.id, setCurrent, setSelectedRequestId, setResp, setStatus); // reload
    setSelection(req);
}


export async function devDelete(current: CollectionLoaded | null, selectedRequestId: string | null,  setCurrent: (c: CollectionLoaded) => void, setSelectedRequestId: (id: string | null) => void, setResp: (r: HttpResponseDto | null) => void, setStatus: (s: string) => void) {
    if (!current || !selectedRequestId) return;
    await invoke("delete_request", { collectionId: current.meta.id, requestId: selectedRequestId });
    await loadCollection(current.meta.id, null ,setCurrent, setSelectedRequestId, setResp, setStatus);
}