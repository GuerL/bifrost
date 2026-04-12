# Bifrost

Bifrost est un client HTTP desktop inspiré de Postman, construit avec **Tauri**, **React**, **TypeScript** et **Rust**.

L'objectif est de fournir un outil rapide et local pour tester des APIs avec :

- collections de requêtes
- variables d'environnement
- éditeur JSON
- runner de collections
- drafts persistés
- historique et résultats par requête

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

# Prérequis

Avant de lancer le projet, assure-toi d'avoir :

- **Node.js LTS**
- **npm**
- **Rust**
- **Tauri dependencies**

---

# Installation de Rust

Rust doit être installé via **rustup**, qui est le gestionnaire officiel des toolchains Rust.

---

## Option 1 — Installation officielle (recommandée)

```bash
curl https://sh.rustup.rs -sSf | sh
```

## License

This project is licensed under the **GNU Affero General Public License v3.0 only (AGPL-3.0-only)**.

If you redistribute modified versions of this project, those modifications must remain under the same AGPL v3 license.

If you modify this software and make it available to users over a network, you must also make the corresponding source code of that modified version available.

See [LICENSE](./LICENSE) for the full legal text.
