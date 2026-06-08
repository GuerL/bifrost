use std::collections::HashSet;
use std::env;
#[cfg(target_os = "macos")]
use std::process::Command;
#[cfg(target_os = "macos")]
use std::ptr;

use proxy_cfg::ProxyConfig;
use reqwest::{Proxy, Url};
use serde::Serialize;
use tauri::AppHandle;

#[cfg(target_os = "macos")]
use core_foundation::base::{CFType, TCFType};
#[cfg(target_os = "macos")]
use core_foundation::dictionary::CFDictionary;
#[cfg(target_os = "macos")]
use core_foundation::number::CFNumber;
#[cfg(target_os = "macos")]
use core_foundation::string::CFString;
#[cfg(target_os = "macos")]
use system_configuration_sys::dynamic_store_copy_specific;

use crate::model::settings::{
    AppSettings, CustomProxySettings, MacOsSystemProxyDiagnostics, ManualEnvironmentProxySettings,
    ProxyDiagnosticsInfo, ProxyDiagnosticsResolution, ProxyEnvironmentVariableSnapshot,
    ProxyResolutionInfo, ProxyResolutionMode, ProxySettings,
};
use crate::storage::paths::{app_settings_path, read_json, write_json};

const ENV_PROXY_VARIABLE_NAMES: [&str; 8] = [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
];
const STARTUP_PROXY_DIAGNOSTIC_SAMPLE_URL: &str = "https://example.com/";

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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum EnvironmentProxyOrigin {
    Process,
    Manual,
}

#[derive(Clone)]
pub(crate) struct ResolvedProxyTransport {
    pub info: ProxyResolutionInfo,
    proxy_config: Option<ProxyConfig>,
    auth: Option<(String, String)>,
    builder_mode: ProxyBuilderMode,
    credentials_configured: bool,
    environment_origin: Option<EnvironmentProxyOrigin>,
}

struct EnvironmentProxySource {
    config: Option<ProxyConfig>,
    detected_variable_names: Vec<&'static str>,
    origin: Option<EnvironmentProxyOrigin>,
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
            environment_origin: None,
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

#[tauri::command]
pub fn get_proxy_diagnostics(
    app: AppHandle,
    url: String,
    proxy_settings_override: Option<ProxySettings>,
) -> Result<ProxyDiagnosticsInfo, String> {
    let parsed_url = Url::parse(&url).map_err(|error| format!("Invalid URL: {error}"))?;
    build_proxy_diagnostics_report(&app, &parsed_url, proxy_settings_override)
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

pub(crate) fn log_startup_proxy_diagnostics(app: &AppHandle) {
    let sample_url = match Url::parse(STARTUP_PROXY_DIAGNOSTIC_SAMPLE_URL) {
        Ok(url) => url,
        Err(error) => {
            eprintln!("[proxy-debug] failed_to_parse_sample_url={error}");
            return;
        }
    };

    match build_proxy_diagnostics_report(app, &sample_url, None) {
        Ok(report) => {
            for line in format_proxy_diagnostics_log_lines(&report) {
                eprintln!("[proxy-debug] {line}");
            }
        }
        Err(error) => {
            eprintln!("[proxy-debug] failed_to_collect={error}");
        }
    }
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
        load_environment_proxy_source(&proxy_settings)
    } else {
        EnvironmentProxySource {
            config: None,
            detected_variable_names: vec![],
            origin: None,
        }
    };

    let mut resolved = resolve_proxy_from_sources(
        url,
        &proxy_settings,
        system_proxy.as_ref(),
        environment_proxy_source.config.as_ref(),
    )?;
    if matches!(resolved.info.mode, ProxyResolutionMode::Environment) {
        resolved.environment_origin = environment_proxy_source.origin;
    }
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

fn configured_proxy_source_display_label(source: ConfiguredProxySource) -> &'static str {
    match source {
        ConfiguredProxySource::Direct => "Direct Connection",
        ConfiguredProxySource::System => "System Proxy",
        ConfiguredProxySource::Environment => "Environment Variables",
        ConfiguredProxySource::Custom => "Custom Proxy",
    }
}

fn environment_origin_label(origin: EnvironmentProxyOrigin) -> &'static str {
    match origin {
        EnvironmentProxyOrigin::Process => "process environment variables",
        EnvironmentProxyOrigin::Manual => "manual environment proxy values",
    }
}

