use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct KeyValue {
  pub key: String,
  pub value: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HttpMethod {
  Get, Post, Put, Patch, Delete, Head, Options,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Body {
  None,
  Raw { content_type: String, text: String },
  Json { value: serde_json::Value },
  Form { fields: Vec<KeyValue> },
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Request {
  pub id: String,
  pub name: String,
  pub method: HttpMethod,
  pub url: String,
  pub headers: Vec<KeyValue>,
  pub query: Vec<KeyValue>,
  pub body: Body,
}




#[derive(Debug, Serialize, Deserialize)]
pub struct CollectionMeta {
  pub version: u32,
  pub id: String,
  pub name: String,
  #[serde(default)]
  pub request_order: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CollectionLoaded {
  pub meta: CollectionMeta,
  pub requests: Vec<Request>,
}