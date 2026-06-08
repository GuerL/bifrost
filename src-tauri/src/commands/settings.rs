use std::collections::HashSet;
use std::env;

use proxy_cfg::ProxyConfig;
use reqwest::{Proxy, Url};
use serde::Serialize;
use tauri::AppHandle;

use crate::model::settings::{
    AppSettings, CustomProxySettings, ProxyResolutionInfo, ProxyResolutionMode, ProxySettings,
};
use crate::storage::paths::{app_settings_path, read_json, write_json};

#[derive(Clone)]
struct ProxyCandidate {
    config: ProxyConfig,
    auth: Option<(String, String)>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProxyBuilderMode {
    Direct,
    Explicit,
}

#[derive(Clone, Copy)]
enum ConfiguredProxySource {
    Direct,
    System,
    Environment,
    Custom,
}

#[derive(Clone)]
pub(crate) struct ResolvedProxyTransport {
    pub info: ProxyResolutionInfo,
    proxy_config: Option<ProxyConfig>,
    auth: Option<(String, String)>,
    builder_mode: ProxyBuilderMode,
    credentials_configured: bool,
}

struct EnvironmentProxySource {
    config: Option<ProxyConfig>,
    detected_variable_names: Vec<&'static str>,
}

#[derive(Serialize)]
pub struct AboutRuntimeInfo {
    version: String,
    architecture: String,
    platform: String,
    runtime: String,
}

impl ResolvedProxyTransport {
    fn direct(detail: Option<String>) -> Self {
        Self {
            info: ProxyResolutionInfo {
                mode: ProxyResolutionMode::Direct,
                summary: "Direct connection".to_string(),
                proxy_url: None,
                detail,
                diagnostics: vec![],
            },
            proxy_config: None,
            auth: None,
            builder_mode: ProxyBuilderMode::Direct,
            credentials_configured: false,
        }
    }
}

#[tauri::command]
pub fn load_app_settings(app: AppHandle) -> Result<AppSettings, String> {
    load_app_settings_value(&app)
}

#[tauri::command]
pub fn save_app_settings(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    save_app_settings_value(&app, &settings)
}

#[tauri::command]
pub fn get_about_runtime_info(app: AppHandle) -> AboutRuntimeInfo {
    AboutRuntimeInfo {
        version: app.package_info().version.to_string(),
        architecture: display_architecture_name(env::consts::ARCH).to_string(),
        platform: display_platform_name(env::consts::OS).to_string(),
        runtime: "Tauri".to_string(),
    }
}

#[tauri::command]
pub fn resolve_proxy_transport(
    app: AppHandle,
    url: String,
    proxy_settings_override: Option<ProxySettings>,
) -> Result<ProxyResolutionInfo, String> {
    let parsed_url = Url::parse(&url).map_err(|error| format!("Invalid URL: {error}"))?;
    Ok(resolve_effective_proxy_transport(&app, &parsed_url, proxy_settings_override)?.info)
}

pub(crate) fn load_app_settings_value(app: &AppHandle) -> Result<AppSettings, String> {
    let path = app_settings_path(app)?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    read_json(&path)
}

pub(crate) fn save_app_settings_value(
    app: &AppHandle,
    settings: &AppSettings,
) -> Result<(), String> {
    let path = app_settings_path(app)?;
    write_json(&path, settings)
}

pub(crate) fn build_reqwest_proxy(
    resolved_proxy: &ResolvedProxyTransport,
) -> Result<Option<Proxy>, String> {
    let Some(proxy_config) = resolved_proxy.proxy_config.clone() else {
        return Ok(None);
    };

    let mut proxy = Proxy::custom(move |url| proxy_url_for_target(&proxy_config, url));
    if let Some((username, password)) = &resolved_proxy.auth {
        proxy = proxy.basic_auth(username, password);
    }

    Ok(Some(proxy))
}

pub(crate) fn apply_reqwest_proxy_configuration(
    builder: reqwest::ClientBuilder,
    resolved_proxy: &ResolvedProxyTransport,
) -> Result<reqwest::ClientBuilder, String> {
    match resolved_proxy.builder_mode {
        ProxyBuilderMode::Direct => Ok(builder.no_proxy()),
        ProxyBuilderMode::Explicit => {
            let Some(proxy) = build_reqwest_proxy(resolved_proxy)? else {
                return Ok(builder.no_proxy());
            };
            Ok(builder.proxy(proxy))
        }
    }
}

pub(crate) fn resolve_effective_proxy_transport(
    app: &AppHandle,
    url: &Url,
    proxy_settings_override: Option<ProxySettings>,
) -> Result<ResolvedProxyTransport, String> {
    let proxy_settings = proxy_settings_override.unwrap_or(load_app_settings_value(app)?.proxy);
    let configured_source = configured_proxy_source_from_settings(&proxy_settings);
    let system_proxy = if proxy_settings.use_system_proxy {
        load_system_proxy_config()?
    } else {
        None
    };
    let environment_proxy_source = if proxy_settings.respect_environment_variables {
        load_environment_proxy_source_from_process()
    } else {
        EnvironmentProxySource {
            config: None,
            detected_variable_names: vec![],
        }
    };

    let mut resolved = resolve_proxy_from_sources(
        url,
        &proxy_settings,
        system_proxy.as_ref(),
        environment_proxy_source.config.as_ref(),
    )?;
    resolved.info.diagnostics = build_proxy_diagnostics(
        configured_source,
        &resolved,
        system_proxy.as_ref(),
        proxy_settings.respect_environment_variables,
        &environment_proxy_source,
    );
    Ok(resolved)
}

fn resolve_proxy_from_sources(
    url: &Url,
    proxy_settings: &ProxySettings,
    system_proxy: Option<&ProxyConfig>,
    environment_proxy: Option<&ProxyConfig>,
) -> Result<ResolvedProxyTransport, String> {
    if proxy_settings.use_custom_proxy {
        if let Some(candidate) = build_custom_proxy_candidate(&proxy_settings.custom)? {
            if let Some(resolved) = resolve_candidate(url, ProxyResolutionMode::Custom, candidate)?
            {
                return Ok(resolved);
            }
        }
    }

    if let Some(candidate) = system_proxy
        .cloned()
        .map(|config| ProxyCandidate { config, auth: None })
    {
        if let Some(resolved) = resolve_candidate(url, ProxyResolutionMode::System, candidate)? {
            return Ok(resolved);
        }
    }

    if let Some(candidate) = environment_proxy
        .cloned()
        .map(|config| ProxyCandidate { config, auth: None })
    {
        if let Some(resolved) = resolve_candidate(url, ProxyResolutionMode::Environment, candidate)?
        {
            return Ok(resolved);
        }
    }

    let fallback_detail = match configured_proxy_source_from_settings(proxy_settings) {
        ConfiguredProxySource::Custom => {
            Some("No custom proxy endpoint matched this request. Falling back to a direct connection.".to_string())
        }
        ConfiguredProxySource::System => Some(format!(
            "No supported system proxy configuration matched this request on {}. Falling back to a direct connection.",
            system_proxy_backend_label()
        )),
        ConfiguredProxySource::Environment => Some(
            "No supported HTTP_PROXY / HTTPS_PROXY / ALL_PROXY configuration was detected in the current process. Falling back to a direct connection.".to_string(),
        ),
        ConfiguredProxySource::Direct => None,
    };

    Ok(ResolvedProxyTransport::direct(fallback_detail))
}

fn configured_proxy_source_from_settings(proxy_settings: &ProxySettings) -> ConfiguredProxySource {
    if proxy_settings.use_custom_proxy {
        return ConfiguredProxySource::Custom;
    }
    if proxy_settings.use_system_proxy {
        return ConfiguredProxySource::System;
    }
    if proxy_settings.respect_environment_variables {
        return ConfiguredProxySource::Environment;
    }
    ConfiguredProxySource::Direct
}

fn configured_proxy_source_label(source: ConfiguredProxySource) -> &'static str {
    match source {
        ConfiguredProxySource::Direct => "direct connection",
        ConfiguredProxySource::System => "system proxy",
        ConfiguredProxySource::Environment => "environment variables",
        ConfiguredProxySource::Custom => "custom proxy",
    }
}

