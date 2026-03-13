use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use tauri::AppHandle;
use uuid::Uuid;

use crate::model::collection::*;
use crate::storage::paths::*;
use crate::storage::paths::{delete_dir, read_json, write_json};

const COLLECTION_SCHEMA_VERSION: u32 = 2;

#[derive(Debug, Serialize, Deserialize, Default)]
struct CollectionsIndex {
    #[serde(default)]
    active_collection_id: Option<String>,
}

fn load_or_init_collections_index(app: &AppHandle) -> Result<CollectionsIndex, String> {
    let path = collections_index_path(app)?;
    if path.exists() {
        return read_json(&path);
    }
    let idx = CollectionsIndex::default();
    write_json(&path, &idx)?;
    Ok(idx)
}

fn save_collections_index(app: &AppHandle, idx: &CollectionsIndex) -> Result<(), String> {
    let path = collections_index_path(app)?;
    write_json(&path, idx)
}

fn request_ref(request_id: String) -> CollectionNode {
    CollectionNode::RequestRef { request_id }
}

fn flatten_request_ids(items: &[CollectionNode]) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    flatten_request_ids_into(items, &mut out, &mut seen);
    out
}

fn flatten_request_ids_into(
    items: &[CollectionNode],
    out: &mut Vec<String>,
    seen: &mut HashSet<String>,
) {
    for item in items {
        match item {
            CollectionNode::RequestRef { request_id } => {
                if seen.insert(request_id.clone()) {
                    out.push(request_id.clone());
                }
            }
            CollectionNode::Folder { children, .. } => flatten_request_ids_into(children, out, seen),
        }
    }
}

fn collect_request_ids(items: &[CollectionNode], out: &mut Vec<String>) {
    for item in items {
        match item {
            CollectionNode::RequestRef { request_id } => out.push(request_id.clone()),
            CollectionNode::Folder { children, .. } => collect_request_ids(children, out),
        }
    }
}

fn tree_contains_request(items: &[CollectionNode], request_id: &str) -> bool {
    items.iter().any(|item| match item {
        CollectionNode::RequestRef { request_id: id } => id == request_id,
        CollectionNode::Folder { children, .. } => tree_contains_request(children, request_id),
    })
}

fn remove_request_refs(items: &mut Vec<CollectionNode>, request_id: &str) -> usize {
    let mut removed = 0usize;
    let mut index = 0usize;

    while index < items.len() {
        match &mut items[index] {
            CollectionNode::RequestRef { request_id: id } if id == request_id => {
                items.remove(index);
                removed += 1;
                continue;
            }
            CollectionNode::Folder { children, .. } => {
                removed += remove_request_refs(children, request_id);
            }
            CollectionNode::RequestRef { .. } => {}
        }

        index += 1;
    }

    removed
}

fn replace_request_ref_ids(items: &mut Vec<CollectionNode>, source_id: &str, target_id: &str) -> usize {
    let mut replaced = 0usize;
    for item in items.iter_mut() {
        match item {
            CollectionNode::RequestRef { request_id } => {
                if request_id == source_id {
                    *request_id = target_id.to_string();
                    replaced += 1;
                }
            }
            CollectionNode::Folder { children, .. } => {
                replaced += replace_request_ref_ids(children, source_id, target_id);
            }
        }
    }
    replaced
}

fn sync_request_order(meta: &mut CollectionMeta) {
    meta.request_order = flatten_request_ids(&meta.items);
}

fn migrate_collection_meta(meta: &mut CollectionMeta) -> bool {
    let mut changed = false;

    if meta.items.is_empty() && !meta.request_order.is_empty() {
        meta.items = meta
            .request_order
            .iter()
            .map(|request_id| request_ref(request_id.clone()))
            .collect();
        changed = true;
    }

    if meta.version < COLLECTION_SCHEMA_VERSION {
        meta.version = COLLECTION_SCHEMA_VERSION;
        changed = true;
    }

    let next_order = flatten_request_ids(&meta.items);
    if meta.request_order != next_order {
        meta.request_order = next_order;
        changed = true;
    }

    changed
}

