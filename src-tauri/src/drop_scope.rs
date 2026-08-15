use std::{fs, path::Path};

use tauri::AppHandle;
use tauri_plugin_fs::FsExt;

const MAX_DROPPED_PATHS: usize = 64;

#[tauri::command]
pub fn allow_dropped_paths(app: AppHandle, paths: Vec<String>) -> Result<Vec<String>, String> {
    let droppable_paths = filter_droppable_paths(&paths)?;
    let mut allowed_paths = Vec::with_capacity(droppable_paths.len());

    for path in droppable_paths {
        app.fs_scope()
            .allow_file(&path)
            .map_err(|error| format!("无法放行拖入文件 {path}: {error:?}"))?;
        allowed_paths.push(path);
    }

    Ok(allowed_paths)
}

fn filter_droppable_paths(paths: &[String]) -> Result<Vec<String>, String> {
    if paths.len() > MAX_DROPPED_PATHS {
        return Err(format!("一次最多处理 {MAX_DROPPED_PATHS} 个拖入文件"));
    }

    Ok(paths
        .iter()
        .filter(|path| {
            let path = Path::new(path);
            path.extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("json"))
                && fs::metadata(path).is_ok_and(|metadata| metadata.is_file())
        })
        .cloned()
        .collect())
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::filter_droppable_paths;

    fn test_root(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("系统时间应晚于 Unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("json-forge-drop-scope-{name}-{suffix}"));
        fs::create_dir_all(&root).expect("应创建测试目录");
        root
    }

    #[test]
    fn accepts_json_files_case_insensitively_and_skips_directories() {
        let root = test_root("filter");
        let json_path = root.join("data.JSON");
        let text_path = root.join("notes.txt");
        let directory_path = root.join("folder.json");
        fs::write(&json_path, b"{} ").expect("应创建 JSON 测试文件");
        fs::write(&text_path, b"text").expect("应创建非 JSON 测试文件");
        fs::create_dir(&directory_path).expect("应创建目录测试项");

        let paths = vec![
            json_path.to_string_lossy().into_owned(),
            text_path.to_string_lossy().into_owned(),
            directory_path.to_string_lossy().into_owned(),
            root.join("missing.json").to_string_lossy().into_owned(),
        ];

        assert_eq!(filter_droppable_paths(&paths).unwrap(), vec![paths[0].clone()]);
        fs::remove_dir_all(root).expect("应清理测试目录");
    }

    #[test]
    fn rejects_more_than_64_paths_before_filtering() {
        let paths = (0..65).map(|index| format!("/tmp/{index}.json")).collect::<Vec<_>>();

        let error = filter_droppable_paths(&paths).unwrap_err();

        assert!(error.contains("64"));
    }
}