fn environment_origin_display_label(origin: EnvironmentProxyOrigin) -> &'static str {
    match origin {
        EnvironmentProxyOrigin::Process => "Environment Variables",
        EnvironmentProxyOrigin::Manual => "Manual Environment Values",
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

fn build_proxy_diagnostics_report(
    app: &AppHandle,
    url: &Url,
    proxy_settings_override: Option<ProxySettings>,
) -> Result<ProxyDiagnosticsInfo, String> {
    let proxy_settings = proxy_settings_override.unwrap_or(load_app_settings_value(app)?.proxy);
    let configured_source = configured_proxy_source_from_settings(&proxy_settings);
    let resolved = resolve_effective_proxy_transport(app, url, Some(proxy_settings.clone()))?;
    let macos_system_configuration = load_macos_system_proxy_diagnostics()?;
    let process_environment_variables = capture_proxy_environment_variable_snapshots_from_process();
    let launchctl_environment_variables =
        capture_proxy_environment_variable_snapshots_from_launchctl();
    let login_shell_environment_variables =
        capture_proxy_environment_variable_snapshots_from_login_shell();
    let visibility_warning = build_proxy_environment_visibility_warning(
        &process_environment_variables,
        &launchctl_environment_variables,
        &login_shell_environment_variables,
    );

    Ok(ProxyDiagnosticsInfo {
        target_url: url.as_str().to_string(),
        process_environment_variables,
        launchctl_environment_variables,
        login_shell_environment_variables,
        macos_system_configuration: macos_system_configuration.clone(),
        effective_environment_source: resolved
            .environment_origin
            .map(environment_origin_display_label)
            .map(str::to_string),
        visibility_warning,
        resolution: ProxyDiagnosticsResolution {
            configured_mode: configured_proxy_source_display_label(configured_source).to_string(),
            detected_source: diagnostics_detected_source_label(
                configured_source,
                &resolved,
                &macos_system_configuration,
            )
            .to_string(),
            effective_proxy: diagnostics_effective_proxy_display(url, &resolved),
            detail: resolved.info.detail.clone(),
        },
    })
}

fn diagnostics_detected_source_label(
    configured_source: ConfiguredProxySource,
    resolved: &ResolvedProxyTransport,
    macos_system_configuration: &MacOsSystemProxyDiagnostics,
) -> &'static str {
    match &resolved.info.mode {
        ProxyResolutionMode::Custom => "Custom Proxy",
        ProxyResolutionMode::System => "System Proxy",
        ProxyResolutionMode::Environment => resolved
            .environment_origin
            .map(environment_origin_display_label)
            .unwrap_or("Environment Variables"),
        ProxyResolutionMode::Direct => match configured_source {
            ConfiguredProxySource::System if macos_system_configuration.pac_enabled => "PAC",
            ConfiguredProxySource::System if macos_system_configuration.socks_enabled => "SOCKS",
            ConfiguredProxySource::System => "None Detected",
            ConfiguredProxySource::Environment => "None Detected",
            ConfiguredProxySource::Custom => "Custom Proxy",
            ConfiguredProxySource::Direct => "Direct Connection",
        },
    }
}

fn capture_proxy_environment_variable_snapshots_from_process(
) -> Vec<ProxyEnvironmentVariableSnapshot> {
    capture_proxy_environment_variable_snapshots_with(|key| {
        env::var_os(key).map(|value| value.to_string_lossy().into_owned())
    })
}

