# Bifrost

Bifrost is a desktop HTTP client inspired by Postman, built with **Tauri**, **React**, **TypeScript**, and **Rust**.

The goal is to provide a fast, local tool for API testing with:

- request collections
- environment variables
- JSON editor
- collection runner
- persistent drafts
- request history and per-request results

## Positioning

Bifrost exists because many API clients shifted from developer tooling toward account-centric platforms. It is built as a fast, transparent desktop client for day-to-day API work where behavior stays understandable.

## The problem with many modern API tools

Many teams now deal with avoidable friction: vendor lock-in, forced accounts, opaque sync layers, heavier interfaces, slower startup, runtime behavior split between local and remote systems, and important capabilities that move behind paywalls. These patterns reduce control and make tooling harder to trust.

## What Bifrost does differently

Bifrost is local-first by design, with predictable execution and transparent storage. Data is meant to stay inspectable and portable, request behavior remains explicit, and scripting is visible rather than hidden behind platform internals. Its Tauri (Rust) + React architecture is chosen for responsive performance, and its AGPL-3.0-only license keeps improvements in the open ecosystem, including for network-used modifications.

## Core principles

- Developers should own their API data and workflow state.
- Core usage should not require a cloud account.
- Runtime logic should be explicit, deterministic, and inspectable.
- Collections and environments should stay portable.
- Scripting behavior should be transparent and auditable.
- Startup time and resource usage should stay low.

## Short summary paragraph

Bifrost is an open-source, local-first API client for developers who want speed, control, and predictable behavior. It prioritizes transparent storage, portable workflows, and an AGPL-governed open model over opaque platform dependencies.

---

# Stack

Frontend
- React
- TypeScript
- Vite
- Monaco Editor

Backend
- Rust
- Tauri v2

Desktop
- Tauri (WebView + Rust backend)

---

# Prerequisites

Before running the project, make sure you have:

- **Node.js LTS**
- **npm**
- **Rust**
- **Tauri dependencies**

---

# Rust Installation

Rust should be installed via **rustup**, the official Rust toolchain manager.

---

## Option 1 — Official installation (recommended)

```bash
curl https://sh.rustup.rs -sSf | sh
```

## License

This project is licensed under the **GNU Affero General Public License v3.0 only (AGPL-3.0-only)**.

If you redistribute modified versions of this project, those modifications must remain under the same AGPL v3 license.

If you modify this software and make it available to users over a network, you must also make the corresponding source code of that modified version available.

See [LICENSE](./LICENSE) for the full legal text.