fn find_folder_path(items: &[CollectionNode], folder_id: &str) -> Option<Vec<usize>> {
    for (index, item) in items.iter().enumerate() {
        if let CollectionNode::Folder { id, children, .. } = item {
            if id == folder_id {
                return Some(vec![index]);
            }
            if let Some(mut nested) = find_folder_path(children, folder_id) {
                nested.insert(0, index);
                return Some(nested);
            }
        }
    }
    None
}

fn find_request_ref_path(items: &[CollectionNode], request_id: &str) -> Option<Vec<usize>> {
    for (index, item) in items.iter().enumerate() {
        match item {
            CollectionNode::RequestRef { request_id: id } if id == request_id => {
                return Some(vec![index]);
            }
            CollectionNode::Folder { children, .. } => {
                if let Some(mut nested) = find_request_ref_path(children, request_id) {
                    nested.insert(0, index);
                    return Some(nested);
                }
            }
            CollectionNode::RequestRef { .. } => {}
        }
    }
    None
}

fn find_node_path(items: &[CollectionNode], node_id: &str) -> Option<Vec<usize>> {
    for (index, item) in items.iter().enumerate() {
        match item {
            CollectionNode::Folder { id, children, .. } => {
                if id == node_id {
                    return Some(vec![index]);
                }
                if let Some(mut nested) = find_node_path(children, node_id) {
                    nested.insert(0, index);
                    return Some(nested);
                }
            }
            CollectionNode::RequestRef { request_id } => {
                if request_id == node_id {
                    return Some(vec![index]);
                }
            }
        }
    }
    None
}

fn node_at_path<'a>(items: &'a [CollectionNode], path: &[usize]) -> Option<&'a CollectionNode> {
    let (first, rest) = path.split_first()?;
    let node = items.get(*first)?;
    if rest.is_empty() {
        return Some(node);
    }
    match node {
        CollectionNode::Folder { children, .. } => node_at_path(children, rest),
        CollectionNode::RequestRef { .. } => None,
    }
}

fn node_mut_at_path<'a>(items: &'a mut Vec<CollectionNode>, path: &[usize]) -> Option<&'a mut CollectionNode> {
    let (first, rest) = path.split_first()?;
    let node = items.get_mut(*first)?;
    if rest.is_empty() {
        return Some(node);
    }
    match node {
        CollectionNode::Folder { children, .. } => node_mut_at_path(children, rest),
        CollectionNode::RequestRef { .. } => None,
    }
}

fn children_mut_at_path<'a>(
    items: &'a mut Vec<CollectionNode>,
    folder_path: &[usize],
) -> Option<&'a mut Vec<CollectionNode>> {
    if folder_path.is_empty() {
        return Some(items);
    }
    let (first, rest) = folder_path.split_first()?;
    let node = items.get_mut(*first)?;
    match node {
        CollectionNode::Folder { children, .. } => children_mut_at_path(children, rest),
        CollectionNode::RequestRef { .. } => None,
    }
}

fn remove_node_at_path(items: &mut Vec<CollectionNode>, path: &[usize]) -> Option<CollectionNode> {
    let (first, rest) = path.split_first()?;
    if rest.is_empty() {
        if *first >= items.len() {
            return None;
        }
        return Some(items.remove(*first));
    }

    let node = items.get_mut(*first)?;
    match node {
        CollectionNode::Folder { children, .. } => remove_node_at_path(children, rest),
        CollectionNode::RequestRef { .. } => None,
    }
}

fn path_starts_with(path: &[usize], prefix: &[usize]) -> bool {
    path.len() >= prefix.len() && path.iter().zip(prefix.iter()).all(|(a, b)| a == b)
}

