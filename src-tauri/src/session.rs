use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashSet},
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::{AppHandle, Manager, State};

const SESSION_VERSION: u8 = 1;
const SESSION_DIRECTORY: &str = "session-v1";
const MANIFEST_PREFIX: &str = "manifest-";
const MANIFEST_SUFFIX: &str = ".json";
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Default)]
pub struct SessionStore {
    commit_lock: Mutex<()>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDiff {
    left_id: String,
    right_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentFile {
    path: String,
    name: String,
    opened_at: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestDocumentEntry {
    id: String,
    title: String,
    file_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    collapsed_pane: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    view: Option<String>,
    language: String,
    created_at: f64,
    updated_at: f64,
    snapshot_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSessionManifestInput {
    version: u8,
    documents: Vec<ManifestDocumentEntry>,
    active_document_id: Option<String>,
    diff: Option<SessionDiff>,
    settings: serde_json::Value,
    recent_files: Vec<RecentFile>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSessionDocumentSnapshot {
    document_id: String,
    snapshot_id: String,
    content: String,
    saved_content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitWorkspaceSessionRequest {
    manifest: NativeSessionManifestInput,
    changed_documents: Vec<NativeSessionDocumentSnapshot>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitWorkspaceSessionResult {
    generation: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredManifest {
    version: u8,
    generation: u64,
    documents: Vec<ManifestDocumentEntry>,
    active_document_id: Option<String>,
    diff: Option<SessionDiff>,
    settings: serde_json::Value,
    recent_files: Vec<RecentFile>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonDocument {
    id: String,
    title: String,
    file_path: Option<String>,
    content: String,
    saved_content: String,
    collapsed_pane: String,
    language: String,
    created_at: f64,
    updated_at: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    documents: Vec<JsonDocument>,
    active_document_id: String,
    diff: Option<SessionDiff>,
    settings: serde_json::Value,
    recent_files: Vec<RecentFile>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSessionLoadResult {
    generation: u64,
    workspace: WorkspaceSnapshot,
    snapshot_ids: BTreeMap<String, String>,
}

// `(async)` 让 Tauri 把这个同步函数 spawn 到异步运行时，而不是主线程。
// 恢复要读清单并逐个校验文档快照，跑在主线程会让窗口连加载态都画不出来。
#[tauri::command(async)]
pub fn load_workspace_session(
    app: AppHandle,
    state: State<'_, SessionStore>,
) -> Result<Option<NativeSessionLoadResult>, String> {
    let _guard = state
        .commit_lock
        .lock()
        .map_err(|_| "会话存储暂时不可用，请重试。".to_string())?;
    load_at(&session_root(&app)?)
}

// 同样必须离开主线程：输入期间每 750ms 提交一次，单次要 fsync 写快照、重读全部文档
// 校验、再 fsync 写清单，还要清理旧世代。跑在主线程时这段时间 webview 是冻住的，
// 表现就是打字卡死；浏览器那条 localStorage 路径走 requestIdleCallback，永远不跟输入抢。
#[tauri::command(async)]
pub fn commit_workspace_session(
    app: AppHandle,
    state: State<'_, SessionStore>,
    request: CommitWorkspaceSessionRequest,
) -> Result<CommitWorkspaceSessionResult, String> {
    let _guard = state
        .commit_lock
        .lock()
        .map_err(|_| "会话存储暂时不可用，请重试。".to_string())?;
    commit_at(&session_root(&app)?, request)
}

fn session_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join(SESSION_DIRECTORY))
        .map_err(|_| "无法定位应用会话目录。".to_string())
}

fn commit_at(
    root: &Path,
    request: CommitWorkspaceSessionRequest,
) -> Result<CommitWorkspaceSessionResult, String> {
    validate_request(&request)?;
    let manifests_dir = root.join("manifests");
    let documents_dir = root.join("documents");
    fs::create_dir_all(&manifests_dir)
        .and_then(|_| fs::create_dir_all(&documents_dir))
        .map_err(|_| "无法创建会话存储目录。".to_string())?;

    for snapshot in &request.changed_documents {
        let path = snapshot_path(&documents_dir, &snapshot.document_id, &snapshot.snapshot_id);
        write_json_file(&path, snapshot, "无法写入文档恢复快照。")?;
    }

    for document in &request.manifest.documents {
        let path = snapshot_path(&documents_dir, &document.id, &document.snapshot_id);
        read_snapshot(&path, &document.id, &document.snapshot_id)
            .map_err(|_| "会话清单引用的文档快照不完整。".to_string())?;
    }

    let generation = next_generation(&manifests_dir)?;
    let manifest = StoredManifest {
        version: SESSION_VERSION,
        generation,
        documents: request.manifest.documents,
        active_document_id: request.manifest.active_document_id,
        diff: request.manifest.diff,
        settings: request.manifest.settings,
        recent_files: request.manifest.recent_files,
    };
    let manifest_path = manifests_dir.join(manifest_file_name(generation));
    write_json_file(&manifest_path, &manifest, "无法发布工作区恢复清单。")?;

    if let Err(error) = cleanup_old_generations(root) {
        eprintln!("清理旧会话快照失败: {error}");
    }
    Ok(CommitWorkspaceSessionResult { generation })
}

fn load_at(root: &Path) -> Result<Option<NativeSessionLoadResult>, String> {
    if !root.exists() {
        return Ok(None);
    }
    let manifests_dir = root.join("manifests");
    let documents_dir = root.join("documents");
    let candidates = manifest_candidates(&manifests_dir)?;

    for (generation, path) in candidates {
        if let Ok(manifest) = read_complete_manifest(&path, &documents_dir, generation) {
            return Ok(Some(build_load_result(manifest, &documents_dir)?));
        }
    }

    if directory_contains_files(root)? {
        Err("已找到会话文件，但没有可完整恢复的工作区快照。".to_string())
    } else {
        Ok(None)
    }
}

fn validate_request(request: &CommitWorkspaceSessionRequest) -> Result<(), String> {
    if request.manifest.version != SESSION_VERSION {
        return Err("不支持的会话数据版本。".to_string());
    }
    if !request.manifest.settings.is_object() {
        return Err("会话设置格式无效。".to_string());
    }

    let mut document_ids = HashSet::new();
    let mut references = HashSet::new();
    for document in &request.manifest.documents {
        validate_identifier(&document.id)?;
        validate_identifier(&document.snapshot_id)?;
        let has_valid_collapsed_pane = matches!(
            document.collapsed_pane.as_deref(),
            Some("none") | Some("text") | Some("tree")
        );
        let has_legacy_view = matches!(document.view.as_deref(), Some("text") | Some("tree"));
        if document.language != "json" || (!has_valid_collapsed_pane && !has_legacy_view && document.collapsed_pane.is_some()) {
            return Err("会话文档类型无效。".to_string());
        }
        if !document_ids.insert(document.id.clone()) {
            return Err("会话包含重复的文档标识。".to_string());
        }
        references.insert((document.id.clone(), document.snapshot_id.clone()));
    }

    if let Some(active_id) = &request.manifest.active_document_id {
        validate_identifier(active_id)?;
        if !document_ids.contains(active_id) {
            return Err("活动文档不在会话清单中。".to_string());
        }
    }
    if request.manifest.documents.is_empty()
        && (request.manifest.active_document_id.is_some() || request.manifest.diff.is_some())
    {
        return Err("空会话不能引用活动文档或 Diff。".to_string());
    }
    if let Some(diff) = &request.manifest.diff {
        if diff.left_id == diff.right_id
            || !document_ids.contains(&diff.left_id)
            || !document_ids.contains(&diff.right_id)
        {
            return Err("Diff 引用的文档无效。".to_string());
        }
    }

    let mut changed = HashSet::new();
    for snapshot in &request.changed_documents {
        validate_identifier(&snapshot.document_id)?;
        validate_identifier(&snapshot.snapshot_id)?;
        let key = (snapshot.document_id.clone(), snapshot.snapshot_id.clone());
        if !changed.insert(key.clone()) {
            return Err("提交包含重复的文档快照。".to_string());
        }
        if !references.contains(&key) {
            return Err("提交的文档快照未被会话清单引用。".to_string());
        }
    }
    Ok(())
}

fn validate_identifier(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("会话文档标识格式无效。".to_string());
    }
    Ok(())
}

fn next_generation(manifests_dir: &Path) -> Result<u64, String> {
    manifest_candidates(manifests_dir)?
        .into_iter()
        .map(|(generation, _)| generation)
        .max()
        .unwrap_or(0)
        .checked_add(1)
        .ok_or_else(|| "会话版本号已超出支持范围。".to_string())
}

fn manifest_candidates(directory: &Path) -> Result<Vec<(u64, PathBuf)>, String> {
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let entries = fs::read_dir(directory)
        .map_err(|_| "无法读取会话清单目录。".to_string())?;
    let mut manifests = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name();
            let name = name.to_str()?;
            parse_generation(name).map(|generation| (generation, entry.path()))
        })
        .collect::<Vec<_>>();
    manifests.sort_unstable_by(|left, right| right.0.cmp(&left.0));
    Ok(manifests)
}

fn parse_generation(file_name: &str) -> Option<u64> {
    let digits = file_name
        .strip_prefix(MANIFEST_PREFIX)?
        .strip_suffix(MANIFEST_SUFFIX)?;
    if digits.len() != 20 || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok()
}

fn manifest_file_name(generation: u64) -> String {
    format!("{MANIFEST_PREFIX}{generation:020}{MANIFEST_SUFFIX}")
}

fn snapshot_path(directory: &Path, document_id: &str, snapshot_id: &str) -> PathBuf {
    directory
        .join(format!("doc-{document_id}"))
        .join(format!("snapshot-{snapshot_id}.json"))
}

fn write_json_file<T: Serialize>(
    destination: &Path,
    value: &T,
    error_message: &str,
) -> Result<(), String> {
    if destination.exists() {
        return Err("会话快照标识已存在，请重试。".to_string());
    }
    let serialized = serde_json::to_vec(value).map_err(|_| error_message.to_string())?;
    let parent = destination
        .parent()
        .ok_or_else(|| error_message.to_string())?;
    fs::create_dir_all(parent).map_err(|_| error_message.to_string())?;
    let (mut file, temp) = create_unique_temp_file(parent, error_message)?;
    let result = (|| {
        file.write_all(&serialized)
            .and_then(|_| file.sync_all())
            .map_err(|_| error_message.to_string())?;
        fs::rename(&temp, destination).map_err(|_| error_message.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn create_unique_temp_file(
    parent: &Path,
    error_message: &str,
) -> Result<(fs::File, PathBuf), String> {
    for _ in 0..32 {
        let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = parent.join(format!(
            ".session-{}-{sequence}.tmp",
            std::process::id()
        ));
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => return Ok((file, path)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err(error_message.to_string()),
        }
    }
    Err(error_message.to_string())
}

fn read_complete_manifest(
    path: &Path,
    documents_dir: &Path,
    expected_generation: u64,
) -> Result<StoredManifest, String> {
    let raw = fs::read(path).map_err(|_| "无法读取会话清单。".to_string())?;
    let manifest: StoredManifest =
        serde_json::from_slice(&raw).map_err(|_| "会话清单已损坏。".to_string())?;
    if manifest.version != SESSION_VERSION || manifest.generation != expected_generation {
        return Err("会话清单版本无效。".to_string());
    }
    let request = CommitWorkspaceSessionRequest {
        manifest: NativeSessionManifestInput {
            version: manifest.version,
            documents: manifest.documents.clone(),
            active_document_id: manifest.active_document_id.clone(),
            diff: manifest.diff.clone(),
            settings: manifest.settings.clone(),
            recent_files: manifest.recent_files.clone(),
        },
        changed_documents: Vec::new(),
    };
    validate_request(&request)?;
    for document in &manifest.documents {
        read_snapshot(
            &snapshot_path(documents_dir, &document.id, &document.snapshot_id),
            &document.id,
            &document.snapshot_id,
        )?;
    }
    Ok(manifest)
}

fn read_snapshot(
    path: &Path,
    document_id: &str,
    snapshot_id: &str,
) -> Result<NativeSessionDocumentSnapshot, String> {
    let raw = fs::read(path).map_err(|_| "文档恢复快照缺失。".to_string())?;
    let snapshot: NativeSessionDocumentSnapshot =
        serde_json::from_slice(&raw).map_err(|_| "文档恢复快照已损坏。".to_string())?;
    if snapshot.document_id != document_id || snapshot.snapshot_id != snapshot_id {
        return Err("文档恢复快照引用不匹配。".to_string());
    }
    Ok(snapshot)
}

fn build_load_result(
    manifest: StoredManifest,
    documents_dir: &Path,
) -> Result<NativeSessionLoadResult, String> {
    let mut documents = Vec::with_capacity(manifest.documents.len());
    let mut snapshot_ids = BTreeMap::new();
    for entry in manifest.documents {
        let snapshot = read_snapshot(
            &snapshot_path(documents_dir, &entry.id, &entry.snapshot_id),
            &entry.id,
            &entry.snapshot_id,
        )?;
        // 先按 &entry 归一化 collapsed_pane，再 move 出 snapshot_id：
        // 反过来会先把 entry.snapshot_id 部分 move 掉，导致对 &entry 的借用报 E0382。
        let collapsed_pane = normalize_collapsed_pane(&entry);
        snapshot_ids.insert(entry.id.clone(), entry.snapshot_id);
        documents.push(JsonDocument {
            id: entry.id,
            title: entry.title,
            file_path: entry.file_path,
            content: snapshot.content,
            saved_content: snapshot.saved_content,
            collapsed_pane,
            language: entry.language,
            created_at: entry.created_at,
            updated_at: entry.updated_at,
        });
    }
    Ok(NativeSessionLoadResult {
        generation: manifest.generation,
        workspace: WorkspaceSnapshot {
            documents,
            active_document_id: manifest.active_document_id.unwrap_or_default(),
            diff: manifest.diff,
            settings: manifest.settings,
            recent_files: manifest.recent_files,
        },
        snapshot_ids,
    })
}

fn normalize_collapsed_pane(entry: &ManifestDocumentEntry) -> String {
    match entry.collapsed_pane.as_deref() {
        Some("none") | Some("text") | Some("tree") => entry.collapsed_pane.clone().unwrap(),
        Some(_) => "none".into(),
        None => match entry.view.as_deref() {
            Some("text") => "tree".into(),
            Some("tree") => "text".into(),
            _ => "none".into(),
        },
    }
}

fn cleanup_old_generations(root: &Path) -> Result<(), String> {
    let manifests_dir = root.join("manifests");
    let documents_dir = root.join("documents");
    let mut retained_manifests = Vec::new();
    let mut retained_snapshots = HashSet::new();
    for (generation, path) in manifest_candidates(&manifests_dir)? {
        match read_complete_manifest(&path, &documents_dir, generation) {
            Ok(manifest) if retained_manifests.len() < 2 => {
                retained_snapshots.extend(
                    manifest
                        .documents
                        .iter()
                        .map(|document| (document.id.clone(), document.snapshot_id.clone())),
                );
                retained_manifests.push(path);
            }
            _ => {
                let _ = fs::remove_file(path);
            }
        }
    }

    if documents_dir.exists() {
        let retained_paths = retained_snapshots
            .iter()
            .map(|(document_id, snapshot_id)| {
                snapshot_path(&documents_dir, document_id, snapshot_id)
            })
            .collect::<HashSet<_>>();
        for document_directory in fs::read_dir(&documents_dir)
            .map_err(|_| "无法清理旧文档快照。".to_string())?
            .filter_map(Result::ok)
        {
            let directory_path = document_directory.path();
            if directory_path.is_file() {
                let _ = fs::remove_file(directory_path);
                continue;
            }
            for snapshot in fs::read_dir(&directory_path)
                .map_err(|_| "无法清理旧文档快照。".to_string())?
                .filter_map(Result::ok)
            {
                if !retained_paths.contains(&snapshot.path()) {
                    let _ = fs::remove_file(snapshot.path());
                }
            }
            let _ = fs::remove_dir(directory_path);
        }
    }
    Ok(())
}

fn directory_contains_files(directory: &Path) -> Result<bool, String> {
    if !directory.exists() {
        return Ok(false);
    }
    for entry in fs::read_dir(directory)
        .map_err(|_| "无法检查会话存储目录。".to_string())?
        .filter_map(Result::ok)
    {
        let path = entry.path();
        if path.is_file() || (path.is_dir() && directory_contains_files(&path)?) {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_root(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("系统时钟应晚于 Unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("json-forge-{name}-{}-{nonce}", std::process::id()))
    }

    fn request(content: &str, snapshot_id: &str) -> CommitWorkspaceSessionRequest {
        CommitWorkspaceSessionRequest {
            manifest: NativeSessionManifestInput {
                version: 1,
                documents: vec![ManifestDocumentEntry {
                    id: "doc-1".into(),
                    title: "data.json".into(),
                    file_path: None,
                    collapsed_pane: Some("none".into()),
                    view: None,
                    language: "json".into(),
                    created_at: 1.0,
                    updated_at: 2.0,
                    snapshot_id: snapshot_id.into(),
                }],
                active_document_id: Some("doc-1".into()),
                diff: None,
                settings: serde_json::json!({ "restoreSession": true }),
                recent_files: Vec::new(),
            },
            changed_documents: vec![NativeSessionDocumentSnapshot {
                document_id: "doc-1".into(),
                snapshot_id: snapshot_id.into(),
                content: content.into(),
                saved_content: "".into(),
            }],
        }
    }

    #[test]
    fn maps_legacy_view_to_the_collapsed_pane_without_dropping_the_document() {
        let text_entry = ManifestDocumentEntry {
            id: "doc-text".into(),
            title: "text.json".into(),
            file_path: None,
            collapsed_pane: None,
            view: Some("text".into()),
            language: "json".into(),
            created_at: 1.0,
            updated_at: 2.0,
            snapshot_id: "snap-text".into(),
        };
        let tree_entry = ManifestDocumentEntry {
            id: "doc-tree".into(),
            title: "tree.json".into(),
            file_path: None,
            collapsed_pane: None,
            view: Some("tree".into()),
            language: "json".into(),
            created_at: 1.0,
            updated_at: 2.0,
            snapshot_id: "snap-tree".into(),
        };

        assert_eq!(normalize_collapsed_pane(&text_entry), "tree");
        assert_eq!(normalize_collapsed_pane(&tree_entry), "text");
        assert_eq!(normalize_collapsed_pane(&ManifestDocumentEntry {
            view: None,
            ..text_entry
        }), "none");
    }

    #[test]
    fn commits_and_loads_a_workspace() {
        let root = test_root("roundtrip");
        let committed = commit_at(&root, request("{\"ok\":true}", "snap-1")).unwrap();
        let loaded = load_at(&root).unwrap().unwrap();
        assert_eq!(committed.generation, 1);
        assert_eq!(loaded.generation, 1);
        assert_eq!(loaded.workspace.documents[0].content, "{\"ok\":true}");
        assert_eq!(loaded.snapshot_ids.get("doc-1"), Some(&"snap-1".to_string()));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn reuses_unchanged_snapshot_and_falls_back_from_corrupt_latest_manifest() {
        let root = test_root("fallback");
        commit_at(&root, request("first", "snap-1")).unwrap();
        let mut second = request("unused", "snap-1");
        second.changed_documents.clear();
        commit_at(&root, second).unwrap();
        fs::write(
            root.join("manifests").join(manifest_file_name(2)),
            b"not-json",
        )
        .unwrap();

        let loaded = load_at(&root).unwrap().unwrap();
        assert_eq!(loaded.generation, 1);
        assert_eq!(loaded.workspace.documents[0].content, "first");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn ignores_unpublished_orphans_and_rejects_invalid_identifiers() {
        let root = test_root("validation");
        commit_at(&root, request("first", "snap-1")).unwrap();
        fs::write(root.join("documents").join("orphan.json"), b"partial").unwrap();
        assert_eq!(load_at(&root).unwrap().unwrap().generation, 1);

        let mut invalid = request("second", "snap-2");
        invalid.manifest.documents[0].id = "../escape".into();
        invalid.changed_documents[0].document_id = "../escape".into();
        assert!(commit_at(&root, invalid).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn keeps_two_complete_generations_and_cleans_old_snapshots() {
        let root = test_root("cleanup");
        for generation in 1..=3 {
            commit_at(
                &root,
                request(&format!("version-{generation}"), &format!("snap-{generation}")),
            )
            .unwrap();
        }
        assert_eq!(manifest_candidates(&root.join("manifests")).unwrap().len(), 2);
        let document_files = fs::read_dir(root.join("documents").join("doc-doc-1"))
            .unwrap()
            .filter_map(Result::ok)
            .count();
        assert_eq!(document_files, 2);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn supports_maximum_length_ids_without_one_oversized_file_name() {
        let root = test_root("long-identifiers");
        let long_document_id = "d".repeat(128);
        let long_snapshot_id = "s".repeat(128);
        let mut long = request("content", &long_snapshot_id);
        long.manifest.documents[0].id = long_document_id.clone();
        long.manifest.active_document_id = Some(long_document_id.clone());
        long.changed_documents[0].document_id = long_document_id.clone();
        commit_at(&root, long).unwrap();

        let path = snapshot_path(
            &root.join("documents"),
            &long_document_id,
            &long_snapshot_id,
        );
        assert!(path.exists());
        assert!(path.file_name().unwrap().len() < 255);
        let _ = fs::remove_dir_all(root);
    }
}
