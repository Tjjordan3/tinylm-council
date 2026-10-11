use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use tauri::AppHandle;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

const API_HOST: &str = "127.0.0.1";
// Dedicated desktop port so a leftover start.ps1 / browser backend on :8001 cannot
// silently handle Tauri UI requests (which made Debate settings appear to "revert").
const API_PORT: u16 = 18765;

pub enum BackendProcess {
  Sidecar(CommandChild),
  Child(Child),
}

impl BackendProcess {
  pub fn kill(self) {
    match self {
      BackendProcess::Sidecar(child) => {
        let _ = child.kill();
      }
      BackendProcess::Child(mut child) => {
        let _ = child.kill();
        let _ = child.wait();
      }
    }
  }
}

pub fn api_base() -> String {
  format!("http://{API_HOST}:{API_PORT}")
}

pub fn start(app: &AppHandle) -> Result<BackendProcess, String> {
  if cfg!(debug_assertions) {
    start_dev_process()
  } else {
    start_sidecar(app)
  }
}

fn start_dev_process() -> Result<BackendProcess, String> {
  let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    .join("../..")
    .canonicalize()
    .map_err(|err| format!("resolve repo root: {err}"))?;

  let use_uv = Command::new("uv")
    .arg("--version")
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .status()
    .map(|status| status.success())
    .unwrap_or(false);

  let mut command = if use_uv {
    let mut cmd = Command::new("uv");
    cmd.args(["run", "python", "-m", "backend.main"]);
    cmd
  } else if cfg!(windows) {
    let mut cmd = Command::new("python");
    cmd.args(["-m", "backend.main"]);
    cmd
  } else {
    let mut cmd = Command::new("python3");
    cmd.args(["-m", "backend.main"]);
    cmd
  };

  let child = command
    .current_dir(repo_root)
    .env("TINYLM_DESKTOP", "1")
    .env("TINYLM_HOST", API_HOST)
    .env("TINYLM_PORT", API_PORT.to_string())
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .spawn()
    .map_err(|err| format!("spawn API process: {err}"))?;

  Ok(BackendProcess::Child(child))
}

fn start_sidecar(app: &AppHandle) -> Result<BackendProcess, String> {
  let (mut rx, child) = app
    .shell()
    .sidecar("tinylm-council-api")
    .map_err(|err| format!("resolve API sidecar: {err}"))?
    .env("TINYLM_DESKTOP", "1")
    .env("TINYLM_HOST", API_HOST)
    .env("TINYLM_PORT", API_PORT.to_string())
    .spawn()
    .map_err(|err| format!("spawn API sidecar: {err}"))?;

  tauri::async_runtime::spawn(async move {
    while let Some(_event) = rx.recv().await {}
  });

  Ok(BackendProcess::Sidecar(child))
}

pub fn wait_until_ready(timeout: Duration) -> Result<(), String> {
  let deadline = Instant::now() + timeout;
  let addr = format!("{API_HOST}:{API_PORT}");

  while Instant::now() < deadline {
    if TcpStream::connect_timeout(
      &addr
        .parse()
        .map_err(|err| format!("parse API address: {err}"))?,
      Duration::from_millis(200),
    )
    .is_ok()
    {
      thread::sleep(Duration::from_millis(250));
      return Ok(());
    }
    thread::sleep(Duration::from_millis(200));
  }

  Err(format!(
    "API did not become ready at {} within {}s",
    api_base(),
    timeout.as_secs()
  ))
}