#[cfg(target_os = "macos")]
fn capture_proxy_environment_variable_snapshots_from_launchctl(
) -> Vec<ProxyEnvironmentVariableSnapshot> {
    capture_proxy_environment_variable_snapshots_with(|key| {
        let output = Command::new("/bin/launchctl")
            .args(["getenv", key])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let value = String::from_utf8_lossy(&output.stdout)
            .trim_end()
            .to_string();
        if value.is_empty() {
            None
        } else {
            Some(value)
        }
    })
}

#[cfg(not(target_os = "macos"))]
fn capture_proxy_environment_variable_snapshots_from_launchctl(
) -> Vec<ProxyEnvironmentVariableSnapshot> {
    capture_proxy_environment_variable_snapshots_with(|_| None)
}

#[cfg(target_os = "macos")]
fn capture_proxy_environment_variable_snapshots_from_login_shell(
) -> Vec<ProxyEnvironmentVariableSnapshot> {
    let script = r#"for key in HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy; do
  printf '%s=' "$key"
  printenv "$key" 2>/dev/null || true
  printf '\n'
done"#;
    let output = Command::new("/bin/zsh")
        .args(["-ilc", script])
        .output()
        .ok();
    let Some(output) = output else {
        return capture_proxy_environment_variable_snapshots_with(|_| None);
    };
    if !output.status.success() {
        return capture_proxy_environment_variable_snapshots_with(|_| None);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut values = std::collections::HashMap::new();
    for line in stdout.lines() {
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        if ENV_PROXY_VARIABLE_NAMES.contains(&key) {
            let normalized = value.trim_end_matches('\r').to_string();
            if !normalized.is_empty() {
                values.insert(key.to_string(), normalized);
            }
        }
    }

    capture_proxy_environment_variable_snapshots_with(|key| values.get(key).cloned())
}

#[cfg(not(target_os = "macos"))]
fn capture_proxy_environment_variable_snapshots_from_login_shell(
) -> Vec<ProxyEnvironmentVariableSnapshot> {
    capture_proxy_environment_variable_snapshots_with(|_| None)
}

fn build_proxy_environment_visibility_warning(
    process_snapshots: &[ProxyEnvironmentVariableSnapshot],
    launchctl_snapshots: &[ProxyEnvironmentVariableSnapshot],
    login_shell_snapshots: &[ProxyEnvironmentVariableSnapshot],
) -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        if snapshots_have_proxy_endpoint_values(login_shell_snapshots)
            && !snapshots_have_proxy_endpoint_values(process_snapshots)
            && !snapshots_have_proxy_endpoint_values(launchctl_snapshots)
        {
            return Some(
                "Proxy environment variables were found in shell but are not visible to Bifrost when launched as a macOS app.".to_string(),
            );
        }
    }

    None
}

fn capture_proxy_environment_variable_snapshots_with<F>(
    mut lookup: F,
) -> Vec<ProxyEnvironmentVariableSnapshot>
where
    F: FnMut(&str) -> Option<String>,
{
    ENV_PROXY_VARIABLE_NAMES
        .iter()
        .map(|key| ProxyEnvironmentVariableSnapshot {
            key: (*key).to_string(),
            value: lookup(key),
        })
        .collect()
}

fn diagnostics_effective_proxy_display(
    url: &Url,
    resolved: &ResolvedProxyTransport,
) -> Option<String> {
    let raw_proxy = resolved
        .proxy_config
        .as_ref()
        .and_then(|config| proxy_url_for_target(config, url));
    let Some(raw_proxy) = raw_proxy else {
        return resolved.info.proxy_url.clone();
    };

    let normalized = normalize_proxy_endpoint(&raw_proxy).ok()?;
    let Ok(mut parsed) = Url::parse(&normalized.url) else {
        return Some(normalized.url);
    };

    if !parsed.username().is_empty() {
        let _ = parsed.set_username("****");
    }
    if parsed.password().is_some() {
        let _ = parsed.set_password(Some("****"));
    }

    Some(parsed.to_string())
}

