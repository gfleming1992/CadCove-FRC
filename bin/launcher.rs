//! Small distribution launcher. Bun is installed by the user, never embedded.
use std::{env, path::PathBuf, process::Command};

// Windows has no exec() replacement. Keep this wrapper, Bun and its descendants
// in one kernel-owned job so terminating the wrapper cannot orphan a robot JVM.
#[cfg(windows)]
fn own_process_tree() -> Result<(), String> {
    use std::{ffi::c_void, mem, ptr};
    type Handle = *mut c_void;
    #[repr(C)]
    struct BasicLimits {
        process_time: i64, job_time: i64, flags: u32,
        minimum_working_set: usize, maximum_working_set: usize,
        active_process_limit: u32, affinity: usize, priority: u32, scheduling: u32,
    }
    #[repr(C)]
    struct ExtendedLimits {
        basic: BasicLimits, io_counters: [u64; 6],
        process_memory: usize, job_memory: usize,
        peak_process_memory: usize, peak_job_memory: usize,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn CreateJobObjectW(attributes: *const c_void, name: *const u16) -> Handle;
        fn SetInformationJobObject(job: Handle, class: i32, info: *const c_void, size: u32) -> i32;
        fn AssignProcessToJobObject(job: Handle, process: Handle) -> i32;
        fn GetCurrentProcess() -> Handle;
        fn CloseHandle(handle: Handle) -> i32;
    }
    // The null security attributes make the job handle non-inheritable. Windows
    // closes it when this process exits, including TerminateProcess/crashes.
    // Assign before spawning, so even an immediately launched descendant is owned.
    unsafe {
        let job = CreateJobObjectW(ptr::null(), ptr::null());
        if job.is_null() { return Err(format!("Cannot create launcher job: {}", std::io::Error::last_os_error())); }
        let mut limits: ExtendedLimits = mem::zeroed();
        limits.basic.flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if SetInformationJobObject(job, 9, &limits as *const _ as *const c_void, mem::size_of::<ExtendedLimits>() as u32) == 0
            || AssignProcessToJobObject(job, GetCurrentProcess()) == 0 {
            let error = std::io::Error::last_os_error();
            CloseHandle(job);
            return Err(format!("Cannot protect launcher process tree: {error}"));
        }
        // Intentionally retain this handle until OS process teardown, not a Rust
        // scope exit: closing it here would terminate this process immediately.
    }
    Ok(())
}

fn run() -> Result<i32, String> {
    #[cfg(windows)]
    own_process_tree()?;
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
fn main() {
    match run() {
        // Preserve Windows' full-width exit status, including NTSTATUS errors.
        Ok(code) => std::process::exit(code),
        Err(error) => { eprintln!("CadCove: {error}"); std::process::exit(2) }
    }
}