fn is_root_flat_request_list(items: &[CollectionNode]) -> bool {
    items
        .iter()
        .all(|item| matches!(item, CollectionNode::RequestRef { .. }))
}

fn list_request_file_ids(app: &AppHandle, collection_id: &str) -> Result<Vec<String>, String> {
    let dir = requests_dir(app, collection_id)?;
    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut ids = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_file() {
            continue;
        }

        let file_name = entry.file_name().to_string_lossy().to_string();
        if let Some(request_id) = file_name.strip_suffix(".json") {
            if !request_id.trim().is_empty() {
                ids.push(request_id.to_string());
            }
        }
    }

    ids.sort();
    Ok(ids)
}

fn load_collection_meta(app: &AppHandle, collection_id: &str) -> Result<CollectionMeta, String> {
    let meta_path = collection_meta_path(app, collection_id)?;
    if !meta_path.exists() {
        return Err(format!("Collection not found: {}", collection_id));
    }

    let mut meta = read_json::<CollectionMeta>(&meta_path)?;
    let _ = migrate_collection_meta(&mut meta);
    Ok(meta)
}

fn load_collection_meta_and_migrate(
    app: &AppHandle,
    collection_id: &str,
) -> Result<CollectionMeta, String> {
    let meta_path = collection_meta_path(app, collection_id)?;
    if !meta_path.exists() {
        return Err(format!("Collection not found: {}", collection_id));
    }

    let mut meta = read_json::<CollectionMeta>(&meta_path)?;
    if migrate_collection_meta(&mut meta) {
        write_json(&meta_path, &meta)?;
    }
    Ok(meta)
}

fn save_collection_meta(app: &AppHandle, meta: &mut CollectionMeta) -> Result<(), String> {
    sync_request_order(meta);
    let meta_path = collection_meta_path(app, &meta.id)?;
    write_json(&meta_path, meta)
}

fn create_folder_node(name: String) -> CollectionNode {
    CollectionNode::Folder {
        id: format!("fld_{}", Uuid::new_v4().simple()),
        name,
        children: vec![],
    }
}

fn parent_children_mut<'a>(
    items: &'a mut Vec<CollectionNode>,
    parent_folder_id: Option<&str>,
) -> Result<&'a mut Vec<CollectionNode>, String> {
    if let Some(folder_id) = parent_folder_id {
        let path = find_folder_path(items, folder_id)
            .ok_or_else(|| format!("Folder not found: {}", folder_id))?;
        return children_mut_at_path(items, &path)
            .ok_or_else(|| format!("Folder not found: {}", folder_id));
    }

    Ok(items)
}

