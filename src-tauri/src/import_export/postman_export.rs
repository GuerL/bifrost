use serde::Serialize;
use std::collections::HashMap;
use tauri::AppHandle;

use crate::commands::collection::load_collection;
use crate::model::collection::{
    Auth, AuthLocation, Body, CollectionMeta, CollectionNode, HttpMethod, KeyValue, MultipartField,
    Request,
};

#[derive(Debug, Serialize)]
pub struct PostmanCollectionExportDto {
    pub info: PostmanCollectionInfoExportDto,
    pub item: Vec<PostmanItemExportDto>,
}

#[derive(Debug, Serialize)]
pub struct PostmanCollectionInfoExportDto {
    pub name: String,
    pub schema: String,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum PostmanItemExportDto {
    Folder(PostmanFolderExportDto),
    Request(PostmanRequestItemExportDto),
}

#[derive(Debug, Serialize)]
pub struct PostmanFolderExportDto {
    pub name: String,
    pub item: Vec<PostmanItemExportDto>,
}

#[derive(Debug, Serialize)]
pub struct PostmanRequestItemExportDto {
    pub name: String,
    pub request: PostmanRequestExportDto,
}

#[derive(Debug, Serialize)]
pub struct PostmanRequestExportDto {
    pub method: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub header: Vec<PostmanHeaderExportDto>,
    pub url: PostmanUrlExportDto,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<PostmanBodyExportDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth: Option<PostmanAuthExportDto>,
}

#[derive(Debug, Serialize)]
pub struct PostmanHeaderExportDto {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Serialize)]
pub struct PostmanUrlExportDto {
    pub raw: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub query: Vec<PostmanQueryExportDto>,
}

#[derive(Debug, Serialize)]
pub struct PostmanQueryExportDto {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Serialize)]
pub struct PostmanBodyExportDto {
    pub mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub urlencoded: Vec<PostmanQueryExportDto>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub formdata: Vec<PostmanFormDataExportDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<PostmanBodyOptionsExportDto>,
}

#[derive(Debug, Serialize)]
pub struct PostmanFormDataExportDto {
    pub key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub src: Option<String>,
    #[serde(rename = "type")]
    pub field_type: String,
}

#[derive(Debug, Serialize)]
pub struct PostmanBodyOptionsExportDto {
    pub raw: PostmanBodyRawOptionsExportDto,
}

#[derive(Debug, Serialize)]
pub struct PostmanBodyRawOptionsExportDto {
    pub language: String,
}

#[derive(Debug, Serialize)]
pub struct PostmanAuthExportDto {
    #[serde(rename = "type")]
    pub auth_type: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub bearer: Vec<PostmanAuthAttributeExportDto>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub basic: Vec<PostmanAuthAttributeExportDto>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub apikey: Vec<PostmanAuthAttributeExportDto>,
}

#[derive(Debug, Serialize)]
pub struct PostmanAuthAttributeExportDto {
    pub key: String,
    pub value: String,
}

pub fn export_collection_postman_json_impl(
    app: &AppHandle,
    collection_id: &str,
) -> Result<String, String> {
    let loaded = load_collection(app.clone(), collection_id.to_string())?;
    let requests_by_id: HashMap<&str, &Request> = loaded
        .requests
        .iter()
        .map(|request| (request.id.as_str(), request))
        .collect();

    let item = map_collection_items(&loaded.meta, &requests_by_id);
    let out = PostmanCollectionExportDto {
        info: PostmanCollectionInfoExportDto {
            name: loaded.meta.name,
            schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
                .to_string(),
        },
        item,
    };

    serde_json::to_string_pretty(&out).map_err(|error| error.to_string())
}

pub fn export_collection_postman_to_file_impl(
    app: &AppHandle,
    collection_id: &str,
    path: &str,
) -> Result<(), String> {
    let json = export_collection_postman_json_impl(app, collection_id)?;
    let file = std::path::Path::new(path);
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::write(file, json).map_err(|error| error.to_string())
}

fn map_collection_items(
    meta: &CollectionMeta,
    requests_by_id: &HashMap<&str, &Request>,
) -> Vec<PostmanItemExportDto> {
    map_collection_items_recursive(&meta.items, requests_by_id)
}

fn map_collection_items_recursive(
    items: &[CollectionNode],
    requests_by_id: &HashMap<&str, &Request>,
) -> Vec<PostmanItemExportDto> {
    let mut out = vec![];
    for item in items {
        match item {
            CollectionNode::Folder { name, children, .. } => {
                out.push(PostmanItemExportDto::Folder(PostmanFolderExportDto {
                    name: name.clone(),
                    item: map_collection_items_recursive(children, requests_by_id),
                }));
            }
            CollectionNode::RequestRef { request_id } => {
                let Some(request) = requests_by_id.get(request_id.as_str()) else {
                    continue;
                };
                out.push(PostmanItemExportDto::Request(PostmanRequestItemExportDto {
                    name: request.name.clone(),
                    request: map_request(request),
                }));
            }
        }
    }
    out
}

