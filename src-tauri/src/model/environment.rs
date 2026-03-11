use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EnvironmentVariable {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Environment {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub variables: Vec<EnvironmentVariable>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct EnvironmentsIndex {
    #[serde(default)]
    pub active_environment_id: Option<String>,
    #[serde(default)]
    pub order: Vec<String>,
}