fn delete_request_file_if_exists(
    app: &AppHandle,
    collection_id: &str,
    request_id: &str,
) -> Result<(), String> {
    let req_path = request_path(app, collection_id, request_id)?;
    if req_path.exists() {
        fs::remove_file(&req_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn init_default_collection(app: AppHandle) -> Result<(), String> {
    let meta = CollectionMeta {
        version: COLLECTION_SCHEMA_VERSION,
        id: "default".into(),
        name: "Default".into(),
        request_order: vec![
            "ping".into(),
            "ping-second".into(),
            "invalid-http".into(),
            "timeout-http".into(),
        ],
        items: vec![
            request_ref("ping".into()),
            request_ref("ping-second".into()),
            request_ref("invalid-http".into()),
            request_ref("timeout-http".into()),
        ],
    };

    let ping = Request {
        id: "ping".into(),
        name: "Ping (GET)".into(),
        method: HttpMethod::Get,
        url: "https://postman-echo0.com/get".into(),
        headers: vec![],
        query: vec![],
        body: Body::None,
        auth: Auth::None,
        extractors: vec![],
        scripts: RequestScripts::default(),
    };

    let ping_second = Request {
        id: "ping-second".into(),
        name: "Ping (POST)".into(),
        method: HttpMethod::Post,
        url: "https://postman-echo.com/post".into(),
        headers: vec![],
        query: vec![],
        body: Body::Json {
            value: serde_json::json!({"hello": "world"}),
        },
        auth: Auth::None,
        extractors: vec![],
        scripts: RequestScripts::default(),
    };

    let invalid_htp_request = Request {
        id: "invalid-http".into(),
        name: "Invalid HTTP method".into(),
        method: HttpMethod::Get,
        url: "htp://postman-echo.com/get".into(),
        headers: vec![],
        query: vec![],
        body: Body::None,
        auth: Auth::None,
        extractors: vec![],
        scripts: RequestScripts::default(),
    };

    let timeout_http_request = Request {
        id: "timeout-http".into(),
        name: "Request with timeout".into(),
        method: HttpMethod::Get,
        url: "http://10.255.255.1".into(),
        headers: vec![],
        query: vec![],
        body: Body::None,
        auth: Auth::None,
        extractors: vec![],
        scripts: RequestScripts::default(),
    };

    let meta_path = collection_meta_path(&app, "default")?;
    let ping_path = request_path(&app, "default", "ping")?;
    let ping_second_path = request_path(&app, "default", "ping-second")?;
    let invalid_http_path = request_path(&app, "default", "invalid-http")?;
    let timeout_http_path = request_path(&app, "default", "timeout-http")?;

    if !meta_path.exists() {
        write_json(&meta_path, &meta)?;
    }
    if !ping_path.exists() {
        write_json(&ping_path, &ping)?;
    }
    if !ping_second_path.exists() {
        write_json(&ping_second_path, &ping_second)?;
    }
    if !invalid_http_path.exists() {
        write_json(&invalid_http_path, &invalid_htp_request)?;
    }
    if !timeout_http_path.exists() {
        write_json(&timeout_http_path, &timeout_http_request)?;
    }

    Ok(())
}

#[tauri::command]
pub fn overwrite_default(app: AppHandle) -> Result<(), String> {
    let meta_path = collection_meta_path(&app, "default")?;
    if meta_path.exists() {
        let dir = collection_dir(&app, "default")?;
        delete_dir(&dir)?;
    }
    init_default_collection(app)?;
    Ok(())
}

#[tauri::command]
pub fn list_collections(app: AppHandle) -> Result<Vec<CollectionMeta>, String> {
    let dir = collections_dir(&app)?;
    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut out = vec![];
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            continue;
        }

        let id = entry.file_name().to_string_lossy().to_string();
        let meta_path = collection_meta_path(&app, &id)?;
        if !meta_path.exists() {
            continue;
        }

        if let Ok(mut meta) = read_json::<CollectionMeta>(&meta_path) {
            if migrate_collection_meta(&mut meta) {
                let _ = write_json(&meta_path, &meta);
            }
            out.push(meta);
        }
    }

    Ok(out)
}

fn slugify_collection_id(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut last_dash = false;

    for ch in name.chars() {
        let c = ch.to_ascii_lowercase();
        if c.is_ascii_alphanumeric() {
            out.push(c);
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }

    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "collection".to_string()
    } else {
        trimmed
    }
}

#[tauri::command]
pub fn create_collection(app: AppHandle, name: String) -> Result<CollectionMeta, String> {
    let trimmed_name = name.trim().to_string();
    if trimmed_name.is_empty() {
        return Err("Collection name cannot be empty".into());
    }

    let base_id = slugify_collection_id(&trimmed_name);
    let mut candidate_id = base_id.clone();
    let mut counter = 2;

    while collection_meta_path(&app, &candidate_id)?.exists() {
        candidate_id = format!("{base_id}-{counter}");
        counter += 1;
    }

    let meta = CollectionMeta {
        version: COLLECTION_SCHEMA_VERSION,
        id: candidate_id,
        name: trimmed_name,
        request_order: vec![],
        items: vec![],
    };

    let meta_path = collection_meta_path(&app, &meta.id)?;
    write_json(&meta_path, &meta)?;
    Ok(meta)
}

#[tauri::command]
pub fn rename_collection(
    app: AppHandle,
    collection_id: String,
    new_name: String,
) -> Result<(), String> {
    if collection_id.trim().is_empty() {
        return Err("Collection id is empty".into());
    }

    let trimmed_name = new_name.trim().to_string();
    if trimmed_name.is_empty() {
        return Err("Collection name cannot be empty".into());
    }

    let mut meta = load_collection_meta(&app, &collection_id)?;
    meta.name = trimmed_name;
    save_collection_meta(&app, &mut meta)
}

#[tauri::command]
pub fn delete_collection(app: AppHandle, collection_id: String) -> Result<(), String> {
    if collection_id.trim().is_empty() {
        return Err("Collection id is empty".into());
    }

    let meta_path = collection_meta_path(&app, &collection_id)?;
    if !meta_path.exists() {
        return Err(format!("Collection not found: {}", collection_id));
    }

    let dir = collection_dir(&app, &collection_id)?;
    delete_dir(&dir)?;

    let mut idx = load_or_init_collections_index(&app)?;
    if idx.active_collection_id.as_deref() == Some(collection_id.as_str()) {
        idx.active_collection_id = None;
        save_collections_index(&app, &idx)?;
    }

    Ok(())
}

#[tauri::command]
pub fn load_collection(app: AppHandle, id: String) -> Result<CollectionLoaded, String> {
    let meta_path = collection_meta_path(&app, &id)?;
    if !meta_path.exists() {
        return Err(format!("Collection not found: {}", id));
    }

    let mut meta = read_json::<CollectionMeta>(&meta_path)?;
    let mut changed = migrate_collection_meta(&mut meta);

    let known_request_ids = flatten_request_ids(&meta.items);
    let known_set: HashSet<String> = known_request_ids.iter().cloned().collect();
    let request_file_ids = list_request_file_ids(&app, &id)?;
    for request_id in request_file_ids {
        if known_set.contains(&request_id) {
            continue;
        }
        meta.items.push(request_ref(request_id));
        changed = true;
    }

    if changed {
        save_collection_meta(&app, &mut meta)?;
    }

    let ordered_ids = flatten_request_ids(&meta.items);
    let mut requests = vec![];
    for req_id in ordered_ids {
        let path = request_path(&app, &id, &req_id)?;
        if !path.exists() {
            continue;
        }
        let request = read_json::<Request>(&path)?;
        requests.push(request);
    }

    Ok(CollectionLoaded { meta, requests })
}

#[tauri::command]
pub fn create_folder(
    app: AppHandle,
    collection_id: String,
    parent_folder_id: Option<String>,
    name: String,
) -> Result<String, String> {
    let trimmed = name.trim().to_string();
    if trimmed.is_empty() {
        return Err("Folder name cannot be empty".into());
    }

    let mut meta = load_collection_meta_and_migrate(&app, &collection_id)?;
    let folder = create_folder_node(trimmed);
    let folder_id = match &folder {
        CollectionNode::Folder { id, .. } => id.clone(),
        CollectionNode::RequestRef { .. } => unreachable!(),
    };

    let children = parent_children_mut(&mut meta.items, parent_folder_id.as_deref())?;
    children.push(folder);
    save_collection_meta(&app, &mut meta)?;
    Ok(folder_id)
}

#[tauri::command]
pub fn rename_folder(
    app: AppHandle,
    collection_id: String,
    folder_id: String,
    new_name: String,
) -> Result<(), String> {
    let trimmed = new_name.trim().to_string();
    if trimmed.is_empty() {
        return Err("Folder name cannot be empty".into());
    }

    let mut meta = load_collection_meta_and_migrate(&app, &collection_id)?;
    let path =
        find_folder_path(&meta.items, &folder_id).ok_or_else(|| format!("Folder not found: {}", folder_id))?;
    let node =
        node_mut_at_path(&mut meta.items, &path).ok_or_else(|| format!("Folder not found: {}", folder_id))?;
    match node {
        CollectionNode::Folder { name, .. } => {
            *name = trimmed;
        }
        CollectionNode::RequestRef { .. } => {
            return Err(format!("Folder not found: {}", folder_id));
        }
    }

    save_collection_meta(&app, &mut meta)
}

#[tauri::command]
pub fn delete_folder(
    app: AppHandle,
    collection_id: String,
    folder_id: String,
) -> Result<(), String> {
    let mut meta = load_collection_meta_and_migrate(&app, &collection_id)?;
    let path =
        find_folder_path(&meta.items, &folder_id).ok_or_else(|| format!("Folder not found: {}", folder_id))?;

    let removed =
        remove_node_at_path(&mut meta.items, &path).ok_or_else(|| format!("Folder not found: {}", folder_id))?;
    let mut request_ids = vec![];
    collect_request_ids(&[removed], &mut request_ids);

    let mut seen = HashSet::new();
    for request_id in request_ids {
        if !seen.insert(request_id.clone()) {
            continue;
        }
        delete_request_file_if_exists(&app, &collection_id, &request_id)?;
    }

    save_collection_meta(&app, &mut meta)
}

#[tauri::command]
pub fn move_node(
    app: AppHandle,
    collection_id: String,
    node_id: String,
    target_folder_id: Option<String>,
    target_index: usize,
) -> Result<(), String> {
    let mut meta = load_collection_meta_and_migrate(&app, &collection_id)?;
    let source_path =
        find_node_path(&meta.items, &node_id).ok_or_else(|| format!("Node not found: {}", node_id))?;

    let source_node =
        node_at_path(&meta.items, &source_path).ok_or_else(|| format!("Node not found: {}", node_id))?;
    let source_is_folder = matches!(source_node, CollectionNode::Folder { .. });
    let source_parent_path = if source_path.len() > 1 {
        source_path[..source_path.len() - 1].to_vec()
    } else {
        vec![]
    };
    let source_index = source_path
        .last()
        .copied()
        .ok_or_else(|| format!("Node not found: {}", node_id))?;

    let target_parent_path_before = if let Some(folder_id) = target_folder_id.as_deref() {
        find_folder_path(&meta.items, folder_id)
            .ok_or_else(|| format!("Folder not found: {}", folder_id))?
    } else {
        vec![]
    };

    if source_is_folder && path_starts_with(&target_parent_path_before, &source_path) {
        return Err("Cannot move a folder into itself or one of its descendants".into());
    }

    let same_parent = source_parent_path == target_parent_path_before;
    let mut adjusted_target_index = target_index;
    if same_parent && source_index < adjusted_target_index {
        adjusted_target_index -= 1;
    }

    let removed =
        remove_node_at_path(&mut meta.items, &source_path).ok_or_else(|| format!("Node not found: {}", node_id))?;

    let destination_children = parent_children_mut(&mut meta.items, target_folder_id.as_deref())?;
    let insert_index = adjusted_target_index.min(destination_children.len());
    destination_children.insert(insert_index, removed);

    save_collection_meta(&app, &mut meta)
}

#[tauri::command]
pub fn create_request(
    app: AppHandle,
    collection_id: String,
    request: Request,
    parent_folder_id: Option<String>,
) -> Result<(), String> {
    if request.id.trim().is_empty() {
        return Err("Request id is empty".into());
    }

    let mut meta = load_collection_meta_and_migrate(&app, &collection_id)?;
    let req_path = request_path(&app, &collection_id, &request.id)?;
    if req_path.exists() {
        return Err(format!("Request already exists: {}", request.id));
    }

    write_json(&req_path, &request)?;

    if !tree_contains_request(&meta.items, &request.id) {
        let children = parent_children_mut(&mut meta.items, parent_folder_id.as_deref())?;
        children.push(request_ref(request.id.clone()));
    }

    save_collection_meta(&app, &mut meta)
}

#[tauri::command]
pub fn update_request(
    app: AppHandle,
    collection_id: String,
    request: Request,
) -> Result<(), String> {
    if request.id.trim().is_empty() {
        return Err("Request id is empty".into());
    }

    let mut meta = load_collection_meta_and_migrate(&app, &collection_id)?;
    let req_path = request_path(&app, &collection_id, &request.id)?;
    write_json(&req_path, &request)?;

    if !tree_contains_request(&meta.items, &request.id) {
        meta.items.push(request_ref(request.id.clone()));
    }

    save_collection_meta(&app, &mut meta)
}

#[tauri::command]
pub fn delete_request(
    app: AppHandle,
    collection_id: String,
    request_id: String,
) -> Result<(), String> {
    if request_id.trim().is_empty() {
        return Err("Request id is empty".into());
    }

    let mut meta = load_collection_meta_and_migrate(&app, &collection_id)?;
    delete_request_file_if_exists(&app, &collection_id, &request_id)?;
    remove_request_refs(&mut meta.items, &request_id);
    save_collection_meta(&app, &mut meta)
}

#[tauri::command]
pub fn rename_request(
    app: AppHandle,
    collection_id: String,
    request_id: String,
    new_name: String,
    new_request_id: Option<String>,
) -> Result<(), String> {
    if request_id.trim().is_empty() {
        return Err("Request id is empty".into());
    }

    let trimmed_name = new_name.trim().to_string();
    if trimmed_name.is_empty() {
        return Err("New request name is empty".into());
    }

    let mut meta = load_collection_meta_and_migrate(&app, &collection_id)?;
    if find_request_ref_path(&meta.items, &request_id).is_none() {
        return Err(format!("Request not found in collection tree: {}", request_id));
    }

    let source_path = request_path(&app, &collection_id, &request_id)?;
    if !source_path.exists() {
        return Err(format!("Request not found: {}", request_id));
    }

    let target_request_id = new_request_id
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| request_id.clone());

    if target_request_id != request_id {
        let target_path = request_path(&app, &collection_id, &target_request_id)?;
        if target_path.exists() {
            return Err(format!("Target request already exists: {}", target_request_id));
        }
    }

    let mut request = read_json::<Request>(&source_path)?;
    request.id = target_request_id.clone();
    request.name = trimmed_name;

    let target_path = request_path(&app, &collection_id, &target_request_id)?;
    write_json(&target_path, &request)?;

    if target_request_id != request_id {
        fs::remove_file(&source_path).map_err(|e| e.to_string())?;
        replace_request_ref_ids(&mut meta.items, &request_id, &target_request_id);
    }

    save_collection_meta(&app, &mut meta)
}

