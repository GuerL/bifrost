# Response saving

## Investigation and confirmed failure path

The compact download action in `ResponsePanel` invokes `save_response_body_to_file`
with a body ID and filename. Rust uses `tauri-plugin-dialog` to open the native
Save As dialog, resolves the explicitly selected `FilePath`, then writes bytes
with `std::fs`. It does not use the frontend filesystem plugin. The dialog plugin,
command, and `ResponseBodyStore` are registered in `lib.rs`; the existing main
window capability already grants `dialog:default`. No permission expansion is
needed. JSON is not restricted by the command or the response DTO.

`do_send_request` reads the response bytes, stores them under an opaque body ID,
and separately decodes a textual preview for rendering. Both text and binary
responses have downloadable metadata. Classification uses Content-Type and
Content-Disposition, independently of the viewer tab. Clipboard copying uses the
viewer's textual representation (including formatted JSON); saving uses the
original stored bytes instead.

The confirmed lifecycle defect was in `App.tsx`: persisted binary responses had
their process-local body IDs invalidated, but persisted text responses did not.
After restart, a successful JSON preview was restored with `available: true` and
an old body ID, while the Rust in-memory store was empty. Clicking Save passed
the UI guard, failed the Rust store lookup before the dialog, and the frontend
replaced every rejection with "Failed to save response". A regression test now
covers invalidation for both kinds. This establishes a concrete failure path;
the user's particular desktop session was not interactively reproduced.

A second race existed between the pre-dialog lookup and the post-dialog write:
a new response for the same request evicted the previous body. Saving now pins a
shared reference before opening the dialog, preserving the selected snapshot.

## Workflow and preservation

Live responses of every format use the same native Save As dialog and byte write.
An `Arc<Vec<u8>>` pins the buffer without copying it; the store lock is released
before showing the dialog or writing. Filesystem writes use `spawn_blocking`.
There is no JSON parsing, DOM extraction, UTF-8 encoding, base64, second HTTP
request, or full-body IPC transfer during saving. JSON whitespace, property order,
number spelling, Unicode encodings, binary bytes, and zero-byte bodies are
preserved. Bytes are those delivered by the existing reqwest response pipeline;
HTTP transfer/content decoding behavior is unchanged.

Persisted previews retain their existing display behavior but cannot claim that
original bytes survived a restart. Both old persisted records and newly written
records invalidate their body handles. The disabled action explains that the
request must be sent again. It never silently rebuilds an original file from a
potentially lossy preview. Raw body persistence across restarts is out of scope.

Filename priority is valid Content-Disposition `filename*` (UTF-8), then
`filename`, then the decoded request URL path, then `response`. Query strings and
fragments are excluded. Numeric URL IDs retain their resource prefix (`users-1`).
Path components are stripped, invalid/control characters replaced, Windows device
names prefixed, and long suggestions truncated on a Unicode boundary. Server
metadata never chooses a destination directory.

Known MIME types (ignoring parameters) determine extensions, including `+json`
and `+xml`; SVG retains `.svg`. A conflicting final extension is replaced, not
appended. Appropriate aliases such as `.jpeg`, `.htm`, and `.tgz` remain intact;
redundant repeated final extensions are removed. Unknown or octet-stream MIME
preserves a supplied extension, otherwise defaults to `.bin`. Users can edit the
suggestion in the dialog; filename inference never changes file bytes.

Successful saves use the existing success toast; cancellation is silent. Stable
backend codes distinguish unavailable bytes and filesystem permission errors from
unexpected failures. Diagnostic logging reports timing, identifiers, and safe
error categories without response content or destination paths. The compact
icon, accessible label, and tooltip remain alongside the existing actions.
Search, folds, depth, selected tabs, drafts, and request execution are unchanged.

## Validation

- `npm test`: 32 files, 469 tests passed. Includes mocked native command outcomes,
  cancellation, permission/missing-data errors, active request targeting, collapsed
  JSON/search preservation, zero-byte response availability, and persistence.
- `npm run build`: TypeScript and Vite production build passed. Vite reports the
  existing large-chunk advisory. No frontend lint script is configured.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib --offline`: 45 passed,
  one diagnostic benchmark ignored. Includes exact-byte writes for nested JSON,
  empty arrays/objects, Unicode, HTML, XML, PNG/PDF/ZIP byte sequences, arbitrary
  binary, empty files, and non-UTF-8 text; filename and pending-save races.
- Strict `cargo clippy ... -- -D warnings` fails on 15 existing findings in
  collection helpers, HTTP request helpers, import/export types, and lib setup.
  These unrelated areas were not changed.

Interactive Tauri validation was not available in this run. Native macOS dialog
interaction, Windows behavior, opening actual PDF/image files, ZIP extraction,
and light/dark theme checks remain manual validation items. Tests compare binary
bytes directly; they do not claim to validate complete document decoders.
