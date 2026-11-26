use crate::i18n;
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

fn is_false(v: &bool) -> bool {
    !*v
}

fn clean_env_map(env: BTreeMap<String, String>) -> BTreeMap<String, String> {
    env.into_iter()
        .filter_map(|(k, v)| {
            let trimmed = k.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some((trimmed.to_string(), v))
            }
        })
        .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCommand {
    pub id: String,
    pub name: String,
    pub command: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shell: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub env: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub auto_start: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProjectConfig {
    pub id: String,
    pub name: String,
    pub cwd: String,
    #[serde(default)]
    pub command: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shell: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub commands: Vec<ProjectCommand>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub env: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "is_false", rename = "autoStart")]
    pub auto_start: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedCommand {
    pub session_key: String,
    pub project_id: String,
    pub command_id: Option<String>,
    pub display_name: String,
    pub cwd: String,
    pub command: String,
    pub shell: Option<String>,
    pub url: Option<String>,
    pub env: BTreeMap<String, String>,
}

pub fn make_session_key(project_id: &str, command_id: Option<&str>) -> String {
    match command_id.map(str::trim).filter(|s| !s.is_empty()) {
        Some(cid) => format!("{}::{}", project_id, cid),
        None => project_id.to_string(),
    }
}

pub fn resolve_command_cwd(project_cwd: &str, cmd_cwd: Option<&str>) -> String {
    let Some(sub) = cmd_cwd.map(str::trim).filter(|s| !s.is_empty()) else {
        return project_cwd.to_string();
    };
    let sub_path = Path::new(sub);
    if sub_path.is_absolute() {
        sub_path.to_string_lossy().to_string()
    } else {
        Path::new(project_cwd)
            .join(sub_path)
            .to_string_lossy()
            .to_string()
    }
}