fn map_request(request: &Request) -> PostmanRequestExportDto {
    let query = request
        .query
        .iter()
        .filter(|item| !item.key.trim().is_empty())
        .map(|item| PostmanQueryExportDto {
            key: item.key.clone(),
            value: item.value.clone(),
        })
        .collect::<Vec<_>>();

    let url = PostmanUrlExportDto {
        raw: build_raw_url(&request.url, &request.query),
        query,
    };

    let header = request
        .headers
        .iter()
        .filter(|item| !item.key.trim().is_empty())
        .map(|item| PostmanHeaderExportDto {
            key: item.key.clone(),
            value: item.value.clone(),
        })
        .collect::<Vec<_>>();

    PostmanRequestExportDto {
        method: map_method(&request.method),
        header,
        url,
        body: map_body(&request.body),
        auth: map_auth(&request.auth),
    }
}

fn map_method(method: &HttpMethod) -> String {
    match method {
        HttpMethod::Get => "GET",
        HttpMethod::Post => "POST",
        HttpMethod::Put => "PUT",
        HttpMethod::Patch => "PATCH",
        HttpMethod::Delete => "DELETE",
        HttpMethod::Head => "HEAD",
        HttpMethod::Options => "OPTIONS",
    }
    .to_string()
}

fn map_body(body: &Body) -> Option<PostmanBodyExportDto> {
    match body {
        Body::None => None,
        Body::Raw { text, content_type } => Some(PostmanBodyExportDto {
            mode: "raw".to_string(),
            raw: Some(text.clone()),
            urlencoded: vec![],
            formdata: vec![],
            options: Some(PostmanBodyOptionsExportDto {
                raw: PostmanBodyRawOptionsExportDto {
                    language: if content_type.to_ascii_lowercase().contains("json") {
                        "json".to_string()
                    } else {
                        "text".to_string()
                    },
                },
            }),
        }),
        Body::Json { text, value } => {
            let raw = if text.trim().is_empty() {
                serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string())
            } else {
                text.clone()
            };
            Some(PostmanBodyExportDto {
                mode: "raw".to_string(),
                raw: Some(raw),
                urlencoded: vec![],
                formdata: vec![],
                options: Some(PostmanBodyOptionsExportDto {
                    raw: PostmanBodyRawOptionsExportDto {
                        language: "json".to_string(),
                    },
                }),
            })
        }
        Body::Form { fields } => Some(PostmanBodyExportDto {
            mode: "urlencoded".to_string(),
            raw: None,
            urlencoded: fields
                .iter()
                .filter(|field| !field.key.trim().is_empty())
                .map(|field| PostmanQueryExportDto {
                    key: field.key.clone(),
                    value: field.value.clone(),
                })
                .collect(),
            formdata: vec![],
            options: None,
        }),
        Body::Multipart { fields } => Some(PostmanBodyExportDto {
            mode: "formdata".to_string(),
            raw: None,
            urlencoded: vec![],
            formdata: fields
                .iter()
                .filter_map(|field| match field {
                    MultipartField::Text {
                        enabled,
                        name,
                        value,
                        ..
                    } => {
                        if !*enabled || name.trim().is_empty() {
                            return None;
                        }
                        Some(PostmanFormDataExportDto {
                            key: name.clone(),
                            value: Some(value.clone()),
                            src: None,
                            field_type: "text".to_string(),
                        })
                    }
                    MultipartField::File {
                        enabled,
                        name,
                        file_path,
                        ..
                    } => {
                        if !*enabled || name.trim().is_empty() || file_path.trim().is_empty() {
                            return None;
                        }
                        Some(PostmanFormDataExportDto {
                            key: name.clone(),
                            value: None,
                            src: Some(file_path.clone()),
                            field_type: "file".to_string(),
                        })
                    }
                })
                .collect(),
            options: None,
        }),
    }
}

fn map_auth(auth: &Auth) -> Option<PostmanAuthExportDto> {
    match auth {
        Auth::None => None,
        Auth::Bearer { token } => Some(PostmanAuthExportDto {
            auth_type: "bearer".to_string(),
            bearer: vec![PostmanAuthAttributeExportDto {
                key: "token".to_string(),
                value: token.clone(),
            }],
            basic: vec![],
            apikey: vec![],
        }),
        Auth::Basic { username, password } => Some(PostmanAuthExportDto {
            auth_type: "basic".to_string(),
            bearer: vec![],
            basic: vec![
                PostmanAuthAttributeExportDto {
                    key: "username".to_string(),
                    value: username.clone(),
                },
                PostmanAuthAttributeExportDto {
                    key: "password".to_string(),
                    value: password.clone(),
                },
            ],
            apikey: vec![],
        }),
        Auth::ApiKey {
            key,
            value,
            location,
        } => Some(PostmanAuthExportDto {
            auth_type: "apikey".to_string(),
            bearer: vec![],
            basic: vec![],
            apikey: vec![
                PostmanAuthAttributeExportDto {
                    key: "key".to_string(),
                    value: key.clone(),
                },
                PostmanAuthAttributeExportDto {
                    key: "value".to_string(),
                    value: value.clone(),
                },
                PostmanAuthAttributeExportDto {
                    key: "in".to_string(),
                    value: match location {
                        AuthLocation::Header => "header".to_string(),
                        AuthLocation::Query => "query".to_string(),
                    },
                },
            ],
        }),
    }
}

fn build_raw_url(url: &str, query: &[KeyValue]) -> String {
    if query.is_empty() {
        return url.to_string();
    }

    let mut raw = url.to_string();
    raw.push(if raw.contains('?') { '&' } else { '?' });
    raw.push_str(
        &query
            .iter()
            .filter(|item| !item.key.trim().is_empty())
            .map(|item| format!("{}={}", item.key, item.value))
            .collect::<Vec<_>>()
            .join("&"),
    );
    raw
}
