use serde::{Deserialize, Serialize};

fn default_true() -> bool {
    true
}

fn default_request_timeout_ms() -> u64 {
    60_000
}

fn default_autosave_interval_ms() -> u64 {
    300
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppSettings {
    #[serde(default)]
    pub general: GeneralSettings,
    #[serde(default)]
    pub proxy: ProxySettings,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GeneralSettings {
    #[serde(default)]
    pub requests: RequestBehaviorSettings,
    #[serde(default)]
    pub security: SecuritySettings,
    #[serde(default)]
    pub storage: StorageSettings,
    #[serde(default)]
    pub application: ApplicationBehaviorSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestBehaviorSettings {
    #[serde(default = "default_request_timeout_ms")]
    pub request_timeout_ms: u64,
}

impl Default for RequestBehaviorSettings {
    fn default() -> Self {
        Self {
            request_timeout_ms: default_request_timeout_ms(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecuritySettings {
    #[serde(default = "default_true")]
    pub verify_tls_certificates: bool,
}

impl Default for SecuritySettings {
    fn default() -> Self {
        Self {
            verify_tls_certificates: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageSettings {
    #[serde(default = "default_true")]
    pub enable_autosave: bool,
    #[serde(default = "default_autosave_interval_ms")]
    pub autosave_interval_ms: u64,
}

impl Default for StorageSettings {
    fn default() -> Self {
        Self {
            enable_autosave: true,
            autosave_interval_ms: default_autosave_interval_ms(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplicationBehaviorSettings {
    #[serde(default = "default_true")]
    pub restore_opened_requests_on_startup: bool,
    #[serde(default = "default_true")]
    pub restore_last_workspace_on_startup: bool,
}

impl Default for ApplicationBehaviorSettings {
    fn default() -> Self {
        Self {
            restore_opened_requests_on_startup: true,
            restore_last_workspace_on_startup: true,
        }
    }
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
    #[serde(default)]
    pub diagnostics: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyEnvironmentVariableSnapshot {
    pub key: String,
    pub value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MacOsSystemProxyDiagnostics {
    #[serde(default)]
    pub supported: bool,
    #[serde(default)]
    pub http_enabled: bool,
    pub http_proxy: Option<String>,
    pub http_port: Option<i32>,
    #[serde(default)]
    pub https_enabled: bool,
    pub https_proxy: Option<String>,
    pub https_port: Option<i32>,
    #[serde(default)]
    pub socks_enabled: bool,
    pub socks_proxy: Option<String>,
    pub socks_port: Option<i32>,
    #[serde(default)]
    pub pac_enabled: bool,
    pub pac_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyDiagnosticsResolution {
    pub configured_mode: String,
    pub detected_source: String,
    pub effective_proxy: Option<String>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyDiagnosticsInfo {
    pub target_url: String,
    #[serde(default)]
    pub environment_variables: Vec<ProxyEnvironmentVariableSnapshot>,
    #[serde(default)]
    pub macos_system_configuration: MacOsSystemProxyDiagnostics,
    pub resolution: ProxyDiagnosticsResolution,
}
