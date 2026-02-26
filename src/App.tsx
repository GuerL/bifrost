import {useEffect, useMemo, useState} from "react";
import {invoke} from "@tauri-apps/api/core";

type Collection = {
    version: number;
    name: string;
    requests: Array<{
        id: string;
        name: string;
        method: string;
        url: string;
    }>;
};

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
    const [collection, setCollection] = useState<Collection | null>(null);
    const [collections, setCollections] = useState<CollectionMeta[]>([]);
    const [current, setCurrent] = useState<CollectionLoaded | null>(null);
    const [status, setStatus] = useState<string>("");
    const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
    const [resp, setResp] = useState<HttpResponseDto | null>(null);


    useEffect(() => {
        initDefault();
    }, []);

    useEffect(() => {
        (async () => {
            const dir = await invoke<string>("app_data_dir");
            setDataDir(dir);
        })().catch((e) => setStatus(String(e)));
    }, []);

    const collectionPath = useMemo(() => {
        if (!dataDir) return "";
        // simple: on écrit un seul fichier pour l’instant
        return `${dataDir}/collections/default.json`;
    }, [dataDir]);

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
            const col = await invoke<CollectionLoaded>("load_collection", {id});
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
        const req = current.requests.find(r => r.id === selectedRequestId);
        if (!req) return;

        try {
            setStatus("Sending request...");
            const r = await invoke<HttpResponseDto>("send_request", {req});
            setResp(r);
            setStatus(`✅ ${r.status} in ${r.duration_ms}ms`);
        } catch (e) {
            setStatus(`❌ Send failed: ${String(e)}`);
        }
    }


    async function createDefault() {
        if (!collectionPath) return;

        // On crée le dossier parent si besoin via Rust… (pas encore)
        // Hack temporaire: on écrira direct, et si ça fail on fera mkdir dans l’étape suivante.

        const defaultCollection: Collection = {
            version: 1,
            name: "Default",
            requests: [
                {
                    id: "ping",
                    name: "Ping (GET)",
                    method: "GET",
                    url: "https://postman-echo.com/get",
                },
            ],
        };

        try {
            setStatus("Writing collection...");
            await invoke("write_text_file", {
                path: collectionPath,
                content: JSON.stringify(defaultCollection, null, 2),
            });
            setStatus("✅ Written. Now click Load.");
        } catch (e) {
            setStatus(`❌ Write failed: ${String(e)}`);
        }
    }

    async function load() {
        if (!collectionPath) return;
        try {
            setStatus("Reading collection...");
            const text = await invoke<string>("read_text_file", {path: collectionPath});
            setCollection(JSON.parse(text));
            setStatus("✅ Loaded.");
        } catch (e) {
            setStatus(`❌ Load failed: ${String(e)}`);
        }
    }

    return (
        <div style={{padding: 24, fontFamily: "system-ui", display: "flex", gap: 24}}>
            {/* Sidebar */}
            <div style={{width: 240}}>
                <h3>Collections</h3>

                <button onClick={initDefault}>Init default</button>
                {" "}
                <button onClick={refreshCollections}>Refresh</button>
                <button onClick={overwriteDefault}>Overwrite default</button>
                <button onClick={() => invoke("open_app_data_dir")}>
                    Open data folder
                </button>

                <ul style={{marginTop: 12}}>
                    {collections.map((c) => (
                        <li key={c.id}>
                            <button onClick={() => loadCollection(c.id)}>
                                {c.name}
                            </button>
                        </li>
                    ))}
                </ul>
            </div>

            {/* Main */}

            <div style={{flex: 1}}>
                <h3>Status</h3>
                <div>{status}</div>

                <h3 style={{marginTop: 16}}>Loaded collection</h3>
                <pre style={{background: "#111", color: "#eee", padding: 12}}>
                  {current ? JSON.stringify(current, null, 2) : "None"}
                </pre>
                {current && (
                    <>
                        <h3 style={{marginTop: 16}}>Requests</h3>
                        <div style={{display: "flex", gap: 8, flexWrap: "wrap"}}>
                            {current.requests.map(r => (
                                <button
                                    key={r.id}
                                    onClick={() => {
                                        setSelectedRequestId(r.id);
                                        setResp(null);
                                    }}
                                    style={{fontWeight: r.id === selectedRequestId ? "bold" : "normal"}}
                                >
                                    {r.method} {r.name}
                                </button>
                            ))}
                            <button onClick={sendSelected} disabled={!selectedRequestId}>
                                Send
                            </button>
                        </div>
                    </>
                )}

                <h3 style={{marginTop: 16}}>Response</h3>
                <pre style={{background: "#111", color: "#eee", padding: 12}}>
                  {resp ? JSON.stringify(resp, null, 2) : "No response yet."}
                </pre>
            </div>
        </div>

    );
}
