use native_tls::TlsConnector;
use reqwest::{Client, Method};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use url::Url;

#[derive(Serialize)]
struct RigCommandResult {
  ok: bool,
  message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RigState {
  endpoint: String,
  radio_name: Option<String>,
  version: Option<String>,
  frequency_hz: Option<f64>,
  mode: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopApiResponse {
  status: u16,
  body: String,
  endpoint: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerCertificateInfo {
  endpoint: String,
  fingerprint: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopImportAdifResponse {
  imported_count: usize,
  endpoint: String,
}

#[derive(Serialize, Deserialize, Default)]
struct DesktopCacheDocument {
  values: serde_json::Map<String, serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiHeader {
  name: String,
  value: String,
}

#[derive(Debug)]
enum XmlRpcValue {
  String(String),
  Double(f64),
  Integer(i32),
  Array(Vec<XmlRpcValue>),
  Boolean,
  Nil,
}

impl XmlRpcValue {
  fn as_string(&self) -> Option<&str> {
    match self {
      Self::String(value) => Some(value.as_str()),
      _ => None,
    }
  }

  fn as_double(&self) -> Option<f64> {
    match self {
      Self::Double(value) => Some(*value),
      Self::Integer(value) => Some((*value).into()),
      _ => None,
    }
  }

  fn as_array(&self) -> Option<&[XmlRpcValue]> {
    match self {
      Self::Array(values) => Some(values.as_slice()),
      _ => None,
    }
  }
}

fn xml_escape(value: &str) -> String {
  value
    .replace('&', "&amp;")
    .replace('<', "&lt;")
    .replace('>', "&gt;")
    .replace('"', "&quot;")
    .replace('\'', "&apos;")
}

fn build_param(value: &str, kind: &str) -> String {
  format!("<param><value><{kind}>{value}</{kind}></value></param>")
}

fn build_xml_request(method_name: &str, params: &[String]) -> String {
  format!(
    r#"<?xml version="1.0"?>
<methodCall>
  <methodName>{method_name}</methodName>
  <params>{}</params>
</methodCall>"#,
    params.join("")
  )
}

fn parse_xmlrpc_value_node(node: roxmltree::Node<'_, '_>) -> Result<XmlRpcValue, String> {
  if let Some(child) = node.children().find(|candidate| candidate.is_element()) {
    let text = child.text().unwrap_or_default().trim();
    return match child.tag_name().name() {
      "string" => Ok(XmlRpcValue::String(text.to_string())),
      "double" => text
        .parse::<f64>()
        .map(XmlRpcValue::Double)
        .map_err(|error| error.to_string()),
      "int" | "i4" => text
        .parse::<i32>()
        .map(XmlRpcValue::Integer)
        .map_err(|error| error.to_string()),
      "boolean" => Ok(XmlRpcValue::Boolean),
      "nil" => Ok(XmlRpcValue::Nil),
      "array" => {
        let values = child
          .descendants()
          .find(|candidate| candidate.has_tag_name("data"))
          .map(|data| {
            data.children()
              .filter(|candidate| candidate.has_tag_name("value"))
              .map(parse_xmlrpc_value_node)
              .collect::<Result<Vec<_>, _>>()
          })
          .transpose()?
          .unwrap_or_default();
        Ok(XmlRpcValue::Array(values))
      }
      _ => Ok(XmlRpcValue::String(text.to_string())),
    };
  }

  Ok(XmlRpcValue::String(node.text().unwrap_or_default().trim().to_string()))
}

fn parse_xmlrpc_value(body: &str) -> Result<XmlRpcValue, String> {
  let document = roxmltree::Document::parse(body).map_err(|error| error.to_string())?;

  if let Some(fault) = document.descendants().find(|node| node.has_tag_name("fault")) {
    return Err(fault.text().unwrap_or("FLrig returned an XML-RPC fault.").to_string());
  }

  let value = document
    .descendants()
    .find(|node| node.has_tag_name("param"))
    .and_then(|node| node.descendants().find(|child| child.has_tag_name("value")))
    .ok_or_else(|| "FLrig returned an XML-RPC response with no value.".to_string())?;

  parse_xmlrpc_value_node(value)
}

async fn call_xmlrpc(endpoint: &str, method_name: &str, params: &[String]) -> Result<XmlRpcValue, String> {
  let client = Client::new();
  let response = client
    .post(endpoint)
    .header("Content-Type", "text/xml")
    .body(build_xml_request(method_name, params))
    .send()
    .await
    .map_err(|error| error.to_string())?;

  let status = response.status();
  let body = response.text().await.map_err(|error| error.to_string())?;

  if !status.is_success() {
    return Err(format!("Rig endpoint returned HTTP {}: {}", status.as_u16(), body));
  }

  parse_xmlrpc_value(&body)
}

fn normalize_mode_name(mode: &str) -> String {
  mode
    .chars()
    .filter(|character| character.is_ascii_alphanumeric())
    .collect::<String>()
    .to_uppercase()
}

fn digital_mode_candidates(requested_mode: &str, frequency_hz: f64) -> Vec<String> {
  let normalized = normalize_mode_name(requested_mode);
  let upper_sideband = frequency_hz >= 10_000_000.0 || frequency_hz == 0.0;
  let ssb_sideband = if upper_sideband { "USB" } else { "LSB" };

  match normalized.as_str() {
    "SSB" => vec![ssb_sideband.to_string()],
    "CW" | "CWR" | "AM" | "FM" => vec![normalized],
    "FT8" | "FT4" | "JS8" | "PSK" | "PSK31" | "PSK63" | "RTTY" | "DIGITAL" | "DIGI" => vec![
      "PKTUSB".to_string(),
      "USBD".to_string(),
      "DATAUSB".to_string(),
      "DIGU".to_string(),
      "USB".to_string(),
    ],
    _ => vec![normalized],
  }
}

async fn resolve_flrig_mode(endpoint: &str, requested_mode: &str, frequency_hz: f64) -> Result<String, String> {
  let available_modes = call_xmlrpc(endpoint, "rig.get_modes", &[]).await?;
  let mode_table = available_modes
    .as_array()
    .ok_or_else(|| "FLrig did not return a mode table.".to_string())?;

  let indexed_modes = mode_table
    .iter()
    .enumerate()
    .filter_map(|(index, value)| value.as_string().map(|mode| (index as i32, mode.to_string())))
    .collect::<Vec<_>>();

  if indexed_modes.is_empty() {
    return Err("FLrig returned an empty mode table.".to_string());
  }

  let requested_candidates = digital_mode_candidates(requested_mode, frequency_hz);

  for candidate in requested_candidates {
    if let Some((_, mode)) = indexed_modes
      .iter()
      .find(|(_, mode)| normalize_mode_name(mode) == candidate)
      .cloned()
    {
      return Ok(mode);
    }
  }

  Err(format!(
    "Rig mode '{}' was not available. FLrig reported: {}",
    requested_mode,
    indexed_modes
      .iter()
      .map(|(_, mode)| mode.as_str())
      .collect::<Vec<_>>()
      .join(", ")
  ))
}

fn format_fingerprint(bytes: &[u8]) -> String {
  let digest = Sha256::digest(bytes);
  hex::encode_upper(digest)
    .as_bytes()
    .chunks(2)
    .map(|pair| std::str::from_utf8(pair).unwrap_or_default())
    .collect::<Vec<_>>()
    .join(":")
}

fn connect_with_timeout(host: &str, port: u16, timeout: Duration) -> Result<TcpStream, String> {
  let address = format!("{host}:{port}");
  let socket_addresses = address
    .to_socket_addrs()
    .map_err(|error| error.to_string())?;

  let mut last_error = None;
  for socket_address in socket_addresses {
    match TcpStream::connect_timeout(&socket_address, timeout) {
      Ok(stream) => return Ok(stream),
      Err(error) => last_error = Some(error.to_string()),
    }
  }

  Err(last_error.unwrap_or_else(|| format!("Could not connect to {address}")))
}

fn fetch_server_fingerprint(endpoint: &str) -> Result<String, String> {
  let url = Url::parse(endpoint).map_err(|error| error.to_string())?;
  if url.scheme() != "https" {
    return Err("Certificate probing only applies to HTTPS endpoints.".to_string());
  }

  let host = url
    .host_str()
    .ok_or_else(|| "Endpoint host was missing.".to_string())?
    .to_string();
  let port = url.port_or_known_default().unwrap_or(443);

  let stream = connect_with_timeout(&host, port, Duration::from_secs(3))?;
  stream
    .set_read_timeout(Some(Duration::from_secs(10)))
    .map_err(|error| error.to_string())?;
  stream
    .set_write_timeout(Some(Duration::from_secs(10)))
    .map_err(|error| error.to_string())?;

  let connector = TlsConnector::builder()
    .danger_accept_invalid_certs(true)
    .danger_accept_invalid_hostnames(true)
    .build()
    .map_err(|error| error.to_string())?;

  let tls_stream = connector
    .connect(&host, stream)
    .map_err(|error| error.to_string())?;

  let certificate = tls_stream
    .peer_certificate()
    .map_err(|error| error.to_string())?
    .ok_or_else(|| "Server did not present a certificate.".to_string())?;

  let der = certificate.to_der().map_err(|error| error.to_string())?;
  Ok(format_fingerprint(&der))
}

fn join_url(endpoint: &str, path: &str) -> Result<String, String> {
  let base = endpoint.trim_end_matches('/');
  let joined = if path.starts_with('/') {
    format!("{base}{path}")
  } else {
    format!("{base}/{path}")
  };
  Url::parse(&joined).map_err(|error| error.to_string())?;
  Ok(joined)
}

fn desktop_cache_path(app: &AppHandle) -> Result<PathBuf, String> {
  let app_data_dir = app
    .path()
    .app_data_dir()
    .map_err(|error| error.to_string())?;

  fs::create_dir_all(&app_data_dir).map_err(|error| error.to_string())?;
  Ok(app_data_dir.join("desktop-cache.json"))
}

fn read_desktop_cache_document(app: &AppHandle) -> Result<DesktopCacheDocument, String> {
  let path = desktop_cache_path(app)?;
  if !path.exists() {
    return Ok(DesktopCacheDocument::default());
  }

  let text = fs::read_to_string(path).map_err(|error| error.to_string())?;
  serde_json::from_str(&text).map_err(|error| error.to_string())
}

fn write_desktop_cache_document(app: &AppHandle, document: &DesktopCacheDocument) -> Result<(), String> {
  let path = desktop_cache_path(app)?;
  let text = serde_json::to_string_pretty(document).map_err(|error| error.to_string())?;
  fs::write(path, text).map_err(|error| error.to_string())
}

async fn send_api_request(
  endpoint: &str,
  method: &str,
  path: &str,
  headers: &[ApiHeader],
  body: Option<String>,
  pinned_fingerprint: Option<&str>,
) -> Result<DesktopApiResponse, String> {
  let url = join_url(endpoint, path)?;
  let parsed = Url::parse(endpoint).map_err(|error| error.to_string())?;

  if parsed.scheme() == "https" {
    let fingerprint = fetch_server_fingerprint(endpoint)?;
    match pinned_fingerprint.map(str::trim).filter(|value| !value.is_empty()) {
      Some(expected) if !fingerprint.eq_ignore_ascii_case(expected) => {
        return Err(format!(
          "Pinned server fingerprint mismatch at {endpoint}. Expected {expected}, got {fingerprint}."
        ))
      }
      None => {
        return Err(format!(
          "Untrusted server certificate at {endpoint}. Fingerprint: {fingerprint}"
        ))
      }
      _ => {}
    }
  }

  let method = Method::from_bytes(method.as_bytes()).map_err(|error| error.to_string())?;
  let mut builder = Client::builder()
    .connect_timeout(Duration::from_secs(3))
    .timeout(Duration::from_secs(20));

  if parsed.scheme() == "https" {
    builder = builder
      .danger_accept_invalid_certs(true)
      .danger_accept_invalid_hostnames(true);
  }

  let client = builder.build().map_err(|error| error.to_string())?;
  let mut request = client.request(method, &url);

  for header in headers {
    request = request.header(&header.name, &header.value);
  }

  if let Some(payload) = body {
    request = request.body(payload);
  }

  let response = request.send().await.map_err(|error| error.to_string())?;
  let status = response.status().as_u16();
  let body = response.text().await.map_err(|error| error.to_string())?;

  Ok(DesktopApiResponse {
    status,
    body,
    endpoint: endpoint.to_string(),
  })
}

async fn send_adif_import_request(
  endpoint: &str,
  logbook_id: &str,
  operator_callsign: &str,
  filename: &str,
  adif_text: &str,
  api_token: &str,
  pinned_fingerprint: Option<&str>,
) -> Result<DesktopImportAdifResponse, String> {
  let path = format!(
    "/logs/import?logbook_id={}&operator_callsign={}",
    urlencoding::encode(logbook_id),
    urlencoding::encode(operator_callsign)
  );
  let url = join_url(endpoint, &path)?;
  let parsed = Url::parse(endpoint).map_err(|error| error.to_string())?;

  if parsed.scheme() == "https" {
    let fingerprint = fetch_server_fingerprint(endpoint)?;
    match pinned_fingerprint.map(str::trim).filter(|value| !value.is_empty()) {
      Some(expected) if !fingerprint.eq_ignore_ascii_case(expected) => {
        return Err(format!(
          "Pinned server fingerprint mismatch at {endpoint}. Expected {expected}, got {fingerprint}."
        ))
      }
      None => {
        return Err(format!(
          "Untrusted server certificate at {endpoint}. Fingerprint: {fingerprint}"
        ))
      }
      _ => {}
    }
  }

  let mut builder = Client::builder()
    .connect_timeout(Duration::from_secs(3))
    .timeout(Duration::from_secs(60));
  if parsed.scheme() == "https" {
    builder = builder
      .danger_accept_invalid_certs(true)
      .danger_accept_invalid_hostnames(true);
  }

  let client = builder.build().map_err(|error| error.to_string())?;
  let part = reqwest::multipart::Part::text(adif_text.to_string())
    .file_name(filename.to_string())
    .mime_str("text/plain")
    .map_err(|error| error.to_string())?;
  let form = reqwest::multipart::Form::new().part("file", part);

  let response = client
    .post(url)
    .header("X-Api-Key", api_token)
    .multipart(form)
    .send()
    .await
    .map_err(|error| error.to_string())?;

  let status = response.status();
  let body = response.text().await.map_err(|error| error.to_string())?;
  if !status.is_success() {
    return Err(body);
  }

  #[derive(Deserialize)]
  struct RawImportResponse {
    imported_contacts: Vec<serde_json::Value>,
  }

  let parsed_body: RawImportResponse = serde_json::from_str(&body).map_err(|error| error.to_string())?;
  Ok(DesktopImportAdifResponse {
    imported_count: parsed_body.imported_contacts.len(),
    endpoint: endpoint.to_string(),
  })
}

#[tauri::command]
async fn desktop_api_request(
  endpoints: Vec<String>,
  method: String,
  path: String,
  headers: Vec<ApiHeader>,
  body: Option<String>,
  pinned_fingerprint: Option<String>,
) -> Result<DesktopApiResponse, String> {
  let candidates = endpoints
    .into_iter()
    .map(|endpoint| endpoint.trim().to_string())
    .filter(|endpoint| !endpoint.is_empty())
    .collect::<Vec<_>>();

  if candidates.is_empty() {
    return Err("No server endpoints configured.".to_string());
  }

  let mut last_error = None;
  for endpoint in candidates {
    match send_api_request(
      &endpoint,
      &method,
      &path,
      &headers,
      body.clone(),
      pinned_fingerprint.as_deref(),
    )
    .await
    {
      Ok(response) => return Ok(response),
      Err(error) => last_error = Some(error),
    }
  }

  Err(last_error.unwrap_or_else(|| "Request failed.".to_string()))
}

#[tauri::command]
async fn probe_server_certificate(endpoint: String) -> Result<ServerCertificateInfo, String> {
  Ok(ServerCertificateInfo {
    fingerprint: fetch_server_fingerprint(&endpoint)?,
    endpoint,
  })
}

#[tauri::command]
async fn desktop_import_adif(
  endpoints: Vec<String>,
  logbook_id: String,
  operator_callsign: String,
  filename: String,
  adif_text: String,
  api_token: String,
  pinned_fingerprint: Option<String>,
) -> Result<DesktopImportAdifResponse, String> {
  let candidates = endpoints
    .into_iter()
    .map(|endpoint| endpoint.trim().to_string())
    .filter(|endpoint| !endpoint.is_empty())
    .collect::<Vec<_>>();

  if candidates.is_empty() {
    return Err("No server endpoints configured.".to_string());
  }

  let mut last_error = None;
  for endpoint in candidates {
    match send_adif_import_request(
      &endpoint,
      &logbook_id,
      &operator_callsign,
      &filename,
      &adif_text,
      &api_token,
      pinned_fingerprint.as_deref(),
    )
    .await
    {
      Ok(response) => return Ok(response),
      Err(error) => last_error = Some(error),
    }
  }

  Err(last_error.unwrap_or_else(|| "ADIF import failed.".to_string()))
}

#[tauri::command]
fn desktop_store_get(app: AppHandle, key: String) -> Result<Option<serde_json::Value>, String> {
  let document = read_desktop_cache_document(&app)?;
  Ok(document.values.get(&key).cloned())
}

#[tauri::command]
fn desktop_store_set(app: AppHandle, key: String, value: serde_json::Value) -> Result<(), String> {
  let mut document = read_desktop_cache_document(&app)?;
  document.values.insert(key, value);
  write_desktop_cache_document(&app, &document)
}

#[tauri::command]
async fn read_flrig_state(endpoint: String) -> Result<RigState, String> {
  let version = call_xmlrpc(&endpoint, "main.get_version", &[])
    .await
    .ok()
    .and_then(|value| value.as_string().map(str::to_string));
  let radio_name = call_xmlrpc(&endpoint, "rig.get_xcvr", &[])
    .await
    .ok()
    .and_then(|value| value.as_string().map(str::to_string));
  let frequency_hz = call_xmlrpc(&endpoint, "rig.get_vfo", &[])
    .await
    .ok()
    .and_then(|value| value.as_double());
  let mode = call_xmlrpc(&endpoint, "rig.get_mode", &[])
    .await
    .ok()
    .and_then(|value| value.as_string().map(str::to_string));

  Ok(RigState {
    endpoint,
    radio_name,
    version,
    frequency_hz,
    mode,
  })
}

#[tauri::command]
async fn tune_flrig(endpoint: String, frequency_hz: f64, mode: String) -> Result<RigCommandResult, String> {
  let frequency_param = build_param(&format!("{frequency_hz:.0}"), "int");
  call_xmlrpc(
    &endpoint,
    "main.set_frequency",
    std::slice::from_ref(&frequency_param),
  )
  .await?;

  let requested_mode = resolve_flrig_mode(&endpoint, &mode, frequency_hz).await?;
  call_xmlrpc(
    &endpoint,
    "rig.set_mode",
    &[build_param(&xml_escape(&requested_mode), "string")],
  )
  .await?;

  let confirmed_frequency = call_xmlrpc(&endpoint, "rig.get_vfo", &[])
    .await?
    .as_double()
    .unwrap_or(0.0);
  let confirmed_mode = call_xmlrpc(&endpoint, "rig.get_mode", &[])
    .await?
    .as_string()
    .map(str::to_string)
    .unwrap_or_default();

  let frequency_matches = (confirmed_frequency - frequency_hz).abs() <= 10.0;
  let mode_matches = normalize_mode_name(&confirmed_mode) == normalize_mode_name(&requested_mode);
  let ok = frequency_matches && mode_matches;

  Ok(RigCommandResult {
    ok,
    message: if ok {
      format!(
        "Rig tuned through {} to {:.0} Hz {}.",
        endpoint, confirmed_frequency, confirmed_mode
      )
    } else {
      format!(
        "Rig tune did not confirm on {}. Requested {:.0} Hz {} but rig reports {:.0} Hz {}.",
        endpoint,
        frequency_hz,
        requested_mode,
        confirmed_frequency,
        confirmed_mode
      )
    },
  })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_log::Builder::default().build())
    .invoke_handler(tauri::generate_handler![
      desktop_api_request,
      desktop_import_adif,
      desktop_store_get,
      desktop_store_set,
      probe_server_certificate,
      read_flrig_state,
      tune_flrig
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
