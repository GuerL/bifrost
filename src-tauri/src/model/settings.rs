use serde::{Deserialize, Serialize};

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppSettings {
    #[serde(default)]
    pub proxy: ProxySettings,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProxySettings {
    #[serde(default)]
    pub use_system_proxy: bool,
    #[serde(default)]
    pub respect_environment_variables: bool,
    #[serde(default)]
    pub use_custom_proxy: bool,
    #[serde(default)]
    pub custom: CustomProxySettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomProxySettings {
    #[serde(default = "default_true")]
    pub http_enabled: bool,
    #[serde(default = "default_true")]
    pub https_enabled: bool,
    #[serde(default)]
    pub host: String,
    #[serde(default)]
    pub port: String,
    #[serde(default)]
    pub requires_authentication: bool,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub bypass_list: String,
}

impl Default for CustomProxySettings {
    fn default() -> Self {
        Self {
            http_enabled: true,
            https_enabled: true,
            host: String::new(),
            port: String::new(),
            requires_authentication: false,
            username: String::new(),
            password: String::new(),
            bypass_list: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProxyResolutionMode {
    Custom,
    System,
    Environment,
    Direct,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyResolutionInfo {
    pub mode: ProxyResolutionMode,
    pub summary: String,
    pub proxy_url: Option<String>,
    pub detail: Option<String>,
}