#[cfg(target_os = "macos")]
fn get_macos_string_value(
    dictionary: &CFDictionary<CFString, CFType>,
    key: &'static str,
) -> Option<String> {
    let key = CFString::from_static_string(key);
    dictionary
        .find(key)
        .and_then(|value| value.downcast::<CFString>())
        .map(|value| value.to_string())
}

#[cfg(target_os = "macos")]
fn get_macos_i32_value(
    dictionary: &CFDictionary<CFString, CFType>,
    key: &'static str,
) -> Option<i32> {
    let key = CFString::from_static_string(key);
    dictionary
        .find(key)
        .and_then(|value| value.downcast::<CFNumber>())
        .and_then(|value| value.to_i32())
}

#[cfg(target_os = "macos")]
fn load_macos_system_proxy_diagnostics() -> Result<MacOsSystemProxyDiagnostics, String> {
    let proxies_ref =
        unsafe { dynamic_store_copy_specific::SCDynamicStoreCopyProxies(ptr::null()) };
    if proxies_ref.is_null() {
        return Ok(MacOsSystemProxyDiagnostics {
            supported: true,
            ..MacOsSystemProxyDiagnostics::default()
        });
    }

    let proxies: CFDictionary<CFString, CFType> =
        unsafe { CFDictionary::wrap_under_create_rule(proxies_ref) };

    Ok(MacOsSystemProxyDiagnostics {
        supported: true,
        http_enabled: get_macos_i32_value(&proxies, "HTTPEnable").unwrap_or(0) == 1,
        http_proxy: get_macos_string_value(&proxies, "HTTPProxy"),
        http_port: get_macos_i32_value(&proxies, "HTTPPort"),
        https_enabled: get_macos_i32_value(&proxies, "HTTPSEnable").unwrap_or(0) == 1,
        https_proxy: get_macos_string_value(&proxies, "HTTPSProxy"),
        https_port: get_macos_i32_value(&proxies, "HTTPSPort"),
        socks_enabled: get_macos_i32_value(&proxies, "SOCKSEnable").unwrap_or(0) == 1,
        socks_proxy: get_macos_string_value(&proxies, "SOCKSProxy"),
        socks_port: get_macos_i32_value(&proxies, "SOCKSPort"),
        pac_enabled: get_macos_i32_value(&proxies, "ProxyAutoConfigEnable").unwrap_or(0) == 1,
        pac_url: get_macos_string_value(&proxies, "ProxyAutoConfigURLString"),
    })
}

#[cfg(not(target_os = "macos"))]
fn load_macos_system_proxy_diagnostics() -> Result<MacOsSystemProxyDiagnostics, String> {
    Ok(MacOsSystemProxyDiagnostics::default())
}