impl ProjectConfig {
    pub fn resolve_command(&self, command_id: Option<&str>) -> Result<ResolvedCommand, String> {
        let requested_id = command_id.map(str::trim).filter(|s| !s.is_empty());

        if self.commands.is_empty() {
            if let Some(cid) = requested_id {
                return Err(if i18n::is_en() {
                    format!(
                        "Project \"{}\" has no multi-command list configured; cannot launch commandId \"{}\"",
                        self.name, cid
                    )
                } else {
                    format!(
                        "项目「{}」未配置多命令列表，无法按 commandId「{}」启动",
                        self.name, cid
                    )
                });
            }
            if self.command.trim().is_empty() {
                return Err(if i18n::is_en() {
                    format!("Project \"{}\" is missing a start command", self.name)
                } else {
                    format!("项目「{}」缺少启动命令", self.name)
                });
            }
            return Ok(ResolvedCommand {
                session_key: self.id.clone(),
                project_id: self.id.clone(),
                command_id: None,
                display_name: self.name.clone(),
                cwd: self.cwd.clone(),
                command: self.command.clone(),
                shell: self.shell.clone(),
                url: self.url.clone(),
                env: self.env.clone(),
            });
        }

        let cmd = match requested_id {
            Some(cid) => self.commands.iter().find(|c| c.id == cid).ok_or_else(|| {
                if i18n::is_en() {
                    format!("Launch mode \"{}\" not found in project \"{}\"", cid, self.name)
                } else {
                    format!("项目「{}」中未找到启动模式: {}", self.name, cid)
                }
            })?,
            None => &self.commands[0],
        };

        let mut merged_env = self.env.clone();
        for (k, v) in &cmd.env {
            merged_env.insert(k.clone(), v.clone());
        }

        Ok(ResolvedCommand {
            session_key: make_session_key(&self.id, Some(&cmd.id)),
            project_id: self.id.clone(),
            command_id: Some(cmd.id.clone()),
            display_name: format!("{} · {}", self.name, cmd.name),
            cwd: resolve_command_cwd(&self.cwd, cmd.cwd.as_deref()),
            command: cmd.command.clone(),
            shell: cmd.shell.clone().or_else(|| self.shell.clone()),
            url: cmd.url.clone().or_else(|| self.url.clone()),
            env: merged_env,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BindingTarget {
    pub project_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LaunchBinding {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub targets: Vec<BindingTarget>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub sequential: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delay_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub auto_start: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProjectsFile {
    pub projects: Vec<ProjectConfig>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub groups: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub bindings: Vec<LaunchBinding>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPayload {
    pub projects: Vec<ProjectConfig>,
    pub groups: Vec<String>,
    pub bindings: Vec<LaunchBinding>,
    pub config_path: String,
    pub error: Option<String>,
}

pub fn config_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir()
        .ok_or_else(|| i18n::tr("无法获取用户主目录", "Cannot determine user home directory").to_string())?;
    Ok(home.join(".dev-panel"))
}

pub fn default_projects() -> Vec<ProjectConfig> {
    let home_cwd = dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| {
            if cfg!(windows) {
                "C:\\".to_string()
            } else {
                "/tmp".to_string()
            }
        });

    #[cfg(windows)]
    let (demo_shell, demo_cmd, sample_cmd) = (
        Some("powershell.exe".to_string()),
        "for ($i=1; $i -le 600; $i++) { Write-Host \"[Demo] tick #$i - $(Get-Date -Format HH:mm:ss)\" -ForegroundColor Cyan; Start-Sleep 1 }".to_string(),
        i18n::tr(
            "Write-Host '请在 ~/.dev-panel/projects.json 或左侧边栏修改为你的真实项目配置' -ForegroundColor Green; Start-Sleep 2",
            "Write-Host 'Edit ~/.dev-panel/projects.json or use the sidebar to add your real projects' -ForegroundColor Green; Start-Sleep 2",
        ).to_string(),
    );

    #[cfg(not(windows))]
    let (demo_shell, demo_cmd, sample_cmd) = (
        None,
        "i=1; while [ $i -le 600 ]; do printf \"\\033[36m[Demo] tick #%d - %s\\033[0m\\n\" \"$i\" \"$(date +%T)\"; i=$((i+1)); sleep 1; done".to_string(),
        i18n::tr(
            "printf \"\\033[32m请在 ~/.dev-panel/projects.json 或左侧边栏修改为你的真实项目配置\\033[0m\\n\"; sleep 2",
            "printf \"\\033[32mEdit ~/.dev-panel/projects.json or use the sidebar to add your real projects\\033[0m\\n\"; sleep 2",
        ).to_string(),
    );

    vec![
        ProjectConfig {
            id: "demo-ticker".to_string(),
            name: "Demo Ticker".to_string(),
            cwd: home_cwd.clone(),
            command: demo_cmd,
            shell: demo_shell.clone(),
            url: None,
            group: None,
            commands: Vec::new(),
            env: BTreeMap::new(),
            auto_start: false,
        },
        ProjectConfig {
            id: "sample-web".to_string(),
            name: "Sample Web App".to_string(),
            cwd: home_cwd,
            command: sample_cmd,
            shell: demo_shell,
            url: Some("http://localhost:5173".to_string()),
            group: None,
            commands: Vec::new(),
            env: BTreeMap::new(),
            auto_start: false,
        },
    ]
}

fn validate_project(p: &ProjectConfig) -> Result<(), String> {
    if p.id.trim().is_empty() {
        return Err(i18n::tr("项目缺少有效的 id", "Project is missing a valid id").to_string());
    }
    if p.id.contains("::") {
        return Err(if i18n::is_en() {
            format!("Project '{}' id cannot contain '::'", p.id)
        } else {
            format!("项目 '{}' 的 id 不能包含 '::'", p.id)
        });
    }
    if p.name.trim().is_empty() {
        return Err(if i18n::is_en() {
            format!("Project '{}' is missing name", p.id)
        } else {
            format!("项目 '{}' 缺少 name", p.id)
        });
    }
    if p.cwd.trim().is_empty() {
        return Err(if i18n::is_en() {
            format!("Project '{}' is missing cwd", p.id)
        } else {
            format!("项目 '{}' 缺少 cwd", p.id)
        });
    }

    if p.commands.is_empty() {
        if p.command.trim().is_empty() {
            return Err(if i18n::is_en() {
                format!("Project '{}' is missing command", p.id)
            } else {
                format!("项目 '{}' 缺少 command", p.id)
            });
        }
    } else {
        let mut seen_cmds = HashSet::new();
        for (c_idx, cmd) in p.commands.iter().enumerate() {
            if cmd.id.trim().is_empty() {
                return Err(if i18n::is_en() {
                    format!("Command #{} in project '{}' is missing id", c_idx + 1, p.id)
                } else {
                    format!("项目 '{}' 的第 {} 个命令缺少 id", p.id, c_idx + 1)
                });
            }
            if cmd.id.contains("::") {
                return Err(if i18n::is_en() {
                    format!(
                        "Command '{}' id in project '{}' cannot contain '::'",
                        cmd.id, p.id
                    )
                } else {
                    format!("项目 '{}' 的命令 '{}' id 不能包含 '::'", p.id, cmd.id)
                });
            }
            if cmd.name.trim().is_empty() {
                return Err(if i18n::is_en() {
                    format!("Command '{}' in project '{}' is missing name", cmd.id, p.id)
                } else {
                    format!("项目 '{}' 的命令 '{}' 缺少 name", p.id, cmd.id)
                });
            }
            if cmd.command.trim().is_empty() {
                return Err(if i18n::is_en() {
                    format!(
                        "Command '{}' in project '{}' is missing command",
                        cmd.id, p.id
                    )
                } else {
                    format!("项目 '{}' 的命令 '{}' 缺少 command", p.id, cmd.id)
                });
            }
            if !seen_cmds.insert(cmd.id.clone()) {
                return Err(if i18n::is_en() {
                    format!("Project '{}' has duplicate command id: '{}'", p.id, cmd.id)
                } else {
                    format!("项目 '{}' 存在重复的命令 id: '{}'", p.id, cmd.id)
                });
            }
        }
    }

    Ok(())
}

fn normalize_groups(groups: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for raw in groups {
        let trimmed = raw.trim();
        if !trimmed.is_empty() && seen.insert(trimmed.to_string()) {
            out.push(trimmed.to_string());
        }
    }
    out
}

fn validate_and_normalize_binding(mut binding: LaunchBinding) -> Result<LaunchBinding, String> {
    binding.id = binding.id.trim().to_string();
    binding.name = binding.name.trim().to_string();
    binding.description = binding
        .description
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    if binding.id.is_empty() {
        return Err(
            i18n::tr("绑定方案缺少有效的 id", "Launch binding is missing a valid id").to_string(),
        );
    }
    if binding.name.is_empty() {
        return Err(if i18n::is_en() {
            format!("Launch binding '{}' is missing name", binding.id)
        } else {
            format!("绑定方案 '{}' 缺少名称", binding.id)
        });
    }

    let mut seen_targets = HashSet::new();
    let mut normalized_targets = Vec::new();
    for t in binding.targets {
        let project_id = t.project_id.trim().to_string();
        if project_id.is_empty() {
            return Err(if i18n::is_en() {
                format!("Launch binding '{}' contains an empty projectId", binding.name)
            } else {
                format!("绑定方案 '{}' 包含空的 projectId", binding.name)
            });
        }
        let command_id = t
            .command_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        if seen_targets.insert((project_id.clone(), command_id.clone())) {
            normalized_targets.push(BindingTarget {
                project_id,
                command_id,
            });
        }
    }

    if normalized_targets.is_empty() {
        return Err(if i18n::is_en() {
            format!(
                "Launch binding \"{}\" must include at least one target",
                binding.name
            )
        } else {
            format!("绑定方案「{}」至少需要选择一个启动项", binding.name)
        });
    }

    binding.targets = normalized_targets;
    Ok(binding)
}

pub fn parse_config_json(content: &str) -> Result<ProjectsFile, String> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Err(i18n::tr("配置文件内容为空", "Configuration file is empty").to_string());
    }

    let mut file = match serde_json::from_str::<ProjectsFile>(trimmed) {
        Ok(file) => file,
        Err(obj_err) => match serde_json::from_str::<Vec<ProjectConfig>>(trimmed) {
            Ok(list) => ProjectsFile {
                projects: list,
                groups: Vec::new(),
                bindings: Vec::new(),
            },
            Err(_) => {
                return Err(if i18n::is_en() {
                    format!("JSON parse error: {}", obj_err)
                } else {
                    format!("JSON 解析失败: {}", obj_err)
                });
            }
        },
    };

    let mut seen_projects = HashSet::new();
    for (idx, p) in file.projects.iter_mut().enumerate() {
        p.id = p.id.trim().to_string();
        p.group = p
            .group
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        p.env = clean_env_map(std::mem::take(&mut p.env));
        for cmd in &mut p.commands {
            cmd.env = clean_env_map(std::mem::take(&mut cmd.env));
        }
        validate_project(p).map_err(|err| {
            if i18n::is_en() {
                format!("Item #{} validation failed: {}", idx + 1, err)
            } else {
                format!("第 {} 项校验失败: {}", idx + 1, err)
            }
        })?;
        if !seen_projects.insert(p.id.clone()) {
            return Err(if i18n::is_en() {
                format!("Duplicate project id: '{}'", p.id)
            } else {
                format!("存在重复的项目 id: '{}'", p.id)
            });
        }
    }

    file.groups = normalize_groups(file.groups);
    for p in &file.projects {
        if let Some(ref g) = p.group
            && !file.groups.iter().any(|existing| existing == g)
        {
            file.groups.push(g.clone());
        }
    }

    let mut seen_bindings = HashSet::new();
    let mut normalized_bindings = Vec::with_capacity(file.bindings.len());
    for (idx, b) in file.bindings.into_iter().enumerate() {
        let normalized = validate_and_normalize_binding(b).map_err(|err| {
            if i18n::is_en() {
                format!("Binding #{} validation failed: {}", idx + 1, err)
            } else {
                format!("第 {} 个绑定方案校验失败: {}", idx + 1, err)
            }
        })?;
        if !seen_bindings.insert(normalized.id.clone()) {
            return Err(if i18n::is_en() {
                format!("Duplicate binding id: '{}'", normalized.id)
            } else {
                format!("存在重复的绑定方案 id: '{}'", normalized.id)
            });
        }
        normalized_bindings.push(normalized);
    }
    file.bindings = normalized_bindings;

    Ok(file)
}

pub fn ensure_config_file() -> Result<PathBuf, String> {
    let dir = config_dir()?;
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("创建配置目录失败: {}", e))?;
    }

    let path = dir.join("projects.json");
    if !path.exists() {
        let initial = ProjectsFile {
            projects: default_projects(),
            groups: Vec::new(),
            bindings: Vec::new(),
        };
        let json = serde_json::to_string_pretty(&initial)
            .map_err(|e| format!("序列化默认配置失败: {}", e))?;
        fs::write(&path, json).map_err(|e| format!("写入默认配置文件失败: {}", e))?;
    }

    Ok(path)
}

pub fn save_config_atomic(path: &Path, data: &ProjectsFile) -> Result<(), String> {
    if let Some(parent) = path.parent()
        && !parent.exists()
    {
        fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {}", e))?;
    }

    let json =
        serde_json::to_string_pretty(data).map_err(|e| format!("序列化配置失败: {}", e))?;

    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, &json).map_err(|e| format!("写入临时配置文件失败: {}", e))?;

