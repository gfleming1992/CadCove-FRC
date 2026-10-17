//! Small distribution launcher. Bun is installed by the user, never embedded.
use std::{env, path::PathBuf, process::{Command, ExitCode}};

fn run() -> Result<i32, String> {
    let exe = env::current_exe().map_err(|e| e.to_string())?;
    let script = exe.parent().ok_or("Cannot locate CadCove runtime")?.join("cadcove.js");
    if !script.is_file() { return Err("CadCove runtime is incomplete; run Repair Runtime".into()); }
    let bun = if let Some(value) = env::var_os("CADCOVE_BUN") {
        let path = PathBuf::from(value);
        if !path.is_absolute() || !path.is_file() {
            return Err("CADCOVE_BUN must be an absolute path to the installed Bun executable".into());
        }
        path
    } else {
        let home = env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" });
        let installed = home.map(PathBuf::from).map(|p| p.join(".bun/bin").join(if cfg!(windows) { "bun.exe" } else { "bun" }));
        installed.filter(|p| p.is_file()).unwrap_or_else(|| PathBuf::from("bun"))
    };
    let mut command = Command::new(bun);
    command.arg("--no-env-file").arg(script).args(env::args_os().skip(1));
    // Unix exec preserves the PID and signal behavior of managed simulations.
    #[cfg(unix)] {
        use std::os::unix::process::CommandExt;
        Err(format!("Install Bun 1.4.2 or set CADCOVE_BUN to its executable: {}", command.exec()))
    }
    #[cfg(not(unix))] {
        command.status().map(|s| s.code().unwrap_or(1))
            .map_err(|e| format!("Install Bun 1.4.2 or set CADCOVE_BUN to its executable: {e}"))
    }
}
fn main() -> ExitCode {
    match run() {
        Ok(code) => ExitCode::from(code.clamp(0, 255) as u8),
        Err(error) => { eprintln!("CadCove: {error}"); ExitCode::from(2) }
    }
}
