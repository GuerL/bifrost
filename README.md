# Bifrost – Developer-first API client
![GitHub release](https://img.shields.io/github/v/release/guerl/bifrost)
![GitHub downloads](https://img.shields.io/github/downloads/guerl/bifrost/total)
![GitHub stars](https://img.shields.io/github/stars/guerl/bifrost)
![License](https://img.shields.io/github/license/guerl/bifrost)
![Tauri](https://img.shields.io/badge/runtime-tauri-blue)
![Rust](https://img.shields.io/badge/backend-rust-orange)
![React](https://img.shields.io/badge/frontend-react-blue)

Bifrost is a local-first desktop API client built for developers who want speed, clarity, and control over their workflows.

Built with **Tauri**, **Rust**, **React**, and **TypeScript**, Bifrost focuses on predictable behavior, transparent data handling, and a fast user experience without requiring a cloud account.

---

## Philosophy

Bifrost is designed around a simple idea:

developer tools should serve developers first.

Many modern API tools evolved toward account-centric ecosystems, adding layers of synchronization, abstraction, and platform coupling. While these approaches can be useful in some contexts, they can also introduce unnecessary friction for everyday API work.

Bifrost focuses on providing a clear, local, and understandable workflow that stays close to how developers naturally think and debug.

---

## Core principles

- Local-first by default
- Transparent data storage
- Predictable request execution
- Portable collections and environments
- Explicit runtime behavior
- Minimal startup time
- Lightweight architecture
- Developer-oriented workflow design

---

## Features

- HTTP request builder
- Request collections
- Environment variables
- JSON editor
- Collection runner
- Persistent drafts
- Request history
- Per-request execution results
- Local data storage
- Fast startup

---

## Architecture

Frontend
- React
- TypeScript
- Vite
- Monaco Editor

Backend
- Rust

Desktop runtime
- Tauri v2 (Rust + WebView)

This architecture allows Bifrost to remain lightweight while providing a responsive native experience.

---

## Why Bifrost

Bifrost prioritizes clarity over abstraction.

Execution remains understandable, storage stays inspectable, and workflows remain portable across environments.

The goal is not to reinvent API tooling, but to provide a stable, fast, and developer-friendly alternative focused on everyday productivity.

---

## Installation (dev)

Prerequisites:

- Node.js LTS
- npm
- Rust (via rustup)
- Tauri dependencies

Install Rust:

```bash
curl https://sh.rustup.rs -sSf | sh
```

---
## License

This project is licensed under the **GNU Affero General Public License v3.0 only (AGPL-3.0-only)**.

If you redistribute modified versions of this project, those modifications must remain under the same AGPL v3 license.

If you modify this software and make it available to users over a network, you must also make the corresponding source code of that modified version available.

See [LICENSE](./LICENSE) for the full legal text.

---

## Support the project

If Bifrost helps you, consider supporting development:

- GitHub Sponsors: https://github.com/sponsors/GuerL

- Buy Me a Coffee: https://buymeacoffee.com/quentinvb