fn builder_mode_label(mode: ProxyBuilderMode) -> &'static str {
    match mode {
        ProxyBuilderMode::Direct => "direct via reqwest no_proxy()",
        ProxyBuilderMode::Explicit => "explicit reqwest proxy configuration",
    }
}

fn build_profile_label() -> &'static str {
    if cfg!(debug_assertions) {
        "debug"
    } else {
        "release"
    }
}

fn system_proxy_backend_label() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        return "macOS System Configuration";
    }
    #[cfg(windows)]
    {
        return "Windows WinINet / WinHTTP";
    }
    #[cfg(target_os = "linux")]
    {
        return "Linux environment / /etc/sysconfig/proxy";
    }
    #[allow(unreachable_code)]
    "OS proxy configuration"
}

fn system_proxy_limitation_note() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        return "Only manual HTTP/HTTPS system proxies are supported. PAC and auto-discovery are not supported yet.";
    }
    #[cfg(windows)]
    {
        return "Manual WinINet or WinHTTP proxies are supported. PAC and WPAD are not supported yet.";
    }
    #[cfg(target_os = "linux")]
    {
        return "Linux system proxy detection is limited to environment variables and /etc/sysconfig/proxy.";
    }
    #[allow(unreachable_code)]
    "Proxy support depends on platform-specific configuration.";
}