    if let Err(rename_err) = fs::rename(&tmp_path, path) {
        if let Err(write_err) = fs::write(path, &json) {
            let _ = fs::remove_file(&tmp_path);
            return Err(format!(
                "保存配置文件失败 (rename: {}; write: {})",
                rename_err, write_err
            ));
        }
        let _ = fs::remove_file(&tmp_path);
    }

    Ok(())
}

pub struct ConfigManager {
    config_path: PathBuf,
    data: Arc<Mutex<ProjectsFile>>,
    last_error: Arc<Mutex<Option<String>>>,
    _watcher: Mutex<Option<RecommendedWatcher>>,
}

impl ConfigManager {
    pub fn init(app_handle: AppHandle) -> Result<Self, String> {
        let config_path = ensure_config_file()?;
        let initial_content = fs::read_to_string(&config_path)
            .map_err(|e| format!("读取配置文件失败: {}", e))?;

        let (initial_data, initial_error) = match parse_config_json(&initial_content) {
            Ok(parsed) => (parsed, None),
            Err(err) => (ProjectsFile::default(), Some(err)),
        };

        let data = Arc::new(Mutex::new(initial_data));
        let last_error = Arc::new(Mutex::new(initial_error));

        let watcher = Self::start_watcher(
            app_handle,
            config_path.clone(),
            Arc::clone(&data),
            Arc::clone(&last_error),
        )?;

        Ok(Self {
            config_path,
            data,
            last_error,
            _watcher: Mutex::new(Some(watcher)),
        })
    }

