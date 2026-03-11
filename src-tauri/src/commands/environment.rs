use std::fs;
use tauri::AppHandle;
use uuid::Uuid;

use crate::model::environment::{Environment, EnvironmentsIndex};
use crate::storage::paths::{
    environment_path, environments_dir, environments_index_path, read_json, write_json,
};

fn load_or_init_index(app: &AppHandle) -> Result<EnvironmentsIndex, String> {
    let idx_path = environments_index_path(app)?;
    if idx_path.exists() {
        return read_json(&idx_path);
    }

    let idx = EnvironmentsIndex::default();
    write_json(&idx_path, &idx)?;
    Ok(idx)
}

fn save_index(app: &AppHandle, index: &EnvironmentsIndex) -> Result<(), String> {
    let idx_path = environments_index_path(app)?;
    write_json(&idx_path, index)
}

#[tauri::command]
pub fn init_default_environment(app: AppHandle) -> Result<(), String> {
    let default_env_path = environment_path(&app, "default")?;
    if !default_env_path.exists() {
        let default_env = Environment {
            id: "default".into(),
            name: "Default".into(),
            variables: vec![],
        };
        write_json(&default_env_path, &default_env)?;
    }

    let mut index = load_or_init_index(&app)?;
    if !index.order.iter().any(|id| id == "default") {
        index.order.insert(0, "default".into());
    }

    if index.active_environment_id.is_none() {
        index.active_environment_id = Some("default".into());
    }

    save_index(&app, &index)
}

#[tauri::command]
pub fn list_environments(app: AppHandle) -> Result<Vec<Environment>, String> {
    init_default_environment(app.clone())?;

    let index = load_or_init_index(&app)?;
    let mut out = vec![];

    for id in index.order {
        let p = environment_path(&app, &id)?;
        if p.exists() {
            let env = read_json::<Environment>(&p)?;
            out.push(env);
        }
    }

    Ok(out)
}

#[tauri::command]
pub fn load_environment(app: AppHandle, id: String) -> Result<Environment, String> {
    let p = environment_path(&app, &id)?;
    if !p.exists() {
        return Err(format!("Environment not found: {}", id));
    }
    read_json(&p)
}

#[tauri::command]
pub fn create_environment(app: AppHandle, name: String) -> Result<Environment, String> {
    let env = Environment {
        id: Uuid::new_v4().to_string(),
        name: if name.trim().is_empty() {
            "New Environment".into()
        } else {
            name.trim().into()
        },
        variables: vec![],
    };

    let p = environment_path(&app, &env.id)?;
    write_json(&p, &env)?;

    let mut index = load_or_init_index(&app)?;
    if !index.order.iter().any(|id| id == &env.id) {
        index.order.push(env.id.clone());
    }
    if index.active_environment_id.is_none() {
        index.active_environment_id = Some(env.id.clone());
    }
    save_index(&app, &index)?;

    Ok(env)
}

#[tauri::command]
pub fn duplicate_environment(
    app: AppHandle,
    source_environment_id: String,
    new_name: Option<String>,
) -> Result<Environment, String> {
    let source_path = environment_path(&app, &source_environment_id)?;
    if !source_path.exists() {
        return Err(format!("Environment not found: {}", source_environment_id));
    }

    let source = read_json::<Environment>(&source_path)?;
    let duplicated = Environment {
        id: Uuid::new_v4().to_string(),
        name: match new_name {
            Some(name) if !name.trim().is_empty() => name.trim().to_string(),
            _ => format!("{} Copy", source.name),
        },
        variables: source.variables,
    };

    let target_path = environment_path(&app, &duplicated.id)?;
    write_json(&target_path, &duplicated)?;

    let mut index = load_or_init_index(&app)?;
    if !index.order.iter().any(|id| id == &duplicated.id) {
        if let Some(pos) = index
            .order
            .iter()
            .position(|id| id == &source_environment_id)
        {
            index.order.insert(pos + 1, duplicated.id.clone());
        } else {
            index.order.push(duplicated.id.clone());
        }
    }
    save_index(&app, &index)?;

    Ok(duplicated)
}

#[tauri::command]
pub fn save_environment(app: AppHandle, environment: Environment) -> Result<(), String> {
    if environment.id.trim().is_empty() {
        return Err("Environment id is empty".into());
    }

    let mut env = environment;
    env.name = env.name.trim().to_string();
    if env.name.is_empty() {
        return Err("Environment name is empty".into());
    }

    let p = environment_path(&app, &env.id)?;
    write_json(&p, &env)?;

    let mut index = load_or_init_index(&app)?;
    if !index.order.iter().any(|id| id == &env.id) {
        index.order.push(env.id.clone());
    }
    if index.active_environment_id.is_none() {
        index.active_environment_id = Some(env.id.clone());
    }
    save_index(&app, &index)?;

    Ok(())
}

#[tauri::command]
pub fn delete_environment(app: AppHandle, environment_id: String) -> Result<(), String> {
    let p = environment_path(&app, &environment_id)?;
    if p.exists() {
        fs::remove_file(&p).map_err(|e| e.to_string())?;
    }

    let mut index = load_or_init_index(&app)?;
    index.order.retain(|id| id != &environment_id);

    if index.active_environment_id.as_deref() == Some(environment_id.as_str()) {
        index.active_environment_id = index.order.first().cloned();
    }

    save_index(&app, &index)
}

#[tauri::command]
pub fn get_active_environment(app: AppHandle) -> Result<Option<String>, String> {
    init_default_environment(app.clone())?;
    let index = load_or_init_index(&app)?;
    Ok(index.active_environment_id)
}

#[tauri::command]
pub fn set_active_environment(
    app: AppHandle,
    environment_id: Option<String>,
) -> Result<(), String> {
    let mut index = load_or_init_index(&app)?;

    if let Some(id) = environment_id {
        let p = environment_path(&app, &id)?;
        if !p.exists() {
            return Err(format!("Environment not found: {}", id));
        }
        index.active_environment_id = Some(id);
    } else {
        index.active_environment_id = None;
    }

    save_index(&app, &index)
}

pub fn load_environment_values(
    app: &AppHandle,
    explicit_environment_id: Option<String>,
) -> Result<std::collections::HashMap<String, String>, String> {
    let mut out = std::collections::HashMap::new();

    init_default_environment(app.clone())?;
    let index = load_or_init_index(app)?;
    let env_id = explicit_environment_id.or(index.active_environment_id);

    let Some(id) = env_id else {
        return Ok(out);
    };

    let p = environment_path(app, &id)?;
    if !p.exists() {
        return Ok(out);
    }

    let env = read_json::<Environment>(&p)?;
    for kv in env.variables {
        let key = kv.key.trim().to_string();
        if key.is_empty() {
            continue;
        }
        out.insert(key, kv.value);
    }

    Ok(out)
}

#[tauri::command]
pub fn open_environments_dir(app: AppHandle) -> Result<(), String> {
    let dir = environments_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(())
}