fn environment_variable_process_note() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        return "macOS packaged GUI apps often do not inherit shell proxy environment variables.";
    }
    #[cfg(windows)]
    {
        return "Windows packaged GUI apps only see environment variables available to the launched process.";
    }
    #[cfg(target_os = "linux")]
    {
        return "Environment proxy variables depend on how the application process is launched.";
    }
    #[allow(unreachable_code)]
    "Environment proxy variables depend on the current process environment.";
}

fn build_proxy_diagnostics(
    configured_source: ConfiguredProxySource,
    resolved: &ResolvedProxyTransport,
    system_proxy: Option<&ProxyConfig>,
    respect_environment_variables: bool,
    environment_proxy_source: &EnvironmentProxySource,
) -> Vec<String> {
    let mut diagnostics = vec![
        format!(
            "Configured source: {}",
            configured_proxy_source_label(configured_source)
        ),
        format!(
            "Effective source: {}",
            summary_for_mode(&resolved.info.mode)
        ),
        format!(
            "Reqwest strategy: {}",
            builder_mode_label(resolved.builder_mode)
        ),
    ];

    if matches!(configured_source, ConfiguredProxySource::System) {
        let status = if system_proxy.is_some() {
            format!("detected via {}", system_proxy_backend_label())
        } else {
            format!("not detected via {}", system_proxy_backend_label())
        };
        diagnostics.push(format!("System proxy detection: {status}"));
        diagnostics.push(format!(
            "System proxy limitations: {}",
            system_proxy_limitation_note()
        ));
    }

    if matches!(configured_source, ConfiguredProxySource::Environment)
        || respect_environment_variables
    {
        if environment_proxy_source.detected_variable_names.is_empty() {
            diagnostics.push("Environment variables detected: none".to_string());
            diagnostics.push(format!(
                "Environment note: {}",
                environment_variable_process_note()
            ));
        } else {
            diagnostics.push(format!(
                "Environment variables detected: {}",
                environment_proxy_source.detected_variable_names.join(", ")
            ));
        }
    }

    if resolved.credentials_configured {
        diagnostics.push("Proxy credentials: configured (hidden)".to_string());
    }

    diagnostics.push(format!("Build profile: {}", build_profile_label()));

    diagnostics
}

fn display_platform_name(value: &str) -> &str {
    match value {
        "macos" => "macOS",
        "windows" => "Windows",
        "linux" => "Linux",
        other => other,
    }
}

