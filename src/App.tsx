import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPending } from "./helpers/HttpHelper";
import Editor from "@monaco-editor/react";
import {
    devCreate, devDelete,
    initDefault,
    loadCollection,
    overwriteDefault,
    refreshCollections
} from "./helpers/CollectionsHelper.ts";
import KeyValueTable from "./KeyValueTable.tsx";
import TopBar from "./TopBar.tsx";

export type CollectionMeta = {
    version: number;
    id: string;
    name: string;
    request_order: string[];
};

export type KeyValue = { key: string; value: string };

export type Body =
  | { type: "none" }
  | { type: "raw"; content_type: string; text: string }
  | { type: "json"; value: any }
  | { type: "form"; fields: KeyValue[] };

export type Request = {
  id: string;
  name: string;
  method: "get" | "post" | "put" | "patch" | "delete" | "head" | "options";
  url: string;
  headers: KeyValue[];
  query: KeyValue[];
  body: Body;
};

export type CollectionLoaded = {
    meta: CollectionMeta;
    requests: Request[];
};

export type HttpResponseDto = {
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

    const [editorText, setEditorText] = useState("");

    const [draft, setDraft] = useState<Request | null>(null);
    const [tab, setTab] = useState<"headers" | "query" | "body" | "json">("headers");

    // fetch app data dir once
    useEffect(() => {
        (async () => {
            const dir = await invoke<string>("app_data_dir");
            setDataDir(dir);
        })().catch((e) => setStatus(String(e)));
    }, []);

    // init default on mount
    useEffect(() => {
        initDefault(setStatus, setCollections);
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

    useEffect(() => {
        if (!current || !selectedRequestId) {
            setDraft(null);
            setEditorText("");
            return;
        }

        const req = current.requests.find((r) => r.id === selectedRequestId);
        if (req) {
            setDraft(structuredClone(req));
            setEditorText(JSON.stringify(req, null, 2));
        }
    }, [current, selectedRequestId]);

    async function saveFromEditor() {
        if (!current) return;
        try {
            const parsed = JSON.parse(editorText) as Request;
            if (parsed.id !== draft.id) {
                setStatus("❌ ID cannot be changed here. Use Rename.");
                return;
            }
            await invoke("update_request", { collectionId: current.meta.id, request: parsed });
            await loadCollection(current.meta.id, setCurrent, setSelectedRequestId, setResp, setStatus);
            setStatus("✅ Saved");
        } catch (e) {
            setStatus(`❌ Save failed: ${String(e)}`);
        }
    }

    async function saveDraft() {
        if (!current || !draft) return;
        try {
            await invoke("update_request", { collectionId: current.meta.id, request: draft });
            await loadCollection(current.meta.id, setCurrent, setSelectedRequestId, setResp, setStatus);
            setSelectedRequestId(draft.id);
            setStatus("✅ Draft saved");
        } catch (e) {
            setStatus(`❌ Save failed: ${String(e)}`);
        }
    }

    async function sendSelected() {
        if (!selectedRequestId) return;

        const req =
            draft && draft.id === selectedRequestId
                ? draft
                : current?.requests.find((r) => r.id === selectedRequestId);

        if (!req) return;

        setResp(null);
        setPending(true);
        setStatus("Sending...");

        try {
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

    function formatJson() {
        try {
            const obj = JSON.parse(editorText);
            setEditorText(JSON.stringify(obj, null, 2));
            setStatus("✅ Formatted");
        } catch (e) {
            setStatus(`❌ JSON invalid: ${String(e)}`);
        }
    }

    function setSelection(r: Request) {
        setSelectedRequestId(r.id);
        setDraft(structuredClone(r)); // ou JSON.parse(JSON.stringify(r))
        setResp(null);
        setEditorText(JSON.stringify(r, null, 2));
    }

    function applyEditorToDraft() {
        if (!draft) return;
        try {
            const parsed = JSON.parse(editorText) as Request;
            if (parsed.id !== draft.id) {
                setStatus("❌ ID cannot be changed here. Use Rename.");
                return;
            }
            setDraft(parsed);
            setStatus("✅ JSON applied to draft");
        } catch (e) {
            setStatus(`❌ JSON invalid: ${String(e)}`);
        }
    }

    function onDeleteSelectedRequest() {
        if (!current || !selectedRequestId) {
            console.log("FUCK")
            return;
        }

        devDelete(current, selectedRequestId, setCurrent, setSelectedRequestId, setResp, setStatus);
    }

    function onNewRequest() {
        if (!current) return;
        devCreate(current, setCurrent, setSelectedRequestId, setResp, setStatus, setSelection);
    }

    return (
       <>
           <TopBar
               collections={collections}
               currentCollectionId={current?.meta.id ?? null}
               onSelectCollection={(collectionId) =>
                   loadCollection(collectionId, setCurrent, setSelectedRequestId, setResp, setStatus)
               }
               onSaveDraft={saveDraft}
               onNewRequest={onNewRequest}
               onDeleteSelectedRequest={onDeleteSelectedRequest}
               onOpenRawJson={() => setTab("json")}
               canSaveDraft={!!current && !!draft}
               hasDraft={!!draft}
           />

           <div
               style={{
                   height: "calc(100vh - 52px)",
                   padding: "10px 24px",
                   fontFamily: "system-ui",
                   display: "flex",
                   gap: 24,
                   overflow: "hidden",
                   boxSizing: "border-box",
               }}
           >
               {/* Sidebar */}
               <div
                   style={{
                       display: "flex",
                       flexDirection: "column",
                       width: 240,
                       height: "100%",
                       minHeight: 0,
                       flexShrink: 0,
                   }}
               >

                  <div>
                      <h3>Collections</h3>

                      <button onClick={()=>initDefault(setStatus,setCollections )}>Init default</button>
                      <button onClick={()=> refreshCollections(setCollections, setStatus)}>Refresh</button>
                      <button onClick={()=> overwriteDefault(setStatus, setCollections)}>Overwrite default</button>
                      <button onClick={() => invoke("open_app_data_dir")}>Open data folder</button>
                      {/*<button onClick={()=> devCreate(current, setCurrent, setSelectedRequestId, setResp, setStatus, setSelection)} disabled={!current}>+ New</button>*/}
                      {/*<button onClick={()=>devDelete(current, selectedRequestId, setCurrent, setSelectedRequestId, setResp, setStatus)} disabled={!current || !selectedRequestId}>Delete</button>*/}
                      {/*<button onClick={saveFromEditor} disabled={!current}>*/}
                      {/*    Save (editor)*/}
                      {/*</button>*/}

                      {/*<button onClick={saveDraft} disabled={!current || !draft}>*/}
                      {/*    Save (draft)*/}
                      {/*</button>*/}
                  </div>
                   <div
                       style={{
                           display: "flex",
                           flexDirection: "column",
                           minHeight: 0,
                           flex: 1,
                           overflow: "hidden",
                       }}
                   >
                       <h3 style={{ marginTop: 16, marginBottom: 8, flexShrink: 0 }}>Requests</h3>

                       <div
                           style={{
                               display: "flex",
                               flexDirection: "column",
                               gap: 4,
                               overflowY: "auto",
                               minHeight: 0,
                               flex: 1,
                               paddingRight: 4,
                           }}
                       >
                           {current && current.requests.map((r) => (
                               <button
                                   key={r.id}
                                   onClick={() => {
                                       setSelection(r);
                                   }}
                                   style={{
                                       fontWeight: r.id === selectedRequestId ? "bold" : "normal",
                                       width: "100%",
                                       padding: "8px",
                                       textAlign: "left",
                                       flexShrink: 0,
                                   }}
                               >
                                   {r.method} {r.name}
                               </button>
                           ))}
                       </div>
                   </div>


               </div>

               {/* Main */}
               <div
                   style={{
                       flex: 1,
                       display: "flex",
                       flexDirection: "column",
                       minWidth: 0,
                       minHeight: 0,
                       overflow: "hidden",
                   }}
               >

                   {current && (
                       <>

                           <div style={{ display: "flex",justifyContent:"space-between", alignItems: "center", gap: 8, marginTop: 12 }}>
                               <h3>Editor</h3>
                               {selectedRequestId ? (pending ? "⏳ pending" : "✅ idle") : ""}
                           </div>
                           <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                               <select
                                   value={draft?.method ?? "get"}
                                   onChange={(e) => setDraft(draft ? { ...draft, method: e.target.value as any } : null)}
                               >
                                   <option value="get">GET</option>
                                   <option value="post">POST</option>
                                   <option value="put">PUT</option>
                                   <option value="patch">PATCH</option>
                                   <option value="delete">DELETE</option>
                                   <option value="head">HEAD</option>
                                   <option value="options">OPTIONS</option>
                               </select>
                               <input
                                   placeholder="URL"
                                   value={draft?.url ?? ""}
                                   onChange={(e) => setDraft(draft ? { ...draft, url: e.target.value } : null)}
                                   style={{ flex: 1 }}
                               />
                               <button onClick={sendSelected} disabled={!selectedRequestId || pending}>
                                   Send
                               </button>

                               <button onClick={cancel} disabled={!selectedRequestId || !pending}>
                                   Cancel
                               </button>

                               <span style={{ opacity: 0.7 }}>
              </span>
                           </div>
                           <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                               <button onClick={() => setTab("headers")} style={{ fontWeight: tab === "headers" ? "bold" : "normal" }}>Headers</button>
                               <button onClick={() => setTab("query")} style={{ fontWeight: tab === "query" ? "bold" : "normal" }}>Query</button>
                               <button onClick={() => setTab("body")} style={{ fontWeight: tab === "body" ? "bold" : "normal" }}>Body</button>
                               {/*<button onClick={() => setTab("json")} style={{ fontWeight: tab === "json" ? "bold" : "normal" }}>Raw JSON</button>*/}
                           </div>
                           {tab === "headers" && draft && (
                               <KeyValueTable
                                   rows={draft.headers}
                                   onChange={(next) => setDraft({ ...draft, headers: next })}
                               />
                           )}
                           {tab === "query" && draft && (
                               <KeyValueTable
                                   rows={draft.query}
                                   onChange={(next) => setDraft({ ...draft, query: next })}
                               />
                           )}

                           {tab === "body" && draft && (
                               <select
                                   value={draft?.body.type ?? "none"}
                                   onChange={(e) => {
                                       if (!draft) return;
                                       const t = e.target.value as any;
                                       const body =
                                           t === "none" ? { type: "none" } :
                                               t === "json" ? { type: "json", value: {} } :
                                                   t === "raw" ? { type: "raw", content_type: "text/plain", text: "" } :
                                                       { type: "form", fields: [] };
                                       setDraft({ ...draft, body });
                                   }}
                               >
                                   <option value="none">none</option>
                                   <option value="json">json</option>
                                   <option value="raw">raw</option>
                                   <option value="form">form</option>
                               </select>
                           )}
                           {tab === "body" && draft?.body.type === "json" && (
                               <Editor
                                   height="220px"
                                   language="json"
                                   theme="vs-dark"
                                   value={JSON.stringify(draft.body.value, null, 2)}
                                   onChange={(v) => {
                                       try {
                                           const parsed = JSON.parse(v ?? "{}");
                                           setDraft({ ...draft, body: { type: "json", value: parsed } });
                                       } catch {
                                           // option: status "invalid json"
                                       }
                                   }}
                                   options={{ minimap: { enabled: false }, tabSize: 2 }}
                               />
                           )}
                           {tab === "body" && draft?.body.type === "raw" && (
                               <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                   <input
                                       placeholder="Content-Type"
                                       value={draft.body.content_type}
                                       onChange={(e) => setDraft({ ...draft, body: { ...draft.body, content_type: e.target.value } })}
                                   />
                                   <Editor
                                       height="220px"
                                       language="text"
                                       theme="vs-dark"
                                       value={draft.body.text}
                                       onChange={(v) => setDraft({ ...draft, body: { ...draft.body, text: v ?? "" } })}
                                       options={{ minimap: { enabled: false }, tabSize: 2 }}
                                   />
                               </div>
                           )}

                           {tab === "body" && draft?.body.type === "form" && (
                               <KeyValueTable
                                   rows={draft.body.fields}
                                   onChange={(next) => setDraft({ ...draft, body: { type: "form", fields: next } })}
                               />
                           )}

                           {tab === "json" && (
                               <>
                                   <Editor
                                       height="400px"
                                       language="json"
                                       theme="vs-dark"
                                       value={editorText}
                                       onChange={(v) => setEditorText(v ?? "")}
                                       options={{ minimap: { enabled: false }, tabSize: 2 }}
                                   />
                                   <div style={{ display: "flex", gap: 8 }}>
                                       <button onClick={applyEditorToDraft} disabled={!draft}>
                                           Apply JSON
                                       </button>
                                       <button onClick={formatJson} disabled={!current}>Format JSON</button>
                                   </div>
                               </>
                           )}
                           <div
                               style={{
                                   display: "flex",
                                   gap: 8,
                                   flexDirection: "column",
                                   width: "100%",
                                   minHeight: 0,
                               }}
                           >
                               <div style={{ display: "flex", alignItems:"center" , justifyContent:"space-between", gap: 8, marginTop: "2em" }}>
                                   <div >
                                       <h3 style={{margin:0}}>Response</h3>
                                   </div>
                                   <div style={{ display: "flex", alignItems:"center" , gap: 8 }}>
                                       <h3 style={{margin:0}}>Status</h3>
                                       <div>{status}</div>
                                   </div>
                               </div>
                               <pre style={{ background: "#111", color: "#eee", width: "100%",height:"40vh", overflow: "auto" }}>
              {resp ? JSON.stringify(resp, null, 2) : "No response yet."}
            </pre>
                           </div>
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
       </>
    );
}