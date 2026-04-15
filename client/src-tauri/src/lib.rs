use native_tls::TlsConnector;
use reqwest::{Client, Method};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::net::TcpStream;
use std::time::Duration;
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

  if let Some(node) = value.children().find(|child| child.is_element()) {
    let text = node.text().unwrap_or_default().trim();
    return match node.tag_name().name() {
      "string" => Ok(XmlRpcValue::String(text.to_string())),
      "double" => text
        .parse::<f64>()
        .map(XmlRpcValue::Double)
        .map_err(|error| error.to_string()),
      "int" | "i4" => text
        .parse::<i32>()
        .map(XmlRpcValue::Integer)
        .map_err(|error| error.to_string()),
      "boolean" => {
        let _ = text == "1";
        Ok(XmlRpcValue::Boolean)
      }
      "nil" => Ok(XmlRpcValue::Nil),
      _ => Ok(XmlRpcValue::String(text.to_string())),
    };
  }

  Ok(XmlRpcValue::String(
    value.text().unwrap_or_default().trim().to_string(),
  ))
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

fn format_fingerprint(bytes: &[u8]) -> String {
  let digest = Sha256::digest(bytes);
  hex::encode_upper(digest)
    .as_bytes()
    .chunks(2)
    .map(|pair| std::str::from_utf8(pair).unwrap_or_default())
    .collect::<Vec<_>>()
    .join(":")
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
  let address = format!("{host}:{port}");

  let stream = TcpStream::connect(address).map_err(|error| error.to_string())?;
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
  let mut builder = Client::builder().timeout(Duration::from_secs(20));

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
  let frequency = call_xmlrpc(
    &endpoint,
    "rig.set_verify_frequency",
    &[build_param(&format!("{frequency_hz:.0}"), "double")],
  )
  .await?;

  let requested_mode = mode.to_uppercase();
  let verify_mode = call_xmlrpc(
    &endpoint,
    "rig.set_verify_mode",
    &[build_param(&xml_escape(&requested_mode), "string")],
  )
  .await?;

  let confirmed_frequency = frequency.as_double().unwrap_or(frequency_hz);
  let confirmed_mode = verify_mode
    .as_string()
    .map(str::to_string)
    .unwrap_or(requested_mode);

  Ok(RigCommandResult {
    ok: true,
    message: format!(
      "Rig tuned through {} to {:.0} Hz {}.",
      endpoint, confirmed_frequency, confirmed_mode
    ),
  })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_log::Builder::default().build())
    .invoke_handler(tauri::generate_handler![
      desktop_api_request,
      probe_server_certificate,
      read_flrig_state,
      tune_flrig
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
