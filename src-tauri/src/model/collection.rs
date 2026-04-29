use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct KeyValue {
    pub key: String,
    pub value: String,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum HttpMethod {
    Get,
    Post,
    Put,
    Patch,
    Delete,
    Head,
    Options,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Body {
    None,
    Raw {
        content_type: String,
        text: String,
    },
    Json {
        value: serde_json::Value,
        #[serde(default)]
        text: String,
    },
    Form {
        fields: Vec<KeyValue>,
    },
    Multipart {
        fields: Vec<MultipartField>,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum MultipartField {
    Text {
        id: String,
        #[serde(default = "default_true")]
        enabled: bool,
        name: String,
        value: String,
    },
    File {
        id: String,
        #[serde(default = "default_true")]
        enabled: bool,
        name: String,
        file_path: String,
        #[serde(default)]
        file_name: Option<String>,
        #[serde(default)]
        mime_type: Option<String>,
        #[serde(default)]
        size: Option<u64>,
    },
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Auth {
    #[default]
    None,
    Bearer {
        token: String,
    },
    Basic {
        username: String,
        password: String,
    },
    ApiKey {
        key: String,
        value: String,
        #[serde(rename = "in")]
        location: AuthLocation,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum AuthLocation {
    Header,
    Query,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "from", rename_all = "snake_case")]
pub enum ResponseExtractorRule {
    JsonBody {
        #[serde(default)]
        id: String,
        variable: String,
        path: String,
    },
    Header {
        #[serde(default)]
        id: String,
        variable: String,
        header: String,
    },
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct RequestScripts {
    #[serde(default)]
    pub pre_request: String,
    #[serde(default)]
    pub post_response: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Request {
    pub id: String,
    pub name: String,
    pub method: HttpMethod,
    pub url: String,
    pub headers: Vec<KeyValue>,
    pub query: Vec<KeyValue>,
    pub body: Body,
    #[serde(default)]
    pub auth: Auth,
    #[serde(default)]
    pub extractors: Vec<ResponseExtractorRule>,
    #[serde(default)]
    pub scripts: RequestScripts,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CollectionNode {
    Folder {
        id: String,
        name: String,
        #[serde(default)]
        children: Vec<CollectionNode>,
    },
    RequestRef {
        request_id: String,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CollectionMeta {
    pub version: u32,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub request_order: Vec<String>,
    #[serde(default)]
    pub items: Vec<CollectionNode>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CollectionLoaded {
    pub meta: CollectionMeta,
    pub requests: Vec<Request>,
}
