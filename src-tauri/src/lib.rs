// 原生能力：
// - HTTP 插件让界面绕开浏览器跨域限制调用腾讯接口，可访问的域名见 capabilities/default.json；
// - opener 插件把 target="_blank" 的链接（来源原文、控制台）交给系统浏览器打开；
// - save_markdown 命令：弹出系统「另存为」对话框，把导出的 Markdown 写到用户选的位置。
//   路径只来自对话框，界面传不了任意路径，因此不开放文件系统插件。
// 开发版额外提供 debug_log 命令，把请求链路写到项目的 .debug/ 目录；发布版不编译这部分。

#[cfg(debug_assertions)]
mod debug_log {
    use std::{
        fs::{self, OpenOptions},
        io::Write,
        path::PathBuf,
    };

    fn dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join(".debug")
    }

    /// 每次启动把上一次的日志保留为 network.prev.jsonl，当前日志从空文件开始
    pub fn rotate() {
        let d = dir();
        if let Err(e) = fs::create_dir_all(&d) {
            eprintln!("debug log: cannot create {}: {e}", d.display());
            return;
        }
        let current = d.join("network.jsonl");
        if current.exists() {
            if let Err(e) = fs::rename(&current, d.join("network.prev.jsonl")) {
                eprintln!("debug log: cannot rotate: {e}");
            }
        }
    }

    #[tauri::command]
    pub fn debug_log(line: String) -> Result<(), String> {
        let mut f = OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir().join("network.jsonl"))
            .map_err(|e| e.to_string())?;
        // 前端传来的是单行 JSON；保险起见去掉换行，保证一行一条
        writeln!(f, "{}", line.replace(['\n', '\r'], " ")).map_err(|e| e.to_string())
    }
}

/// 导出 Markdown：用户在对话框里取消时返回 false。async 命令跑在后台线程，阻塞式对话框不会卡住主线程
#[tauri::command]
async fn save_markdown(app: tauri::AppHandle, name: String, content: String) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(path) = app
        .dialog()
        .file()
        .set_file_name(&name)
        .add_filter("Markdown", &["md"])
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());

    #[cfg(debug_assertions)]
    let builder = {
        debug_log::rotate();
        builder.invoke_handler(tauri::generate_handler![save_markdown, debug_log::debug_log])
    };
    #[cfg(not(debug_assertions))]
    let builder = builder.invoke_handler(tauri::generate_handler![save_markdown]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