fn display_architecture_name(value: &str) -> &str {
    match value {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        "x86" => "x86",
        "arm" => "arm",
        other => other,
    }
}

fn resolve_candidate(
    url: &Url,
    mode: ProxyResolutionMode,
    candidate: ProxyCandidate,
) -> Result<Option<ResolvedProxyTransport>, String> {
    let Some(config) = normalize_proxy_config(candidate.config)? else {
        return Ok(None);
    };

    let scheme_has_proxy =
        config.proxies.contains_key(url.scheme()) || config.proxies.contains_key("*");
    if !scheme_has_proxy {
        return Ok(None);
    }

    let Some(proxy_address) = proxy_url_for_target(&config, url) else {
        return Ok(Some(ResolvedProxyTransport::direct(Some(format!(
            "Bypassed by {} proxy rules.",
            source_name_for_mode(&mode)
        )))));
    };

    let normalized_endpoint = normalize_proxy_endpoint(&proxy_address)?;
    let credentials_configured =
        normalized_endpoint.contains_credentials || candidate.auth.is_some();

    Ok(Some(ResolvedProxyTransport {
        info: ProxyResolutionInfo {
            mode: mode.clone(),
            summary: summary_for_mode(&mode).to_string(),
            proxy_url: Some(normalized_endpoint.display),
            detail: None,
            diagnostics: vec![],
        },
        proxy_config: Some(config),
        auth: candidate.auth,
        builder_mode: ProxyBuilderMode::Explicit,
        credentials_configured,
    }))
}

fn build_custom_proxy_candidate(
    settings: &CustomProxySettings,
) -> Result<Option<ProxyCandidate>, String> {
    if !settings.http_enabled && !settings.https_enabled {
        return Err(
            "Custom proxy is enabled, but no proxy type is selected. Enable HTTP and/or HTTPS."
                .to_string(),
        );
    }

    let host = settings.host.trim();
    if host.is_empty() {
        return Err("Custom proxy is enabled, but the proxy host is empty.".to_string());
    }

    let port = settings.port.trim();
    if port.is_empty() {
        return Err("Custom proxy is enabled, but the proxy port is empty.".to_string());
    }

    let parsed_port = port
        .parse::<u16>()
        .map_err(|_| "Custom proxy port must be a valid number between 1 and 65535.".to_string())?;
    let normalized_proxy = normalize_proxy_endpoint(&format!("{host}:{parsed_port}"))?;

    let mut config = ProxyConfig::default();
    if settings.http_enabled {
        config
            .proxies
            .insert("http".to_string(), normalized_proxy.url.clone());
    }
    if settings.https_enabled {
        config
            .proxies
            .insert("https".to_string(), normalized_proxy.url.clone());
    }

    let (whitelist, exclude_simple) = parse_bypass_list(&settings.bypass_list);
    config.whitelist = whitelist;
    config.exclude_simple = exclude_simple;

    let auth = if settings.requires_authentication {
        let username = settings.username.trim().to_string();
        if username.is_empty() {
            return Err(
                "Custom proxy authentication is enabled, but the username is empty.".to_string(),
            );
        }
        Some((username, settings.password.clone()))
    } else {
        None
    };

    Ok(Some(ProxyCandidate { config, auth }))
}

#[cfg(target_os = "linux")]
fn load_environment_proxy_config_from_process() -> Option<ProxyConfig> {
    build_environment_proxy_config(env::vars()).config
}

fn load_environment_proxy_source_from_process() -> EnvironmentProxySource {
    build_environment_proxy_config(env::vars())
}

