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