    fn start_watcher(
        app_handle: AppHandle,
        config_path: PathBuf,
        data: Arc<Mutex<ProjectsFile>>,
        last_error: Arc<Mutex<Option<String>>>,
    ) -> Result<RecommendedWatcher, String> {
        let watch_dir = config_path
            .parent()
            .ok_or_else(|| "无法解析配置目录".to_string())?
            .to_path_buf();

        let (tx, rx) = mpsc::channel::<()>();

        let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                let is_relevant = !matches!(event.kind, EventKind::Access(_));
                if !is_relevant {
                    return;
                }
                let touches_target = event.paths.iter().any(|p| {
                    p.file_name()
                        .and_then(|n| n.to_str())
                        .map(|n| n.eq_ignore_ascii_case("projects.json"))
                        .unwrap_or(false)
                });
                if touches_target {
                    let _ = tx.send(());
                }
            }
        })
        .map_err(|e| format!("初始化配置文件监听器失败: {}", e))?;

        watcher
            .watch(&watch_dir, RecursiveMode::NonRecursive)
            .map_err(|e| format!("监听配置目录失败: {}", e))?;

        thread::spawn(move || {
            while rx.recv().is_ok() {
                // Debounce bursts of write/rename events
                while rx.recv_timeout(Duration::from_millis(200)).is_ok() {}

                let mut parsed = Self::read_and_parse(&config_path);
                if parsed.is_err() {
                    // Retry once briefly in case an external writer has not finished flushing
                    thread::sleep(Duration::from_millis(80));
                    parsed = Self::read_and_parse(&config_path);
                }

                let payload = match parsed {
                    Ok(new_data) => {
                        let mut changed = false;
                        if let Ok(mut guard) = data.lock()
                            && *guard != new_data
                        {
                            *guard = new_data.clone();
                            changed = true;
                        }
                        if let Ok(mut err_guard) = last_error.lock()
                            && err_guard.is_some()
                        {
                            *err_guard = None;
                            changed = true;
                        }
                        if !changed {
                            continue;
                        }
                        ConfigPayload {
                            projects: new_data.projects,
                            groups: new_data.groups,
                            bindings: new_data.bindings,
                            config_path: config_path.to_string_lossy().to_string(),
                            error: None,
                        }
                    }
                    Err(err) => {
                        if let Ok(mut err_guard) = last_error.lock() {
                            *err_guard = Some(err.clone());
                        }
                        let current = data.lock().map(|g| g.clone()).unwrap_or_default();
                        ConfigPayload {
                            projects: current.projects,
                            groups: current.groups,
                            bindings: current.bindings,
                            config_path: config_path.to_string_lossy().to_string(),
                            error: Some(err),
                        }
                    }
                };

                let _ = app_handle.emit("config-updated", payload);
            }
        });

        Ok(watcher)
    }

    fn read_and_parse(path: &Path) -> Result<ProjectsFile, String> {
        let content = fs::read_to_string(path).map_err(|e| format!("读取配置文件失败: {}", e))?;
        parse_config_json(&content)
    }

    fn build_payload(&self, data: &ProjectsFile, error: Option<String>) -> ConfigPayload {
        ConfigPayload {
            projects: data.projects.clone(),
            groups: data.groups.clone(),
            bindings: data.bindings.clone(),
            config_path: self.config_path.to_string_lossy().to_string(),
            error,
        }
    }

    fn commit_update(&self, updated: ProjectsFile) -> Result<ConfigPayload, String> {
        let mut guard = self.data.lock().map_err(|_| "配置锁异常".to_string())?;
        save_config_atomic(&self.config_path, &updated)?;
        *guard = updated.clone();
        drop(guard);

        if let Ok(mut err_guard) = self.last_error.lock() {
            *err_guard = None;
        }

        Ok(self.build_payload(&updated, None))
    }

    pub fn get_payload(&self) -> ConfigPayload {
        let current = self.data.lock().map(|g| g.clone()).unwrap_or_default();
        let error = self.last_error.lock().ok().and_then(|g| g.clone());
        self.build_payload(&current, error)
    }

    pub fn get_project(&self, id: &str) -> Option<ProjectConfig> {
        self.data
            .lock()
            .ok()
            .and_then(|g| g.projects.iter().find(|p| p.id == id).cloned())
    }

    pub fn upsert_project(
        &self,
        mut project: ProjectConfig,
        previous_id: Option<&str>,
    ) -> Result<ConfigPayload, String> {
        project.id = project.id.trim().to_string();
        if !project.commands.is_empty() && project.command.trim().is_empty() {
            project.command = project.commands[0].command.clone();
        }
        project.group = project
            .group
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        project.env = clean_env_map(std::mem::take(&mut project.env));
        for cmd in &mut project.commands {
            cmd.env = clean_env_map(std::mem::take(&mut cmd.env));
        }
        validate_project(&project)?;

        let mut updated = {
            let guard = self.data.lock().map_err(|_| "配置锁异常".to_string())?;
            guard.clone()
        };

        if let Some(ref group_name) = project.group
            && !updated.groups.iter().any(|g| g == group_name)
        {
            updated.groups.push(group_name.clone());
        }

        let prev_trimmed = previous_id.map(str::trim).filter(|s| !s.is_empty());
        if let Some(old_id) = prev_trimmed
            && old_id != project.id
        {
            if updated.projects.iter().any(|p| p.id == project.id) {
                return Err(if i18n::is_en() {
                    format!("Project ID '{}' already exists", project.id)
                } else {
                    format!("项目 ID '{}' 已存在，请更换", project.id)
                });
            }
            let new_id = project.id.clone();
            if let Some(existing) = updated.projects.iter_mut().find(|p| p.id == old_id) {
                *existing = project;
            } else {
                updated.projects.push(project);
            }
            for binding in &mut updated.bindings {
                for target in &mut binding.targets {
                    if target.project_id == old_id {
                        target.project_id = new_id.clone();
                    }
                }
            }
        } else if let Some(existing) = updated.projects.iter_mut().find(|p| p.id == project.id) {
            *existing = project;
        } else {
            updated.projects.push(project);
        }

        self.commit_update(updated)
    }

    pub fn delete_project(&self, id: &str) -> Result<ConfigPayload, String> {
        let mut updated = {
            let guard = self
                .data
                .lock()
                .map_err(|_| i18n::tr("配置锁异常", "Config lock poisoned").to_string())?;
            guard.clone()
        };

        updated.projects.retain(|p| p.id != id);
        for binding in &mut updated.bindings {
            binding.targets.retain(|t| t.project_id != id);
        }
        updated.bindings.retain(|b| !b.targets.is_empty());

        self.commit_update(updated)
    }

    pub fn create_group(&self, name: &str) -> Result<ConfigPayload, String> {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(
                i18n::tr("分组名称不能为空", "Group name cannot be empty").to_string(),
            );
        }

        let mut updated = {
            let guard = self
                .data
                .lock()
                .map_err(|_| i18n::tr("配置锁异常", "Config lock poisoned").to_string())?;
            guard.clone()
        };

        if updated.groups.iter().any(|g| g == trimmed) {
            return Err(if i18n::is_en() {
                format!("Group \"{}\" already exists", trimmed)
            } else {
                format!("分组「{}」已存在", trimmed)
            });
        }

        updated.groups.push(trimmed.to_string());
        self.commit_update(updated)
    }

    pub fn rename_group(&self, old_name: &str, new_name: &str) -> Result<ConfigPayload, String> {
        let old_trimmed = old_name.trim();
        let new_trimmed = new_name.trim();
        if old_trimmed.is_empty() || new_trimmed.is_empty() {
            return Err(
                i18n::tr("分组名称不能为空", "Group name cannot be empty").to_string(),
            );
        }

        let mut updated = {
            let guard = self
                .data
                .lock()
                .map_err(|_| i18n::tr("配置锁异常", "Config lock poisoned").to_string())?;
            guard.clone()
        };

        let Some(pos) = updated.groups.iter().position(|g| g == old_trimmed) else {
            return Err(if i18n::is_en() {
                format!("Group \"{}\" not found", old_trimmed)
            } else {
                format!("未找到分组「{}」", old_trimmed)
            });
        };

        if old_trimmed == new_trimmed {
            return Ok(self.build_payload(&updated, None));
        }

        if updated.groups.iter().any(|g| g == new_trimmed) {
            return Err(if i18n::is_en() {
                format!("Group \"{}\" already exists", new_trimmed)
            } else {
                format!("分组「{}」已存在", new_trimmed)
            });
        }

        updated.groups[pos] = new_trimmed.to_string();
        for p in &mut updated.projects {
            if p.group.as_deref() == Some(old_trimmed) {
                p.group = Some(new_trimmed.to_string());
            }
        }

        self.commit_update(updated)
    }

    pub fn delete_group(&self, name: &str) -> Result<ConfigPayload, String> {
        let trimmed = name.trim();
        let mut updated = {
            let guard = self.data.lock().map_err(|_| "配置锁异常".to_string())?;
            guard.clone()
        };

        updated.groups.retain(|g| g != trimmed);
        for p in &mut updated.projects {
            if p.group.as_deref() == Some(trimmed) {
                p.group = None;
            }
        }

        self.commit_update(updated)
    }

    pub fn upsert_binding(&self, binding: LaunchBinding) -> Result<ConfigPayload, String> {
        let normalized = validate_and_normalize_binding(binding)?;

        let mut updated = {
            let guard = self.data.lock().map_err(|_| "配置锁异常".to_string())?;
            guard.clone()
        };

        if let Some(existing) = updated.bindings.iter_mut().find(|b| b.id == normalized.id) {
            *existing = normalized;
        } else {
            updated.bindings.push(normalized);
        }

        self.commit_update(updated)
    }

    pub fn delete_binding(&self, id: &str) -> Result<ConfigPayload, String> {
        let mut updated = {
            let guard = self.data.lock().map_err(|_| "配置锁异常".to_string())?;
            guard.clone()
        };

        updated.bindings.retain(|b| b.id != id);
        self.commit_update(updated)
    }

    pub fn reorder_projects(&self, ordered_ids: &[String]) -> Result<ConfigPayload, String> {
        let mut updated = {
            let guard = self.data.lock().map_err(|_| "配置锁异常".to_string())?;
            guard.clone()
        };
        let mut remaining = std::mem::take(&mut updated.projects);
        let mut reordered = Vec::with_capacity(remaining.len());
        for id in ordered_ids {
            if let Some(pos) = remaining.iter().position(|p| &p.id == id) {
                reordered.push(remaining.remove(pos));
            }
        }
        reordered.extend(remaining);
        updated.projects = reordered;
        self.commit_update(updated)
    }

    pub fn reorder_groups(&self, ordered_names: &[String]) -> Result<ConfigPayload, String> {
        let mut updated = {
            let guard = self.data.lock().map_err(|_| "配置锁异常".to_string())?;
            guard.clone()
        };
        let mut remaining = std::mem::take(&mut updated.groups);
        let mut reordered = Vec::with_capacity(remaining.len());
        for name in ordered_names {
            if let Some(pos) = remaining.iter().position(|g| g == name) {
                reordered.push(remaining.remove(pos));
            }
        }
        reordered.extend(remaining);
        updated.groups = reordered;
        self.commit_update(updated)
    }

    pub fn reorder_bindings(&self, ordered_ids: &[String]) -> Result<ConfigPayload, String> {
        let mut updated = {
            let guard = self.data.lock().map_err(|_| "配置锁异常".to_string())?;
            guard.clone()
        };
        let mut remaining = std::mem::take(&mut updated.bindings);
        let mut reordered = Vec::with_capacity(remaining.len());
        for id in ordered_ids {
            if let Some(pos) = remaining.iter().position(|b| &b.id == id) {
                reordered.push(remaining.remove(pos));
            }
        }
        reordered.extend(remaining);
        updated.bindings = reordered;
        self.commit_update(updated)
    }

    pub fn export_json(&self) -> Result<String, String> {
        let guard = self.data.lock().map_err(|_| "配置锁异常".to_string())?;
        serde_json::to_string_pretty(&*guard).map_err(|e| format!("序列化配置失败: {}", e))
    }

    pub fn import_json(&self, raw: &str, replace: bool) -> Result<ConfigPayload, String> {
        let imported = parse_config_json(raw)?;
        if replace {
            return self.commit_update(imported);
        }

        let mut updated = {
            let guard = self.data.lock().map_err(|_| "配置锁异常".to_string())?;
            guard.clone()
        };

        for g in imported.groups {
            if !updated.groups.iter().any(|existing| existing == &g) {
                updated.groups.push(g);
            }
        }
        for p in imported.projects {
            if let Some(existing) = updated.projects.iter_mut().find(|item| item.id == p.id) {
                *existing = p;
            } else {
                updated.projects.push(p);
            }
        }
        for b in imported.bindings {
            if let Some(existing) = updated.bindings.iter_mut().find(|item| item.id == b.id) {
                *existing = b;
            } else {
                updated.bindings.push(b);
            }
        }

        self.commit_update(updated)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_projects_json(content: &str) -> Result<Vec<ProjectConfig>, String> {
        parse_config_json(content).map(|f| f.projects)
    }

    #[test]
    fn parses_object_wrapped_projects() {
        let json = r#"{
            "projects": [
                {
                    "id": "web",
                    "name": "Web",
                    "cwd": "D:/Code/web",
                    "command": "npm run dev",
                    "shell": "powershell.exe",
                    "url": "http://localhost:5173",
                    "group": "Frontend"
                }
            ]
        }"#;
        let parsed = parse_projects_json(json).expect("should parse object wrapper");
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].id, "web");
        assert_eq!(parsed[0].group.as_deref(), Some("Frontend"));
    }

    #[test]
    fn parses_plain_array_projects() {
        let json = r#"[
            {
                "id": "api",
                "name": "API",
                "cwd": "D:/Code/api",
                "command": "cargo run"
            }
        ]"#;
        let parsed = parse_projects_json(json).expect("should parse plain array");
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].id, "api");
        assert_eq!(parsed[0].shell, None);
    }

    #[test]
    fn rejects_invalid_or_duplicate_projects() {
        assert!(parse_projects_json("{ invalid json").is_err());
        let dup = r#"{
            "projects": [
                { "id": "dup", "name": "A", "cwd": "D:/a", "command": "echo 1" },
                { "id": "dup", "name": "B", "cwd": "D:/b", "command": "echo 2" }
            ]
        }"#;
        assert!(parse_projects_json(dup).is_err());
    }

    #[test]
    fn parses_multi_command_projects_with_or_without_top_command() {
        let json = r#"{
            "projects": [
                {
                    "id": "rpa-edge",
                    "name": "liyin-rpa-edge",
                    "cwd": "D:/Code/liyin-rpa-edge",
                    "commands": [
                        { "id": "studio", "name": "Studio Dev", "command": "npm run dev" },
                        { "id": "tray", "name": "Agent Tray", "command": "cargo run -p liyin-agent-app", "cwd": "agent-host" }
                    ]
                }
            ]
        }"#;
        let parsed = parse_projects_json(json).expect("should parse multi-command project");
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].commands.len(), 2);
        assert_eq!(parsed[0].command, "");

        let first = parsed[0].resolve_command(None).unwrap();
        assert_eq!(first.session_key, "rpa-edge::studio");
        assert_eq!(first.cwd, "D:/Code/liyin-rpa-edge");
        assert_eq!(first.command, "npm run dev");

        let second = parsed[0].resolve_command(Some("tray")).unwrap();
        assert_eq!(second.session_key, "rpa-edge::tray");
        assert_eq!(
            PathBuf::from(&second.cwd),
            Path::new("D:/Code/liyin-rpa-edge").join("agent-host")
        );
        assert_eq!(second.command, "cargo run -p liyin-agent-app");
    }

    #[test]
    fn rejects_duplicate_or_invalid_command_ids() {
        let dup_cmd = r#"{
            "projects": [
                {
                    "id": "proj",
                    "name": "Proj",
                    "cwd": "D:/proj",
                    "commands": [
                        { "id": "dev", "name": "A", "command": "npm run dev" },
                        { "id": "dev", "name": "B", "command": "npm run start" }
                    ]
                }
            ]
        }"#;
        assert!(parse_projects_json(dup_cmd).is_err());

        let bad_cmd_id = r#"{
            "projects": [
                {
                    "id": "proj",
                    "name": "Proj",
                    "cwd": "D:/proj",
                    "commands": [
                        { "id": "a::b", "name": "A", "command": "npm run dev" }
                    ]
                }
            ]
        }"#;
        assert!(parse_projects_json(bad_cmd_id).is_err());
    }

    #[test]
    fn resolves_single_and_multi_command_with_fallbacks() {
        let single = ProjectConfig {
            id: "web".to_string(),
            name: "Web".to_string(),
            cwd: "D:/web".to_string(),
            command: "npm run dev".to_string(),
            shell: Some("pwsh.exe".to_string()),
            url: Some("http://localhost:5173".to_string()),
            group: None,
            commands: Vec::new(),
            env: BTreeMap::from([
                ("NODE_ENV".to_string(), "development".to_string()),
                ("PORT".to_string(), "5173".to_string()),
            ]),
            auto_start: false,
        };
        let res = single.resolve_command(None).unwrap();
        assert_eq!(res.session_key, "web");
        assert_eq!(res.command_id, None);
        assert_eq!(res.env.get("PORT").map(String::as_str), Some("5173"));
        assert!(single.resolve_command(Some("other")).is_err());

        let multi = ProjectConfig {
            id: "edge".to_string(),
            name: "Edge".to_string(),
            cwd: "D:/edge".to_string(),
            command: "npm run dev".to_string(),
            shell: Some("powershell.exe".to_string()),
            url: Some("http://localhost:3000".to_string()),
            group: None,
            env: BTreeMap::from([
                ("SHARED".to_string(), "base".to_string()),
                ("PORT".to_string(), "3000".to_string()),
            ]),
            auto_start: false,
            commands: vec![
                ProjectCommand {
                    id: "api".to_string(),
                    name: "API".to_string(),
                    command: "cargo run".to_string(),
                    cwd: Some("D:/other-dir".to_string()),
                    shell: Some("cmd.exe".to_string()),
                    url: None,
                    env: BTreeMap::from([("PORT".to_string(), "8080".to_string())]),
                    auto_start: true,
                },
            ],
        };
        let abs_res = multi.resolve_command(Some("api")).unwrap();
        assert_eq!(abs_res.session_key, "edge::api");
        assert_eq!(abs_res.shell.as_deref(), Some("cmd.exe"));
        assert_eq!(abs_res.url.as_deref(), Some("http://localhost:3000"));
        assert_eq!(abs_res.cwd, "D:/other-dir");
        assert_eq!(abs_res.env.get("SHARED").map(String::as_str), Some("base"));
        assert_eq!(abs_res.env.get("PORT").map(String::as_str), Some("8080"));
    }

    #[test]
    fn parses_config_with_custom_groups_and_bindings() {
        let json = r#"{
            "groups": ["OMS", "RPA"],
            "projects": [
                { "id": "oms-srv", "name": "OMS Server", "cwd": "D:/oms", "command": "mvn spring-boot:run", "group": "OMS" },
                {
                    "id": "rpa-edge",
                    "name": "RPA Edge",
                    "cwd": "D:/rpa",
                    "group": "RPA",
                    "commands": [
                        { "id": "studio", "name": "Studio", "command": "npm run dev" },
                        { "id": "agent", "name": "Agent", "command": "cargo run -p liyin-agent-app", "cwd": "agent-host" }
                    ]
                }
            ],
            "bindings": [
                {
                    "id": "fullstack",
                    "name": "OMS + RPA 联调",
                    "description": "一键启动服务端与托盘",
                    "targets": [
                        { "projectId": "oms-srv" },
                        { "projectId": "rpa-edge", "commandId": "agent" }
                    ]
                }
            ]
        }"#;
        let parsed = parse_config_json(json).expect("should parse groups and bindings");
        assert_eq!(parsed.groups, vec!["OMS", "RPA"]);
        assert_eq!(parsed.bindings.len(), 1);
        assert_eq!(parsed.bindings[0].targets.len(), 2);
        assert_eq!(parsed.bindings[0].targets[0].command_id, None);
        assert_eq!(
            parsed.bindings[0].targets[1].command_id.as_deref(),
            Some("agent")
        );
    }

    #[test]
    fn rejects_invalid_or_duplicate_bindings() {
        let empty_targets = r#"{
            "projects": [],
            "bindings": [{ "id": "b1", "name": "Empty", "targets": [] }]
        }"#;
        assert!(parse_config_json(empty_targets).is_err());

        let dup_binding = r#"{
            "projects": [],
            "bindings": [
                { "id": "b1", "name": "One", "targets": [{ "projectId": "p1" }] },
                { "id": "b1", "name": "Two", "targets": [{ "projectId": "p2" }] }
            ]
        }"#;
        assert!(parse_config_json(dup_binding).is_err());
    }

    #[test]
    fn normalizes_groups_and_handles_missing_optional_fields() {
        let json = r#"{
            "groups": ["  Core  ", "", "Core", "Tools"],
            "projects": [
                { "id": "p1", "name": "P1", "cwd": "D:/p1", "command": "npm run dev" }
            ],
            "bindings": [
                {
                    "id": " b1 ",
                    "name": " 联调 ",
                    "targets": [
                        { "projectId": "p1" },
                        { "projectId": "p1", "commandId": "   " }
                    ]
                }
            ]
        }"#;
        let parsed = parse_config_json(json).expect("should normalize groups and binding targets");
        assert_eq!(parsed.groups, vec!["Core", "Tools"]);
        assert_eq!(parsed.bindings[0].id, "b1");
        assert_eq!(parsed.bindings[0].name, "联调");
        assert_eq!(parsed.bindings[0].targets.len(), 1);
    }

    #[test]
    fn collects_project_groups_into_groups_and_parses_env_and_sequential_bindings() {
        let json = r#"{
            "projects": [
                {
                    "id": "api",
                    "name": "API",
                    "cwd": "D:/api",
                    "command": "cargo run",
                    "group": "  Backend  ",
                    "autoStart": true,
                    "env": { "RUST_LOG": "debug", "  ": "ignored" }
                }
            ],
            "bindings": [
                {
                    "id": "boot",
                    "name": "Boot",
                    "sequential": true,
                    "delayMs": 1500,
                    "autoStart": true,
                    "targets": [{ "projectId": "api" }]
                }
            ]
        }"#;
        let parsed = parse_config_json(json).expect("should collect groups and parse new fields");
        assert_eq!(parsed.groups, vec!["Backend"]);
        assert_eq!(parsed.projects[0].group.as_deref(), Some("Backend"));
        assert!(parsed.projects[0].auto_start);
        assert_eq!(parsed.projects[0].env.len(), 1);
        assert_eq!(
            parsed.projects[0].env.get("RUST_LOG").map(String::as_str),
            Some("debug")
        );
        assert!(parsed.bindings[0].sequential);
        assert_eq!(parsed.bindings[0].delay_ms, Some(1500));
        assert!(parsed.bindings[0].auto_start);
    }
}