fn format_proxy_diagnostics_log_lines(report: &ProxyDiagnosticsInfo) -> Vec<String> {
    let mut lines = Vec::new();
    for entry in &report.process_environment_variables {
        lines.push(format!(
            "process_{}={}",
            entry.key,
            entry.value.as_deref().unwrap_or("<not set>")
        ));
    }
    for entry in &report.launchctl_environment_variables {
        lines.push(format!(
            "launchctl_{}={}",
            entry.key,
            entry.value.as_deref().unwrap_or("<not set>")
        ));
    }
    for entry in &report.login_shell_environment_variables {
        lines.push(format!(
            "shell_{}={}",
            entry.key,
            entry.value.as_deref().unwrap_or("<not set>")
        ));
    }

    let macos = &report.macos_system_configuration;
    lines.push(format!("system_proxy_supported={}", macos.supported));
    lines.push(format!("system_http_enabled={}", macos.http_enabled));
    lines.push(format!(
        "system_http_proxy={}",
        macos.http_proxy.as_deref().unwrap_or("<none>")
    ));
    lines.push(format!(
        "system_http_port={}",
        macos
            .http_port
            .map(|value| value.to_string())
            .unwrap_or_else(|| "<none>".to_string())
    ));
    lines.push(format!("system_https_enabled={}", macos.https_enabled));
    lines.push(format!(
        "system_https_proxy={}",
        macos.https_proxy.as_deref().unwrap_or("<none>")
    ));
    lines.push(format!(
        "system_https_port={}",
        macos
            .https_port
            .map(|value| value.to_string())
            .unwrap_or_else(|| "<none>".to_string())
    ));
    lines.push(format!("system_socks_enabled={}", macos.socks_enabled));
    lines.push(format!(
        "system_socks_proxy={}",
        macos.socks_proxy.as_deref().unwrap_or("<none>")
    ));
    lines.push(format!(
        "system_socks_port={}",
        macos
            .socks_port
            .map(|value| value.to_string())
            .unwrap_or_else(|| "<none>".to_string())
    ));
    lines.push(format!("system_pac_enabled={}", macos.pac_enabled));
    lines.push(format!(
        "system_pac_url={}",
        macos.pac_url.as_deref().unwrap_or("<none>")
    ));
    lines.push(format!("target_url={}", report.target_url));
    lines.push(format!(
        "configured_mode={}",
        report.resolution.configured_mode
    ));
    lines.push(format!(
        "detected_source={}",
        report.resolution.detected_source
    ));
    lines.push(format!(
        "effective_environment_source={}",
        report
            .effective_environment_source
            .as_deref()
            .unwrap_or("none")
    ));
    lines.push(format!(
        "effective_proxy={}",
        report
            .resolution
            .effective_proxy
            .as_deref()
            .unwrap_or("none")
    ));
    if let Some(warning) = &report.visibility_warning {
        lines.push(format!("visibility_warning={warning}"));
    }
    if let Some(detail) = &report.resolution.detail {
        lines.push(format!("detail={detail}"));
    }
    lines
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
            if let Some(origin) = environment_proxy_source.origin {
                diagnostics.push(format!(
                    "Environment source: {}",
                    environment_origin_label(origin)
                ));
            }
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
        environment_origin: None,
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
    build_environment_proxy_source_from_pairs(
        snapshots_to_pairs(&capture_proxy_environment_variable_snapshots_from_process()),
        None,
    )
    .config
}

fn load_environment_proxy_source(proxy_settings: &ProxySettings) -> EnvironmentProxySource {
    let process_snapshots = capture_proxy_environment_variable_snapshots_from_process();
    let manual_snapshots = capture_proxy_environment_variable_snapshots_from_manual_settings(
        &proxy_settings.manual_environment,
    );
    let process_has_proxy = snapshots_have_proxy_endpoint_values(&process_snapshots);
    let manual_has_proxy = snapshots_have_proxy_endpoint_values(&manual_snapshots);

    let mut merged_pairs = snapshots_to_pairs(&manual_snapshots);
    merged_pairs.extend(snapshots_to_pairs(&process_snapshots));

    let origin = if process_has_proxy {
        Some(EnvironmentProxyOrigin::Process)
    } else if manual_has_proxy {
        Some(EnvironmentProxyOrigin::Manual)
    } else {
        None
    };

    build_environment_proxy_source_from_pairs(merged_pairs, origin)
}

fn build_environment_proxy_source_from_pairs<I>(
    pairs: I,
    origin: Option<EnvironmentProxyOrigin>,
) -> EnvironmentProxySource
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
            origin: None,
        };
    }

    EnvironmentProxySource {
        config: Some(config),
        detected_variable_names,
        origin,
    }
}