fn build_environment_proxy_config<I>(pairs: I) -> EnvironmentProxySource
where
    I: IntoIterator<Item = (String, String)>,
{
    let mut config = ProxyConfig::default();
    let mut detected_variable_names: Vec<&'static str> = Vec::new();

    for (raw_key, raw_value) in pairs {
        let key = raw_key.to_ascii_lowercase();
        let value = raw_value.trim();
        if value.is_empty() {
            continue;
        }

        match key.as_str() {
            "http_proxy" => {
                config.proxies.insert("http".to_string(), value.to_string());
                if !detected_variable_names.contains(&"HTTP_PROXY") {
                    detected_variable_names.push("HTTP_PROXY");
                }
            }
            "https_proxy" => {
                config
                    .proxies
                    .insert("https".to_string(), value.to_string());
                if !detected_variable_names.contains(&"HTTPS_PROXY") {
                    detected_variable_names.push("HTTPS_PROXY");
                }
            }
            "all_proxy" => {
                config.proxies.insert("*".to_string(), value.to_string());
                if !detected_variable_names.contains(&"ALL_PROXY") {
                    detected_variable_names.push("ALL_PROXY");
                }
            }
            "no_proxy" => {
                let (whitelist, exclude_simple) = parse_bypass_list(value);
                config.whitelist.extend(whitelist);
                config.exclude_simple |= exclude_simple;
                if !detected_variable_names.contains(&"NO_PROXY") {
                    detected_variable_names.push("NO_PROXY");
                }
            }
            _ => {}
        }
    }

    if config.proxies.is_empty() {
        return EnvironmentProxySource {
            config: None,
            detected_variable_names,
        };
    }

    EnvironmentProxySource {
        config: Some(config),
        detected_variable_names,
    }
}

fn load_system_proxy_config() -> Result<Option<ProxyConfig>, String> {
    #[cfg(target_os = "linux")]
    if let Some(environment_proxy) = load_environment_proxy_config_from_process() {
        return Ok(Some(environment_proxy));
    }

    proxy_cfg::get_proxy_config().map_err(|error| error.to_string())
}

fn normalize_proxy_config(config: ProxyConfig) -> Result<Option<ProxyConfig>, String> {
    if config.proxies.is_empty() {
        return Ok(None);
    }

    let mut normalized = ProxyConfig::default();
    normalized.whitelist = config.whitelist;
    normalized.exclude_simple = config.exclude_simple;

    for (scheme, value) in config.proxies {
        let endpoint = normalize_proxy_endpoint(&value)?;
        normalized.proxies.insert(scheme, endpoint.url);
    }

    Ok(Some(normalized))
}

fn proxy_url_for_target(config: &ProxyConfig, url: &Url) -> Option<String> {
    if !config.use_proxy_for_address(url.as_str()) {
        return None;
    }

    config
        .proxies
        .get(url.scheme())
        .or_else(|| config.proxies.get("*"))
        .cloned()
}

fn parse_bypass_list(input: &str) -> (HashSet<String>, bool) {
    let mut whitelist = HashSet::new();
    let mut exclude_simple = false;

    for raw_entry in input.split(',') {
        let entry = raw_entry.trim().to_ascii_lowercase();
        if entry.is_empty() {
            continue;
        }
        if entry == "<local>" {
            exclude_simple = true;
            continue;
        }
        whitelist.insert(entry);
    }

    (whitelist, exclude_simple)
}

fn summary_for_mode(mode: &ProxyResolutionMode) -> &'static str {
    match mode {
        ProxyResolutionMode::Custom => "Using custom proxy",
        ProxyResolutionMode::System => "Using system proxy",
        ProxyResolutionMode::Environment => "Using environment proxy",
        ProxyResolutionMode::Direct => "Direct connection",
    }
}

fn source_name_for_mode(mode: &ProxyResolutionMode) -> &'static str {
    match mode {
        ProxyResolutionMode::Custom => "custom",
        ProxyResolutionMode::System => "system",
        ProxyResolutionMode::Environment => "environment",
        ProxyResolutionMode::Direct => "direct",
    }
}

#[derive(Debug)]
struct NormalizedProxyEndpoint {
    url: String,
    display: String,
    contains_credentials: bool,
}

