use std::collections::HashSet;
use std::env;

use proxy_cfg::ProxyConfig;
use reqwest::{Proxy, Url};
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

#[derive(Clone)]
pub(crate) struct ResolvedProxyTransport {
    pub info: ProxyResolutionInfo,
    proxy_config: Option<ProxyConfig>,
    auth: Option<(String, String)>,
}

impl ResolvedProxyTransport {
    fn direct(detail: Option<String>) -> Self {
        Self {
            info: ProxyResolutionInfo {
                mode: ProxyResolutionMode::Direct,
                summary: "Direct connection".to_string(),
                proxy_url: None,
                detail,
            },
            proxy_config: None,
            auth: None,
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

    let mut proxy = Proxy::custom(move |url| proxy_config.get_proxy_for_url(url));
    if let Some((username, password)) = &resolved_proxy.auth {
        proxy = proxy.basic_auth(username, password);
    }

    Ok(Some(proxy))
}

pub(crate) fn resolve_effective_proxy_transport(
    app: &AppHandle,
    url: &Url,
    proxy_settings_override: Option<ProxySettings>,
) -> Result<ResolvedProxyTransport, String> {
    let proxy_settings = proxy_settings_override.unwrap_or(load_app_settings_value(app)?.proxy);
    let system_proxy = if proxy_settings.use_system_proxy {
        load_system_proxy_config()?
    } else {
        None
    };
    let environment_proxy = if proxy_settings.respect_environment_variables {
        load_environment_proxy_config_from_process()
    } else {
        None
    };

    resolve_proxy_from_sources(
        url,
        &proxy_settings,
        system_proxy.as_ref(),
        environment_proxy.as_ref(),
    )
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

    Ok(ResolvedProxyTransport::direct(None))
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

    let Some(proxy_address) = config.get_proxy_for_url(url) else {
        return Ok(Some(ResolvedProxyTransport::direct(Some(format!(
            "Bypassed by {} proxy rules.",
            source_name_for_mode(&mode)
        )))));
    };

    let normalized_endpoint = normalize_proxy_endpoint(&proxy_address)?;

    Ok(Some(ResolvedProxyTransport {
        info: ProxyResolutionInfo {
            mode: mode.clone(),
            summary: summary_for_mode(&mode).to_string(),
            proxy_url: Some(normalized_endpoint.display),
            detail: None,
        },
        proxy_config: Some(config),
        auth: candidate.auth,
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

fn load_environment_proxy_config_from_process() -> Option<ProxyConfig> {
    build_environment_proxy_config(env::vars())
}

fn build_environment_proxy_config<I>(pairs: I) -> Option<ProxyConfig>
where
    I: IntoIterator<Item = (String, String)>,
{
    let mut config = ProxyConfig::default();

    for (raw_key, raw_value) in pairs {
        let key = raw_key.to_ascii_lowercase();
        let value = raw_value.trim();
        if value.is_empty() {
            continue;
        }

        match key.as_str() {
            "http_proxy" => {
                config.proxies.insert("http".to_string(), value.to_string());
            }
            "https_proxy" => {
                config
                    .proxies
                    .insert("https".to_string(), value.to_string());
            }
            "no_proxy" => {
                let (whitelist, exclude_simple) = parse_bypass_list(value);
                config.whitelist.extend(whitelist);
                config.exclude_simple |= exclude_simple;
            }
            _ => {}
        }
    }

    if config.proxies.is_empty() {
        return None;
    }

    Some(config)
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

    Ok(NormalizedProxyEndpoint {
        url: parsed.to_string(),
        display: format!("{host}:{port}"),
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
        let config = build_environment_proxy_config([
            (
                "HTTP_PROXY".to_string(),
                "http://proxy.local:8080".to_string(),
            ),
            (
                "NO_PROXY".to_string(),
                "localhost, *.company.local".to_string(),
            ),
        ])
        .expect("environment proxy should exist");

        assert_eq!(
            config.proxies.get("http").map(String::as_str),
            Some("http://proxy.local:8080")
        );
        assert!(config.whitelist.contains("localhost"));
        assert!(config.whitelist.contains("*.company.local"));
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
        assert_eq!(resolved.info.proxy_url, None);
    }

    #[test]
    fn socks_proxy_is_rejected_for_now() {
        let error = normalize_proxy_endpoint("socks5://proxy.local:1080")
            .expect_err("socks should be rejected");
        assert!(error.contains("SOCKS"));
    }
}