fn snapshots_to_pairs(snapshots: &[ProxyEnvironmentVariableSnapshot]) -> Vec<(String, String)> {
    snapshots
        .iter()
        .filter_map(|entry| {
            entry
                .value
                .as_ref()
                .map(|value| (entry.key.clone(), value.clone()))
        })
        .collect()
}

fn snapshots_have_proxy_endpoint_values(snapshots: &[ProxyEnvironmentVariableSnapshot]) -> bool {
    snapshots.iter().any(|entry| {
        matches!(
            entry.key.as_str(),
            "HTTP_PROXY" | "HTTPS_PROXY" | "ALL_PROXY" | "http_proxy" | "https_proxy" | "all_proxy"
        ) && entry
            .value
            .as_ref()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false)
    })
}

fn capture_proxy_environment_variable_snapshots_from_manual_settings(
    settings: &ManualEnvironmentProxySettings,
) -> Vec<ProxyEnvironmentVariableSnapshot> {
    capture_proxy_environment_variable_snapshots_with(|key| match key {
        "HTTP_PROXY" => Some(settings.http_proxy.clone()),
        "HTTPS_PROXY" => Some(settings.https_proxy.clone()),
        "ALL_PROXY" => Some(settings.all_proxy.clone()),
        "NO_PROXY" => Some(settings.no_proxy.clone()),
        _ => None,
    })
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
        let source = build_environment_proxy_source_from_pairs(
            [
                (
                    "HTTP_PROXY".to_string(),
                    "http://proxy.local:8080".to_string(),
                ),
                (
                    "NO_PROXY".to_string(),
                    "localhost, *.company.local".to_string(),
                ),
            ],
            Some(EnvironmentProxyOrigin::Process),
        );
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
        let source = build_environment_proxy_source_from_pairs(
            [(
                "ALL_PROXY".to_string(),
                "http://shared.proxy.local:8080".to_string(),
            )],
            Some(EnvironmentProxyOrigin::Process),
        );
        let config = source.config.expect("environment proxy should exist");

        assert_eq!(
            config.proxies.get("*").map(String::as_str),
            Some("http://shared.proxy.local:8080")
        );
        assert_eq!(source.detected_variable_names, vec!["ALL_PROXY"]);
    }

    #[test]
    fn proxy_environment_variable_snapshots_preserve_requested_names() {
        let snapshots = capture_proxy_environment_variable_snapshots_with(|key| match key {
            "HTTP_PROXY" => Some("http://upper.proxy.local:8080".to_string()),
            "http_proxy" => Some("http://lower.proxy.local:8080".to_string()),
            "NO_PROXY" => Some("localhost,127.0.0.1".to_string()),
            _ => None,
        });

        let values: Vec<(String, Option<String>)> = snapshots
            .into_iter()
            .map(|entry| (entry.key, entry.value))
            .collect();

        assert_eq!(
            values,
            vec![
                (
                    "HTTP_PROXY".to_string(),
                    Some("http://upper.proxy.local:8080".to_string())
                ),
                ("HTTPS_PROXY".to_string(), None),
                ("ALL_PROXY".to_string(), None),
                (
                    "NO_PROXY".to_string(),
                    Some("localhost,127.0.0.1".to_string())
                ),
                (
                    "http_proxy".to_string(),
                    Some("http://lower.proxy.local:8080".to_string())
                ),
                ("https_proxy".to_string(), None),
                ("all_proxy".to_string(), None),
                ("no_proxy".to_string(), None),
            ]
        );
    }

    #[test]
    fn diagnostics_detects_pac_when_system_proxy_falls_back_to_direct() {
        let detected_source = diagnostics_detected_source_label(
            ConfiguredProxySource::System,
            &ResolvedProxyTransport::direct(None),
            &MacOsSystemProxyDiagnostics {
                supported: true,
                pac_enabled: true,
                ..MacOsSystemProxyDiagnostics::default()
            },
        );

        assert_eq!(detected_source, "PAC");
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
            ..ProxySettings::default()
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
            ..ProxySettings::default()
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
            ..ProxySettings::default()
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
                origin: None,
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
            ..ProxySettings::default()
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
                origin: None,
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
            ..ProxySettings::default()
        };
        let environment_source = build_environment_proxy_source_from_pairs(
            [
                (
                    "HTTPS_PROXY".to_string(),
                    "http://env.proxy.local:9000".to_string(),
                ),
                ("NO_PROXY".to_string(), "localhost".to_string()),
            ],
            Some(EnvironmentProxyOrigin::Process),
        );
        let resolved = resolve_proxy_from_sources(
            &url,
            &proxy_settings,
            None,
            environment_source.config.as_ref(),
        )
        .expect("proxy resolution should succeed");
        let mut resolved = resolved;
        resolved.environment_origin = environment_source.origin;
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
        assert!(diagnostics
            .iter()
            .any(|line| line.contains("Environment source: process environment variables")));
    }

    #[test]
    fn manual_environment_proxy_values_are_used_when_process_env_is_missing() {
        let source = load_environment_proxy_source(&ProxySettings {
            respect_environment_variables: true,
            manual_environment: ManualEnvironmentProxySettings {
                all_proxy: "http://manual.proxy.local:8118".to_string(),
                no_proxy: "localhost".to_string(),
                ..ManualEnvironmentProxySettings::default()
            },
            ..ProxySettings::default()
        });

        let config = source
            .config
            .expect("manual environment proxy should exist");
        assert_eq!(
            config.proxies.get("*").map(String::as_str),
            Some("http://manual.proxy.local:8118")
        );
        assert_eq!(source.origin, Some(EnvironmentProxyOrigin::Manual));
    }

    #[test]
    fn process_environment_proxy_values_override_manual_environment_values() {
        let process_snapshots =
            capture_proxy_environment_variable_snapshots_with(|key| match key {
                "HTTPS_PROXY" => Some("http://process.proxy.local:8443".to_string()),
                _ => None,
            });
        let manual_snapshots = capture_proxy_environment_variable_snapshots_from_manual_settings(
            &ManualEnvironmentProxySettings {
                https_proxy: "http://manual.proxy.local:9000".to_string(),
                ..ManualEnvironmentProxySettings::default()
            },
        );
        let mut merged_pairs = snapshots_to_pairs(&manual_snapshots);
        merged_pairs.extend(snapshots_to_pairs(&process_snapshots));
        let source = build_environment_proxy_source_from_pairs(
            merged_pairs,
            Some(EnvironmentProxyOrigin::Process),
        );

        let config = source
            .config
            .expect("merged environment proxy should exist");
        assert_eq!(
            config.proxies.get("https").map(String::as_str),
            Some("http://process.proxy.local:8443")
        );
        assert_eq!(source.origin, Some(EnvironmentProxyOrigin::Process));
    }

    #[test]
    fn shell_visibility_warning_is_reported_when_shell_has_proxy_and_process_does_not() {
        let warning = build_proxy_environment_visibility_warning(
            &capture_proxy_environment_variable_snapshots_with(|_| None),
            &capture_proxy_environment_variable_snapshots_with(|_| None),
            &capture_proxy_environment_variable_snapshots_with(|key| match key {
                "http_proxy" => Some("http://shell.proxy.local:3128".to_string()),
                _ => None,
            }),
        );

        #[cfg(target_os = "macos")]
        assert_eq!(
            warning.as_deref(),
            Some(
                "Proxy environment variables were found in shell but are not visible to Bifrost when launched as a macOS app."
            )
        );

        #[cfg(not(target_os = "macos"))]
        assert_eq!(warning, None);
    }

    #[test]
    fn socks_proxy_is_rejected_for_now() {
        let error = normalize_proxy_endpoint("socks5://proxy.local:1080")
            .expect_err("socks should be rejected");
        assert!(error.contains("SOCKS"));
    }
}