fn normalize_proxy_endpoint(raw: &str) -> Result<NormalizedProxyEndpoint, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Proxy URL is empty.".to_string());
    }

    let candidate = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("http://{trimmed}")
    };
    let parsed = Url::parse(&candidate)
        .map_err(|error| format!("Invalid proxy URL '{trimmed}': {error}"))?;

    match parsed.scheme() {
        "http" | "https" => {}
        "socks5" | "socks5h" | "socks4" | "socks4a" => {
            return Err("SOCKS proxies are not supported yet.".to_string());
        }
        scheme => {
            return Err(format!("Unsupported proxy scheme: {scheme}."));
        }
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| "Proxy URL is missing a host.".to_string())?;
    let port = parsed
        .port_or_known_default()
        .ok_or_else(|| "Proxy URL is missing a port.".to_string())?;
    let contains_credentials = !parsed.username().is_empty() || parsed.password().is_some();

    Ok(NormalizedProxyEndpoint {
        url: parsed.to_string(),
        display: format!("{host}:{port}"),
        contains_credentials,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config_with_proxy(raw_proxy: &str) -> ProxyConfig {
        let mut config = ProxyConfig::default();
        config
            .proxies
            .insert("https".to_string(), raw_proxy.to_string());
        config
    }

    #[test]
    fn environment_proxy_config_reads_expected_variables() {
        let source = build_environment_proxy_config([
            (
                "HTTP_PROXY".to_string(),
                "http://proxy.local:8080".to_string(),
            ),
            (
                "NO_PROXY".to_string(),
                "localhost, *.company.local".to_string(),
            ),
        ]);
        let config = source.config.expect("environment proxy should exist");

        assert_eq!(
            config.proxies.get("http").map(String::as_str),
            Some("http://proxy.local:8080")
        );
        assert!(config.whitelist.contains("localhost"));
        assert!(config.whitelist.contains("*.company.local"));
        assert_eq!(
            source.detected_variable_names,
            vec!["HTTP_PROXY", "NO_PROXY"]
        );
    }

    #[test]
    fn environment_proxy_config_reads_all_proxy() {
        let source = build_environment_proxy_config([(
            "ALL_PROXY".to_string(),
            "http://shared.proxy.local:8080".to_string(),
        )]);
        let config = source.config.expect("environment proxy should exist");

        assert_eq!(
            config.proxies.get("*").map(String::as_str),
            Some("http://shared.proxy.local:8080")
        );
        assert_eq!(source.detected_variable_names, vec!["ALL_PROXY"]);
    }

    #[test]
    fn custom_proxy_takes_priority_over_other_sources() {
        let url = Url::parse("https://api.example.com/users").unwrap();
        let proxy_settings = ProxySettings {
            use_system_proxy: true,
            respect_environment_variables: true,
            use_custom_proxy: true,
            custom: CustomProxySettings {
                host: "custom.proxy.local".to_string(),
                port: "8080".to_string(),
                ..CustomProxySettings::default()
            },
        };
        let system_proxy = config_with_proxy("system.proxy.local:9000");
        let environment_proxy = config_with_proxy("http://env.proxy.local:7000");

        let resolved = resolve_proxy_from_sources(
            &url,
            &proxy_settings,
            Some(&system_proxy),
            Some(&environment_proxy),
        )
        .expect("proxy resolution should succeed");

        assert!(matches!(resolved.info.mode, ProxyResolutionMode::Custom));
        assert_eq!(resolved.builder_mode, ProxyBuilderMode::Explicit);
        assert_eq!(
            resolved.info.proxy_url.as_deref(),
            Some("custom.proxy.local:8080")
        );
    }

    #[test]
    fn direct_connection_is_used_when_proxy_is_bypassed() {
        let url = Url::parse("https://localhost/ping").unwrap();
        let proxy_settings = ProxySettings {
            use_system_proxy: false,
            respect_environment_variables: true,
            use_custom_proxy: false,
            custom: CustomProxySettings::default(),
        };
        let mut environment_proxy = config_with_proxy("http://env.proxy.local:7000");
        environment_proxy.whitelist.insert("localhost".to_string());

        let resolved =
            resolve_proxy_from_sources(&url, &proxy_settings, None, Some(&environment_proxy))
                .expect("proxy resolution should succeed");

        assert!(matches!(resolved.info.mode, ProxyResolutionMode::Direct));
        assert_eq!(resolved.builder_mode, ProxyBuilderMode::Direct);
        assert_eq!(resolved.info.proxy_url, None);
    }

    #[test]
    fn direct_mode_maps_to_reqwest_no_proxy_strategy() {
        let url = Url::parse("https://api.example.com/ping").unwrap();
        let proxy_settings = ProxySettings {
            use_system_proxy: false,
            respect_environment_variables: false,
            use_custom_proxy: false,
            custom: CustomProxySettings::default(),
        };

        let resolved = resolve_proxy_from_sources(&url, &proxy_settings, None, None)
            .expect("proxy resolution should succeed");
        let diagnostics = build_proxy_diagnostics(
            ConfiguredProxySource::Direct,
            &resolved,
            None,
            false,
            &EnvironmentProxySource {
                config: None,
                detected_variable_names: vec![],
            },
        );

        assert_eq!(resolved.builder_mode, ProxyBuilderMode::Direct);
        assert!(diagnostics
            .iter()
            .any(|line| line.contains("Reqwest strategy: direct via reqwest no_proxy()")));
    }

    #[test]
    fn custom_proxy_auth_is_hidden_in_debug_output() {
        let url = Url::parse("https://api.example.com/users").unwrap();
        let proxy_settings = ProxySettings {
            use_system_proxy: false,
            respect_environment_variables: false,
            use_custom_proxy: true,
            custom: CustomProxySettings {
                host: "custom.proxy.local".to_string(),
                port: "8080".to_string(),
                requires_authentication: true,
                username: "Alice".to_string(),
                password: "SeCrEt".to_string(),
                ..CustomProxySettings::default()
            },
        };

        let resolved = resolve_proxy_from_sources(&url, &proxy_settings, None, None)
            .expect("proxy resolution should succeed");
        let diagnostics = build_proxy_diagnostics(
            ConfiguredProxySource::Custom,
            &resolved,
            None,
            false,
            &EnvironmentProxySource {
                config: None,
                detected_variable_names: vec![],
            },
        );

        assert_eq!(
            resolved.info.proxy_url.as_deref(),
            Some("custom.proxy.local:8080")
        );
        assert!(resolved.credentials_configured);
        assert!(diagnostics
            .iter()
            .any(|line| line == "Proxy credentials: configured (hidden)"));
        assert!(!diagnostics.join("\n").contains("SeCrEt"));
        assert!(!diagnostics.join("\n").contains("Alice"));
    }

    #[test]
    fn environment_only_mode_reports_detected_process_variables() {
        let url = Url::parse("https://api.example.com/ping").unwrap();
        let proxy_settings = ProxySettings {
            use_system_proxy: false,
            respect_environment_variables: true,
            use_custom_proxy: false,
            custom: CustomProxySettings::default(),
        };
        let environment_source = build_environment_proxy_config([
            (
                "HTTPS_PROXY".to_string(),
                "http://env.proxy.local:9000".to_string(),
            ),
            ("NO_PROXY".to_string(), "localhost".to_string()),
        ]);
        let resolved = resolve_proxy_from_sources(
            &url,
            &proxy_settings,
            None,
            environment_source.config.as_ref(),
        )
        .expect("proxy resolution should succeed");
        let diagnostics = build_proxy_diagnostics(
            ConfiguredProxySource::Environment,
            &resolved,
            None,
            true,
            &environment_source,
        );

        assert!(matches!(
            resolved.info.mode,
            ProxyResolutionMode::Environment
        ));
        assert_eq!(resolved.builder_mode, ProxyBuilderMode::Explicit);
        assert!(diagnostics
            .iter()
            .any(|line| line.contains("Environment variables detected: HTTPS_PROXY, NO_PROXY")));
    }

    #[test]
    fn socks_proxy_is_rejected_for_now() {
        let error = normalize_proxy_endpoint("socks5://proxy.local:1080")
            .expect_err("socks should be rejected");
        assert!(error.contains("SOCKS"));
    }
}
