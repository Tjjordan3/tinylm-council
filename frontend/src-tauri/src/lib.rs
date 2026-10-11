mod backend;

use std::sync::Mutex;

use tauri::{Manager, RunEvent, State};

use crate::backend::BackendProcess;

struct BackendChild(Mutex<Option<BackendProcess>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .manage(BackendChild(Mutex::new(None)))
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      match backend::start(app.handle()) {
        Ok(child) => {
          let state = app.state::<BackendChild>();
          *state.0.lock().expect("backend child lock") = Some(child);
          if let Err(err) = backend::wait_until_ready(std::time::Duration::from_secs(45)) {
            log::error!("TinyLM Council API failed to become ready: {err}");
          }
        }
        Err(err) => {
          log::error!("Failed to start TinyLM Council API: {err}");
        }
      }

      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app_handle, event| {
      if let RunEvent::Exit = event {
        stop_backend(app_handle.state::<BackendChild>());
      }
    });
}

fn stop_backend(state: State<'_, BackendChild>) {
  if let Ok(mut guard) = state.0.lock() {
    if let Some(child) = guard.take() {
      child.kill();
    }
  }
}