#[tauri::command]
pub fn reorder_requests(
    app: AppHandle,
    collection_id: String,
    request_order: Vec<String>,
) -> Result<(), String> {
    let mut meta = load_collection_meta_and_migrate(&app, &collection_id)?;
    if !is_root_flat_request_list(&meta.items) {
        return Err("Flat request reorder is not supported for nested folders. Use move_node.".into());
    }

    let current_order = flatten_request_ids(&meta.items);
    if current_order.len() != request_order.len() {
        return Err("Invalid request order length".into());
    }

    let mut expected = current_order;
    let mut next = request_order.clone();
    expected.sort();
    next.sort();

    if expected != next {
        return Err("Invalid request order IDs".into());
    }

    meta.items = request_order.into_iter().map(request_ref).collect();
    save_collection_meta(&app, &mut meta)
}

#[tauri::command]
pub fn duplicate_request(
    app: AppHandle,
    collection_id: String,
    source_request_id: String,
    new_request_id: String,
    new_name: Option<String>,
    target_folder_id: Option<String>,
) -> Result<(), String> {
    if source_request_id.trim().is_empty() {
        return Err("Source request id is empty".into());
    }
    if new_request_id.trim().is_empty() {
        return Err("New request id is empty".into());
    }
    if source_request_id == new_request_id {
        return Err("New request id must be different from source request id".into());
    }

    let mut meta = load_collection_meta_and_migrate(&app, &collection_id)?;
    let source_path = request_path(&app, &collection_id, &source_request_id)?;
    if !source_path.exists() {
        return Err(format!("Source request not found: {}", source_request_id));
    }

    let target_path = request_path(&app, &collection_id, &new_request_id)?;
    if target_path.exists() {
        return Err(format!("Target request already exists: {}", new_request_id));
    }

    let mut duplicated = read_json::<Request>(&source_path)?;
    duplicated.id = new_request_id.clone();
    duplicated.name = match new_name {
        Some(name) if !name.trim().is_empty() => name.trim().to_string(),
        _ => format!("{} Copy", duplicated.name),
    };

    write_json(&target_path, &duplicated)?;

    if !tree_contains_request(&meta.items, &new_request_id) {
        if let Some(folder_id) = target_folder_id {
            let children = parent_children_mut(&mut meta.items, Some(folder_id.as_str()))?;
            children.push(request_ref(new_request_id));
        } else if let Some(source_ref_path) = find_request_ref_path(&meta.items, &source_request_id) {
            let parent_path = if source_ref_path.len() > 1 {
                source_ref_path[..source_ref_path.len() - 1].to_vec()
            } else {
                vec![]
            };
            let source_index = source_ref_path
                .last()
                .copied()
                .ok_or_else(|| "Invalid source path".to_string())?;
            let children = children_mut_at_path(&mut meta.items, &parent_path)
                .ok_or_else(|| "Invalid source parent path".to_string())?;
            let insert_index = (source_index + 1).min(children.len());
            children.insert(insert_index, request_ref(new_request_id));
        } else {
            meta.items.push(request_ref(new_request_id));
        }
    }

    save_collection_meta(&app, &mut meta)
}

