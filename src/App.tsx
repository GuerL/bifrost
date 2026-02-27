import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPending } from "./helpers/HttpHelper";

type CollectionMeta = {
    version: number;
    id: string;
    name: string;
    request_order: string[];
};

type Request = {
    id: string;
    name: string;
    method: string;
    url: string;
};

type CollectionLoaded = {
    meta: CollectionMeta;
    requests: Request[];
};

type HttpResponseDto = {
    status: number;
    headers: { key: string; value: string }[];
    body_text: string;
    duration_ms: number;
};

export default function App() {
    const [dataDir, setDataDir] = useState<string>("");
    const [collections, setCollections] = useState<CollectionMeta[]>([]);
    const [current, setCurrent] = useState<CollectionLoaded | null>(null);
    const [status, setStatus] = useState<string>("");
    const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
    const [resp, setResp] = useState<HttpResponseDto | null>(null);

    const [pending, setPending] = useState(false);

    // fetch app data dir once
    useEffect(() => {
        (async () => {
            const dir = await invoke<string>("app_data_dir");
            setDataDir(dir);
        })().catch((e) => setStatus(String(e)));
    }, []);

    // init default on mount
    useEffect(() => {
        initDefault();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // whenever selection changes, ask backend if this request slot is pending
    useEffect(() => {
        if (!selectedRequestId) {
            setPending(false);
            return;
        }

        let cancelled = false;
        (async () => {
            try {
                const p = await isPending(selectedRequestId);
                if (!cancelled) setPending(p);
            } catch {
                if (!cancelled) setPending(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [selectedRequestId]);

    // const collectionPath = useMemo(() => {
    //     if (!dataDir) return "";
    //     return `${dataDir}/collections/default.json`;
    // }, [dataDir]);

    async function initDefault() {
        try {
            setStatus("Init default collection...");
            await invoke("init_default_collection");
            await refreshCollections();
            setStatus("✅ Default collection ready");
        } catch (e) {
            setStatus(`❌ Init failed: ${String(e)}`);
        }
    }

    async function refreshCollections() {
        try {
            const list = await invoke<CollectionMeta[]>("list_collections");
            setCollections(list);
        } catch (e) {
            setStatus(`❌ List failed: ${String(e)}`);
        }
    }

    async function loadCollection(id: string) {
        try {
            setStatus(`Loading ${id}...`);
            const col = await invoke<CollectionLoaded>("load_collection", { id });
            setCurrent(col);
            setSelectedRequestId(col.requests[0]?.id ?? null);
            setResp(null);
            setStatus(`✅ Loaded ${id}`);
        } catch (e) {
            setStatus(`❌ Load failed: ${String(e)}`);
        }
    }

    async function overwriteDefault() {
        try {
            setStatus("Overwriting default collection...");
            await invoke("overwrite_default");
            await refreshCollections();
            setStatus("✅ Default collection overwritten");
        } catch (e) {
            setStatus(`❌ Overwrite failed: ${String(e)}`);
        }
    }

    async function sendSelected() {
        if (!current || !selectedRequestId) return;
        const req = current.requests.find((r) => r.id === selectedRequestId);
        if (!req) return;

        setResp(null);
        setPending(true);
        setStatus("Sending...");

        try {
            // IMPORTANT: requestId = slot id (ex: "ping")
            const r = await invoke<HttpResponseDto>("send_request", {
                requestId: selectedRequestId,
                req,
            });
            setResp(r);
            setStatus(`✅ ${r.status} in ${r.duration_ms}ms`);
        } catch (e: any) {
            const kind = e?.kind ?? "unknown";
            const msg = e?.message ?? String(e);
            const d = e?.duration_ms;
            setStatus(`❌ ${kind}: ${msg}${d != null ? ` (${d}ms)` : ""}`);
        } finally {
            // ask backend to be sure (in case it was cancelled/replaced)
            const p = await isPending(selectedRequestId).catch(() => false);
            setPending(p);
        }
    }

    async function cancel() {
        if (!selectedRequestId) return;
        try {
            await invoke("cancel_request", { requestId: selectedRequestId });
            setStatus("⛔ Cancel requested");
        } catch (e) {
            setStatus(`❌ Cancel failed: ${String(e)}`);
        } finally {
            const p = await isPending(selectedRequestId).catch(() => false);
            setPending(p);
        }
    }

    return (
        <div style={{ padding: 24, fontFamily: "system-ui", display: "flex", gap: 24 }}>
            {/* Sidebar */}
            <div style={{ width: 240 }}>
                <h3>Collections</h3>

                <button onClick={initDefault}>Init default</button>{" "}
                <button onClick={refreshCollections}>Refresh</button>{" "}
                <button onClick={overwriteDefault}>Overwrite default</button>{" "}
                <button onClick={() => invoke("open_app_data_dir")}>Open data folder</button>

                <ul style={{ marginTop: 12 }}>
                    {collections.map((c) => (
                        <li key={c.id}>
                            <button onClick={() => loadCollection(c.id)}>{c.name}</button>
                        </li>
                    ))}
                </ul>
            </div>

            {/* Main */}
            <div style={{ flex: 1 }}>
                <h3>Status</h3>
                <div>{status}</div>

                {current && (
                    <>
                        <h3 style={{ marginTop: 16 }}>Requests</h3>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            {current.requests.map((r) => (
                                <button
                                    key={r.id}
                                    onClick={() => {
                                        setSelectedRequestId(r.id);
                                        setResp(null);
                                    }}
                                    style={{ fontWeight: r.id === selectedRequestId ? "bold" : "normal" }}
                                >
                                    {r.method} {r.name}
                                </button>
                            ))}

                            <button onClick={sendSelected} disabled={!selectedRequestId || pending}>
                                Send
                            </button>

                            <button onClick={cancel} disabled={!selectedRequestId || !pending}>
                                Cancel
                            </button>

                            <span style={{ opacity: 0.7 }}>
                {selectedRequestId ? (pending ? "⏳ pending" : "✅ idle") : ""}
              </span>
                        </div>

                        <h3 style={{ marginTop: 16 }}>Response</h3>
                        <pre style={{ background: "#111", color: "#eee", padding: 12 }}>
              {resp ? JSON.stringify(resp, null, 2) : "No response yet."}
            </pre>
                    </>
                )}

                {!current && (
                    <>
                        <h3 style={{ marginTop: 16 }}>Loaded collection</h3>
                        <pre style={{ background: "#111", color: "#eee", padding: 12 }}>
              None
            </pre>
                    </>
                )}
            </div>
        </div>
    );
}