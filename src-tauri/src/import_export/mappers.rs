use serde::Deserialize;
use uuid::Uuid;

use crate::model::collection::{
    Auth, AuthLocation, Body, CollectionNode, HttpMethod, KeyValue, Request, RequestScripts,
};
use crate::model::environment::EnvironmentVariable;

#[derive(Debug, Deserialize)]
pub struct PostmanCollectionDto {
    pub info: PostmanCollectionInfoDto,
    #[serde(default)]
    pub item: Vec<PostmanItemDto>,
    #[serde(default)]
    pub variable: Vec<PostmanVariableDto>,
    #[serde(default)]
    pub auth: Option<PostmanAuthDto>,
}

#[derive(Debug, Deserialize)]
pub struct PostmanCollectionInfoDto {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub schema: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct PostmanItemDto {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub item: Vec<PostmanItemDto>,
    #[serde(default)]
    pub request: Option<PostmanRequestUnionDto>,
    #[serde(default)]
    pub event: Vec<PostmanEventDto>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(untagged)]
pub enum PostmanRequestUnionDto {
    Request(PostmanRequestDto),
    UrlString(String),
}

#[derive(Debug, Deserialize, Clone)]
pub struct PostmanRequestDto {
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub url: Option<PostmanUrlUnionDto>,
    #[serde(default)]
    pub header: Vec<PostmanHeaderUnionDto>,
    #[serde(default)]
    pub body: Option<PostmanBodyDto>,
    #[serde(default)]
    pub auth: Option<PostmanAuthDto>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(untagged)]
pub enum PostmanUrlUnionDto {
    String(String),
    Object(PostmanUrlObjectDto),
}

#[derive(Debug, Deserialize, Clone)]
pub struct PostmanUrlObjectDto {
    #[serde(default)]
    pub raw: Option<String>,
    #[serde(default)]
    pub protocol: Option<String>,
    #[serde(default)]
    pub host: Option<serde_json::Value>,
    #[serde(default)]
    pub path: Option<serde_json::Value>,
    #[serde(default)]
    pub query: Vec<PostmanQueryDto>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct PostmanQueryDto {
    #[serde(default)]
    pub key: Option<String>,
    #[serde(default)]
    pub value: Option<serde_json::Value>,
    #[serde(default)]
    pub disabled: Option<bool>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(untagged)]
pub enum PostmanHeaderUnionDto {
    Object(PostmanHeaderDto),
    String(String),
}

#[derive(Debug, Deserialize, Clone)]
pub struct PostmanHeaderDto {
    #[serde(default)]
    pub key: Option<String>,
    #[serde(default)]
    pub value: Option<serde_json::Value>,
    #[serde(default)]
    pub disabled: Option<bool>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct PostmanBodyDto {
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub raw: Option<String>,
    #[serde(default)]
    pub urlencoded: Vec<PostmanParamDto>,
    #[serde(default)]
    pub formdata: Vec<PostmanFormDataDto>,
    #[serde(default)]
    pub options: Option<PostmanBodyOptionsDto>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct PostmanParamDto {
    #[serde(default)]
    pub key: Option<String>,
    #[serde(default)]
    pub value: Option<serde_json::Value>,
    #[serde(default)]
    pub disabled: Option<bool>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct PostmanFormDataDto {
    #[serde(default)]
    pub key: Option<String>,
    #[serde(default)]
    pub value: Option<serde_json::Value>,
    #[serde(default, rename = "type")]
    pub field_type: Option<String>,
    #[serde(default)]
    pub disabled: Option<bool>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct PostmanBodyOptionsDto {
    #[serde(default)]
    pub raw: Option<PostmanBodyRawOptionsDto>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct PostmanBodyRawOptionsDto {
    #[serde(default)]
    pub language: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct PostmanAuthDto {
    #[serde(default, rename = "type")]
    pub auth_type: Option<String>,
    #[serde(default)]
    pub bearer: Vec<PostmanAuthAttributeDto>,
    #[serde(default)]
    pub basic: Vec<PostmanAuthAttributeDto>,
    #[serde(default)]
    pub apikey: Vec<PostmanAuthAttributeDto>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct PostmanAuthAttributeDto {
    #[serde(default)]
    pub key: Option<String>,
    #[serde(default)]
    pub value: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct PostmanVariableDto {
    #[serde(default)]
    pub key: Option<String>,
    #[serde(default)]
    pub value: Option<serde_json::Value>,
    #[serde(default)]
    pub disabled: Option<bool>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct PostmanEventDto {
    #[serde(default)]
    pub listen: Option<String>,
    #[serde(default)]
    pub script: Option<PostmanScriptDto>,
    #[serde(default)]
    pub disabled: Option<bool>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct PostmanScriptDto {
    #[serde(default)]
    pub exec: Option<PostmanScriptExecDto>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(untagged)]
pub enum PostmanScriptExecDto {
    Lines(Vec<String>),
    Single(String),
}

#[derive(Debug)]
pub struct MappedPostmanCollection {
    pub name: String,
    pub items: Vec<CollectionNode>,
    pub requests: Vec<Request>,
    pub variables: Vec<EnvironmentVariable>,
    pub warnings: Vec<String>,
    pub request_count: usize,
    pub folder_count: usize,
}

pub fn map_postman_collection(dto: PostmanCollectionDto) -> MappedPostmanCollection {
    let mut warnings = vec![];
    if let Some(schema) = dto.info.schema.as_ref() {
        if !schema.contains("postman.com/json/collection/v2.1.0") {
            warnings.push(format!(
                "Schema is not Postman v2.1: {} (continuing with best-effort mapping)",
                schema
            ));
        }
    }

    let collection_name = if dto.info.name.trim().is_empty() {
        "Imported Collection".to_string()
    } else {
        dto.info.name.trim().to_string()
    };

    let mut requests = vec![];
    let mut folder_count = 0usize;
    let mut request_count = 0usize;
    let mut items = vec![];

    for item in &dto.item {
        if let Some(node) = map_item_recursive(
            item,
            dto.auth.as_ref(),
            &mut requests,
            &mut warnings,
            &mut folder_count,
            &mut request_count,
        ) {
            items.push(node);
        }
    }

    let variables = map_collection_variables(&dto.variable);

    MappedPostmanCollection {
        name: collection_name,
        items,
        requests,
        variables,
        warnings,
        request_count,
        folder_count,
    }
}

fn map_item_recursive(
    item: &PostmanItemDto,
    default_auth: Option<&PostmanAuthDto>,
    out_requests: &mut Vec<Request>,
    warnings: &mut Vec<String>,
    folder_count: &mut usize,
    request_count: &mut usize,
) -> Option<CollectionNode> {
    if item.request.is_some() {
        let request_name = item
            .name
            .as_ref()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| "Imported Request".to_string());

        let request = map_request(
            item.request.as_ref()?,
            &request_name,
            default_auth,
            &item.event,
            warnings,
        );
        let request_id = request.id.clone();
        out_requests.push(request);
        *request_count += 1;
        return Some(CollectionNode::RequestRef {
            request_id: request_id.to_string(),
        });
    }

    let folder_name = item
        .name
        .as_ref()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "Folder".to_string());

    let mut children = vec![];
    for child in &item.item {
        if let Some(mapped) = map_item_recursive(
            child,
            default_auth,
            out_requests,
            warnings,
            folder_count,
            request_count,
        ) {
            children.push(mapped);
        }
    }

    *folder_count += 1;
    Some(CollectionNode::Folder {
        id: format!("fld_{}", Uuid::new_v4().simple()),
        name: folder_name,
        children,
    })
}

fn map_request(
    postman_request: &PostmanRequestUnionDto,
    request_name: &str,
    default_auth: Option<&PostmanAuthDto>,
    events: &[PostmanEventDto],
    warnings: &mut Vec<String>,
) -> Request {
    let request_id = Uuid::new_v4().to_string();

    let (method, url, headers, query, body, auth) = match postman_request {
        PostmanRequestUnionDto::UrlString(url) => (
            HttpMethod::Get,
            url.trim().to_string(),
            vec![],
            vec![],
            Body::None,
            Auth::None,
        ),
        PostmanRequestUnionDto::Request(request) => {
            let headers = map_headers(&request.header);
            let header_content_type = headers
                .iter()
                .find(|entry| entry.key.eq_ignore_ascii_case("content-type"))
                .map(|entry| entry.value.clone());
            let (url, query) = map_url(request.url.as_ref());
            let method = map_method(request.method.as_deref(), request_name, warnings);
            let body = map_body(
                request.body.as_ref(),
                header_content_type.as_deref(),
                request_name,
                warnings,
            );
            let auth = map_auth(request.auth.as_ref().or(default_auth));
            (method, url, headers, query, body, auth)
        }
    };

    Request {
        id: request_id,
        name: request_name.to_string(),
        method,
        url,
        headers,
        query,
        body,
        auth,
        extractors: vec![],
        scripts: map_scripts(events),
    }
}

fn map_method(method: Option<&str>, request_name: &str, warnings: &mut Vec<String>) -> HttpMethod {
    let Some(method) = method else {
        return HttpMethod::Get;
    };

    match method.trim().to_ascii_uppercase().as_str() {
        "GET" => HttpMethod::Get,
        "POST" => HttpMethod::Post,
        "PUT" => HttpMethod::Put,
        "PATCH" => HttpMethod::Patch,
        "DELETE" => HttpMethod::Delete,
        "HEAD" => HttpMethod::Head,
        "OPTIONS" => HttpMethod::Options,
        other => {
            warnings.push(format!(
                "Unsupported method '{}' on request '{}', defaulted to GET",
                other, request_name
            ));
            HttpMethod::Get
        }
    }
}

fn map_url(url: Option<&PostmanUrlUnionDto>) -> (String, Vec<KeyValue>) {
    let Some(url) = url else {
        return ("".to_string(), vec![]);
    };

    match url {
        PostmanUrlUnionDto::String(raw) => (raw.trim().to_string(), vec![]),
        PostmanUrlUnionDto::Object(obj) => {
            let query = obj
                .query
                .iter()
                .filter(|entry| entry.disabled.unwrap_or(false) == false)
                .filter_map(|entry| {
                    let key = entry.key.as_ref()?.trim().to_string();
                    if key.is_empty() {
                        return None;
                    }
                    Some(KeyValue {
                        key,
                        value: json_value_to_string(entry.value.as_ref()),
                    })
                })
                .collect::<Vec<_>>();

            if let Some(raw) = obj.raw.as_ref() {
                let raw = raw.trim().to_string();
                if query.is_empty() {
                    return (raw, query);
                }
                if let Some((base, _)) = raw.split_once('?') {
                    return (base.to_string(), query);
                }
                return (raw, query);
            }

            let mut reconstructed = String::new();
            if let Some(protocol) = obj.protocol.as_ref() {
                if !protocol.trim().is_empty() {
                    reconstructed.push_str(protocol.trim());
                    reconstructed.push_str("://");
                }
            }

            if let Some(host) = obj.host.as_ref() {
                reconstructed.push_str(&join_value_segments(host, "."));
            }

            if let Some(path) = obj.path.as_ref() {
                let path_value = join_value_segments(path, "/");
                if !path_value.is_empty() {
                    if !reconstructed.ends_with('/') {
                        reconstructed.push('/');
                    }
                    reconstructed.push_str(path_value.trim_start_matches('/'));
                }
            }

            (reconstructed, query)
        }
    }
}

fn map_headers(headers: &[PostmanHeaderUnionDto]) -> Vec<KeyValue> {
    headers
        .iter()
        .filter_map(|header| match header {
            PostmanHeaderUnionDto::Object(entry) => {
                if entry.disabled.unwrap_or(false) {
                    return None;
                }
                let key = entry.key.as_ref()?.trim().to_string();
                if key.is_empty() {
                    return None;
                }
                Some(KeyValue {
                    key,
                    value: json_value_to_string(entry.value.as_ref()),
                })
            }
            PostmanHeaderUnionDto::String(raw) => {
                let (key, value) = raw.split_once(':')?;
                let key = key.trim().to_string();
                if key.is_empty() {
                    return None;
                }
                Some(KeyValue {
                    key,
                    value: value.trim().to_string(),
                })
            }
        })
        .collect()
}

fn map_body(
    body: Option<&PostmanBodyDto>,
    content_type_header: Option<&str>,
    request_name: &str,
    warnings: &mut Vec<String>,
) -> Body {
    let Some(body) = body else {
        return Body::None;
    };

    let mode = body
        .mode
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();

    if mode == "raw" {
        let raw_text = body.raw.clone().unwrap_or_default();
        let language = body
            .options
            .as_ref()
            .and_then(|options| options.raw.as_ref())
            .and_then(|raw| raw.language.as_ref())
            .map(|value| value.to_ascii_lowercase());
        let header_content_type = content_type_header.unwrap_or("").to_ascii_lowercase();
        let parsed_json = serde_json::from_str::<serde_json::Value>(&raw_text).ok();

        let looks_json = language.as_deref() == Some("json")
            || header_content_type.contains("application/json")
            || header_content_type.contains("+json")
            || parsed_json.is_some();

        if looks_json {
            if let Some(parsed) = parsed_json {
                return Body::Json {
                    value: parsed,
                    text: String::new(),
                };
            }
            warnings.push(format!(
                "Request '{}' raw body marked as JSON but could not be parsed, imported as raw text",
                request_name
            ));
        }

        let content_type = if header_content_type.is_empty() {
            if looks_json {
                "application/json".to_string()
            } else {
                "text/plain".to_string()
            }
        } else {
            content_type_header.unwrap_or("text/plain").to_string()
        };

        return Body::Raw {
            content_type,
            text: raw_text,
        };
    }

    if mode == "urlencoded" {
        let fields = body
            .urlencoded
            .iter()
            .filter(|entry| entry.disabled.unwrap_or(false) == false)
            .filter_map(|entry| {
                let key = entry.key.as_ref()?.trim().to_string();
                if key.is_empty() {
                    return None;
                }
                Some(KeyValue {
                    key,
                    value: json_value_to_string(entry.value.as_ref()),
                })
            })
            .collect::<Vec<_>>();
        return Body::Form { fields };
    }

    if mode == "formdata" {
        let mut fields = vec![];
        for entry in &body.formdata {
            if entry.disabled.unwrap_or(false) {
                continue;
            }

            let key = entry
                .key
                .as_ref()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty());
            let Some(key) = key else {
                continue;
            };

            let field_type = entry
                .field_type
                .as_ref()
                .map(|value| value.trim().to_ascii_lowercase())
                .unwrap_or_else(|| "text".to_string());
            if field_type == "file" {
                warnings.push(format!(
                    "Request '{}' contains form-data file field '{}', skipped for MVP import",
                    request_name, key
                ));
                continue;
            }

            fields.push(KeyValue {
                key,
                value: json_value_to_string(entry.value.as_ref()),
            });
        }
        return Body::Form { fields };
    }

    Body::None
}

fn map_auth(auth: Option<&PostmanAuthDto>) -> Auth {
    let Some(auth) = auth else {
        return Auth::None;
    };

    let kind = auth
        .auth_type
        .as_ref()
        .map(|value| value.trim().to_ascii_lowercase())
        .unwrap_or_default();

    if kind == "bearer" {
        let token = auth_attr_value(&auth.bearer, "token").unwrap_or_default();
        return Auth::Bearer { token };
    }

    if kind == "basic" {
        let username = auth_attr_value(&auth.basic, "username").unwrap_or_default();
        let password = auth_attr_value(&auth.basic, "password").unwrap_or_default();
        return Auth::Basic { username, password };
    }

    if kind == "apikey" {
        let key = auth_attr_value(&auth.apikey, "key").unwrap_or_default();
        let value = auth_attr_value(&auth.apikey, "value").unwrap_or_default();
        let location = match auth_attr_value(&auth.apikey, "in")
            .unwrap_or_else(|| "header".to_string())
            .to_ascii_lowercase()
            .as_str()
        {
            "query" => AuthLocation::Query,
            _ => AuthLocation::Header,
        };
        return Auth::ApiKey {
            key,
            value,
            location,
        };
    }

    Auth::None
}

fn map_collection_variables(variables: &[PostmanVariableDto]) -> Vec<EnvironmentVariable> {
    variables
        .iter()
        .filter(|entry| entry.disabled.unwrap_or(false) == false)
        .filter_map(|entry| {
            let key = entry
                .key
                .as_ref()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())?;
            Some(EnvironmentVariable {
                key,
                value: json_value_to_string(entry.value.as_ref()),
            })
        })
        .collect()
}

fn auth_attr_value(attrs: &[PostmanAuthAttributeDto], key: &str) -> Option<String> {
    attrs.iter().find_map(|entry| {
        let attr_key = entry.key.as_ref()?.trim().to_ascii_lowercase();
        if attr_key != key.to_ascii_lowercase() {
            return None;
        }
        Some(json_value_to_string(entry.value.as_ref()))
    })
}

fn map_scripts(events: &[PostmanEventDto]) -> RequestScripts {
    let mut pre_request_parts = vec![];
    let mut post_response_parts = vec![];

    for event in events {
        if event.disabled.unwrap_or(false) {
            continue;
        }

        let listen = event
            .listen
            .as_ref()
            .map(|value| value.trim().to_ascii_lowercase())
            .unwrap_or_default();
        let script_text = event
            .script
            .as_ref()
            .and_then(script_exec_to_text)
            .unwrap_or_default();
        if script_text.trim().is_empty() {
            continue;
        }

        if listen == "test" {
            post_response_parts.push(script_text);
            continue;
        }
        if listen == "prerequest" {
            pre_request_parts.push(script_text);
        }
    }

    RequestScripts {
        pre_request: pre_request_parts.join("\n\n"),
        post_response: post_response_parts.join("\n\n"),
    }
}

fn script_exec_to_text(script: &PostmanScriptDto) -> Option<String> {
    let exec = script.exec.as_ref()?;
    match exec {
        PostmanScriptExecDto::Single(text) => Some(text.clone()),
        PostmanScriptExecDto::Lines(lines) => Some(lines.join("\n")),
    }
}

fn json_value_to_string(value: Option<&serde_json::Value>) -> String {
    match value {
        None => "".to_string(),
        Some(serde_json::Value::Null) => "".to_string(),
        Some(serde_json::Value::String(text)) => text.clone(),
        Some(other) => other.to_string(),
    }
}

fn join_value_segments(value: &serde_json::Value, separator: &str) -> String {
    if let Some(text) = value.as_str() {
        return text.to_string();
    }

    if let Some(parts) = value.as_array() {
        let mut out = vec![];
        for part in parts {
            if let Some(text) = part.as_str() {
                out.push(text.to_string());
            } else if !part.is_null() {
                out.push(part.to_string());
            }
        }
        return out.join(separator);
    }

    String::new()
}

pub fn flatten_request_order(items: &[CollectionNode]) -> Vec<String> {
    let mut out = vec![];
    flatten_request_order_recursive(items, &mut out);
    out
}

fn flatten_request_order_recursive(items: &[CollectionNode], out: &mut Vec<String>) {
    for item in items {
        match item {
            CollectionNode::RequestRef { request_id } => out.push(request_id.clone()),
            CollectionNode::Folder { children, .. } => {
                flatten_request_order_recursive(children, out)
            }
        }
    }
}