#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
pub fn load_drafts(app: AppHandle, collection_id: String) -> Result<HashMap<String, Request>, String> {
    let path = draft_collection_path(&app, &collection_id)?;
    if !path.exists() {
        return Ok(HashMap::new());
    }

    read_json(&path)
}

#[tauri::command]
pub fn save_drafts(
    app: AppHandle,
    collection_id: String,
    drafts: HashMap<String, Request>,
) -> Result<(), String> {
    let path = draft_collection_path(&app, &collection_id)?;
    write_json(&path, &drafts)
}

#[tauri::command]
pub fn clear_draft(
    app: AppHandle,
    collection_id: String,
    request_id: String,
) -> Result<(), String> {
    let path = draft_collection_path(&app, &collection_id)?;
    let mut drafts: HashMap<String, Request> = if path.exists() {
        read_json(&path)?
    } else {
        HashMap::new()
    };

    drafts.remove(&request_id);
    write_json(&path, &drafts)
}

#[tauri::command]
pub fn get_active_collection(app: AppHandle) -> Result<Option<String>, String> {
    let mut idx = load_or_init_collections_index(&app)?;

    if let Some(id) = idx.active_collection_id.clone() {
        let meta_path = collection_meta_path(&app, &id)?;
        if !meta_path.exists() {
            idx.active_collection_id = None;
            save_collections_index(&app, &idx)?;
            return Ok(None);
        }
    }

    Ok(idx.active_collection_id)
}

#[tauri::command]
pub fn set_active_collection(
    app: AppHandle,
    collection_id: Option<String>,
) -> Result<(), String> {
    let mut idx = load_or_init_collections_index(&app)?;

    if let Some(id) = collection_id {
        let meta_path = collection_meta_path(&app, &id)?;
        if !meta_path.exists() {
            return Err(format!("Collection not found: {}", id));
        }
        idx.active_collection_id = Some(id);
    } else {
        idx.active_collection_id = None;
    }

    save_collections_index(&app, &idx)
}
