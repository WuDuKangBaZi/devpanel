use crate::i18n::{self, Locale};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandOption {
    pub id: String,
    pub label: String,
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedProject {
    pub cwd: String,
    pub suggested_id: String,
    pub suggested_name: String,
    pub project_type: String,
    pub group: Option<String>,
    pub shell: Option<String>,
    pub command: String,
    pub url: Option<String>,
    pub package_manager: Option<String>,
    pub alternatives: Vec<CommandOption>,
    pub commands: Vec<CommandOption>,
    pub summary: String,
}

fn default_shell() -> Option<String> {
    #[cfg(windows)]
    {
        Some("powershell.exe".to_string())
    }
    #[cfg(not(windows))]
    {
        None
    }
}

fn slugify(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut prev_dash = false;

    for ch in input.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
    }

    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "project".to_string()
    } else {
        trimmed
    }
}

fn extract_port_from_command(cmd: &str) -> Option<u16> {
    let tokens: Vec<&str> = cmd.split_whitespace().collect();
    for (idx, token) in tokens.iter().enumerate() {
        if let Some(rest) = token.strip_prefix("--port=")
            && let Ok(port) = rest.parse::<u16>()
        {
            return Some(port);
        }
        if let Some(rest) = token.strip_prefix("PORT=")
            && let Ok(port) = rest.parse::<u16>()
        {
            return Some(port);
        }
        if (*token == "--port" || *token == "-p")
            && idx + 1 < tokens.len()
            && let Ok(port) = tokens[idx + 1].parse::<u16>()
        {
            return Some(port);
        }
    }
    None
}

fn make_unique_option_id(base: &str, existing: &[CommandOption]) -> String {
    let clean = slugify(base);
    if !existing.iter().any(|o| o.id == clean) {
        return clean;
    }
    let mut idx = 2;
    loop {
        let candidate = format!("{}-{}", clean, idx);
        if !existing.iter().any(|o| o.id == candidate) {
            return candidate;
        }
        idx += 1;
    }
}

fn push_unique_option(
    list: &mut Vec<CommandOption>,
    seen: &mut HashSet<(String, String)>,
    mut opt: CommandOption,
) {
    let key = (opt.cwd.clone().unwrap_or_default(), opt.command.clone());
    if seen.insert(key) {
        let base_id = if opt.id.trim().is_empty() {
            opt.label.clone()
        } else {
            opt.id.clone()
        };
        opt.id = make_unique_option_id(&base_id, list);
        list.push(opt);
    }
}

fn has_compose_file(path: &Path) -> bool {
    [
        "docker-compose.yml",
        "docker-compose.yaml",
        "compose.yml",
        "compose.yaml",
    ]
    .iter()
    .any(|name| path.join(name).is_file())
}

fn detect_node_pm(path: &Path, pkg: &Value) -> &'static str {
    if path.join("pnpm-lock.yaml").is_file() {
        return "pnpm";
    }
    if path.join("yarn.lock").is_file() {
        return "yarn";
    }
    if path.join("bun.lock").is_file() || path.join("bun.lockb").is_file() {
        return "bun";
    }
    if let Some(pm) = pkg.get("packageManager").and_then(|v| v.as_str()) {
        let lower = pm.to_ascii_lowercase();
        if lower.starts_with("pnpm") {
            return "pnpm";
        }
        if lower.starts_with("yarn") {
            return "yarn";
        }
        if lower.starts_with("bun") {
            return "bun";
        }
    }
    "npm"
}

fn pm_run(pm: &str, script: &str) -> String {
    if pm == "yarn" {
        format!("yarn {}", script)
    } else {
        format!("{} run {}", pm, script)
    }
}

fn has_dep(pkg: &Value, name: &str) -> bool {
    pkg.get("dependencies")
        .and_then(|d| d.get(name))
        .is_some()
        || pkg
            .get("devDependencies")
            .and_then(|d| d.get(name))
            .is_some()
}

fn read_tauri_dev_url(path: &Path) -> Option<String> {
    let conf_path = path.join("src-tauri").join("tauri.conf.json");
    let raw = fs::read_to_string(conf_path).ok()?;
    let val: Value = serde_json::from_str(&raw).ok()?;
    val.get("build")
        .and_then(|b| b.get("devUrl"))
        .and_then(|u| u.as_str())
        .map(str::to_string)
}

fn read_vite_server_info(path: &Path) -> (Option<u16>, bool) {
    let candidates = [
        "vite.config.ts",
        "vite.config.js",
        "vite.config.mts",
        "vite.config.mjs",
    ];
    let Some(raw) = candidates
        .iter()
        .map(|name| path.join(name))
        .find(|p| p.is_file())
        .and_then(|p| fs::read_to_string(p).ok())
    else {
        return (None, false);
    };

    // Strip single-line // comments so commented host/port examples are ignored
    let cleaned: String = raw
        .lines()
        .map(|line| line.split("//").next().unwrap_or(""))
        .collect::<Vec<_>>()
        .join("\n");

    let Some(server_pos) = cleaned.find("server:") else {
        return (None, false);
    };
    let after_server = &cleaned[server_pos + "server:".len()..];
    let Some(open_rel) = after_server.find('{') else {
        return (None, false);
    };

    let block_tail = &after_server[open_rel..];
    let mut depth: i32 = 0;
    let mut end_idx = block_tail.len();
    for (idx, ch) in block_tail.char_indices() {
        match ch {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    end_idx = idx + 1;
                    break;
                }
            }
            _ => {}
        }
    }
    let server_block = &block_tail[..end_idx];

    let mut port = None;
    if let Some(port_pos) = server_block.find("port:") {
        let rest = server_block[port_pos + "port:".len()..].trim_start();
        let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        if let Ok(parsed) = digits.parse::<u16>() {
            port = Some(parsed);
        }
    }

    let has_host = server_block
        .lines()
        .any(|line| line.trim_start().starts_with("host:"));

    (port, has_host)
}

fn parse_spring_port_value(raw: &str) -> Option<u16> {
    let before_comment = raw.split('#').next().unwrap_or("").trim();
    let unquoted = before_comment.trim_matches('"').trim_matches('\'').trim();
    if let Some(inner) = unquoted.strip_prefix("${").and_then(|s| s.strip_suffix('}')) {
        let (_, default_val) = inner.split_once(':')?;
        return default_val.trim().parse::<u16>().ok();
    }
    unquoted.parse::<u16>().ok()
}

fn read_spring_boot_port(path: &Path) -> Option<u16> {
    let res_dir = path.join("src").join("main").join("resources");
    for yaml_name in ["application.yaml", "application.yml"] {
        let yaml_path = res_dir.join(yaml_name);
        if let Ok(content) = fs::read_to_string(&yaml_path) {
            let mut in_server = false;
            for line in content.lines() {
                let no_comment = line.split('#').next().unwrap_or("");
                let trimmed = no_comment.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let indent = no_comment.chars().take_while(|c| *c == ' ').count();
                if indent == 0 {
                    in_server = trimmed.starts_with("server:");
                } else if in_server
                    && trimmed.starts_with("port:")
                    && let Some(port) = parse_spring_port_value(&trimmed["port:".len()..])
                {
                    return Some(port);
                }
            }
        }
    }

    let props_path = res_dir.join("application.properties");
    if let Ok(content) = fs::read_to_string(&props_path) {
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('!') {
                continue;
            }
            if let Some(val) = trimmed
                .strip_prefix("server.port")
                .map(str::trim_start)
                .and_then(|s| s.strip_prefix('=').or_else(|| s.strip_prefix(':')))
                && let Some(port) = parse_spring_port_value(val)
            {
                return Some(port);
            }
        }
    }

    None
}

fn detect_node_project(
    path: &Path,
    cwd: String,
    folder_name: &str,
    en: bool,
) -> Option<DetectedProject> {
    let pkg_path = path.join("package.json");
    if !pkg_path.is_file() {
        return None;
    }

    let raw = fs::read_to_string(&pkg_path).ok()?;
    let pkg: Value = serde_json::from_str(&raw).ok()?;

    let pkg_name = pkg
        .get("name")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let suggested_name = pkg_name
        .map(|n| n.rsplit('/').next().unwrap_or(n).to_string())
        .unwrap_or_else(|| folder_name.to_string());
    let suggested_id = slugify(&suggested_name);

    let pm = detect_node_pm(path, &pkg);
    let scripts = pkg.get("scripts").and_then(|s| s.as_object());
    let has_script = |key: &str| scripts.and_then(|m| m.get(key)).and_then(|v| v.as_str());

    let tauri_conf_exists = path.join("src-tauri").join("tauri.conf.json").is_file();
    let is_tauri = tauri_conf_exists || (has_dep(&pkg, "@tauri-apps/cli") && has_script("tauri").is_some());
    let is_vite = !is_tauri && has_dep(&pkg, "vite");
    let (vite_port, vite_has_host) = if is_vite {
        read_vite_server_info(path)
    } else {
        (None, false)
    };

    let (project_type, group, mut default_url): (String, Option<String>, Option<String>) = if is_tauri {
        (
            if en {
                "Tauri Desktop App"
            } else {
                "Tauri 桌面应用"
            }
            .to_string(),
            Some("Desktop".to_string()),
            read_tauri_dev_url(path),
        )
    } else if has_dep(&pkg, "next") {
        (
            "Next.js".to_string(),
            Some("Fullstack".to_string()),
            Some("http://localhost:3000".to_string()),
        )
    } else if has_dep(&pkg, "nuxt") {
        (
            "Nuxt".to_string(),
            Some("Fullstack".to_string()),
            Some("http://localhost:3000".to_string()),
        )
    } else if has_dep(&pkg, "@angular/core") {
        (
            "Angular".to_string(),
            Some("Frontend".to_string()),
            Some("http://localhost:4200".to_string()),
        )
    } else if is_vite {
        let label = if has_dep(&pkg, "react") {
            "Vite + React"
        } else if has_dep(&pkg, "vue") {
            "Vite + Vue"
        } else if has_dep(&pkg, "svelte") {
            "Vite + Svelte"
        } else {
            "Vite"
        };
        (
            label.to_string(),
            Some("Frontend".to_string()),
            Some(format!("http://localhost:{}", vite_port.unwrap_or(5173))),
        )
    } else if has_dep(&pkg, "@nestjs/core") {
        (
            "NestJS".to_string(),
            Some("Backend".to_string()),
            Some("http://localhost:3000".to_string()),
        )
    } else if has_dep(&pkg, "express")
        || has_dep(&pkg, "fastify")
        || has_dep(&pkg, "koa")
        || has_dep(&pkg, "hono")
    {
        (
            "Node.js API".to_string(),
            Some("Backend".to_string()),
            Some("http://localhost:3000".to_string()),
        )
    } else if has_dep(&pkg, "electron") {
        (
            if en {
                "Electron Desktop App"
            } else {
                "Electron 桌面应用"
            }
            .to_string(),
            Some("Desktop".to_string()),
            None,
        )
    } else {
        (
            "Node.js".to_string(),
            Some("Frontend".to_string()),
            None,
        )
    };

    let mut alternatives = Vec::new();
    let mut seen: HashSet<(String, String)> = HashSet::new();
    let mut multi_commands = Vec::new();
    let mut seen_multi: HashSet<(String, String)> = HashSet::new();

    if is_tauri && has_script("tauri").is_some() {
        let tauri_cmd = if pm == "yarn" {
            "yarn tauri dev".to_string()
        } else {
            format!("{} run tauri dev", pm)
        };
        let opt = CommandOption {
            id: "tauri-dev".to_string(),
            label: "Tauri Dev".to_string(),
            command: tauri_cmd,
            cwd: None,
            url: default_url.clone(),
        };
        push_unique_option(&mut alternatives, &mut seen, opt.clone());
        push_unique_option(&mut multi_commands, &mut seen_multi, opt);
    }

    for &(script_key, label) in &[
        ("dev", "dev"),
        ("start:dev", "start:dev"),
        ("serve", "serve"),
        ("start", "start"),
        ("watch", "watch"),
        ("preview", "preview"),
        ("storybook", "storybook"),
    ] {
        if let Some(script_body) = has_script(script_key) {
            let cmd = pm_run(pm, script_key);
            let script_url = if let Some(port) = extract_port_from_command(script_body) {
                Some(format!("http://localhost:{}", port))
            } else if script_key == "preview" {
                Some("http://localhost:4173".to_string())
            } else if script_key == "storybook" {
                Some("http://localhost:6006".to_string())
            } else {
                default_url.clone()
            };

            let mut preferred_dev_opt: Option<CommandOption> = None;

            #[cfg(windows)]
            if is_vite
                && script_key == "dev"
                && !vite_has_host
                && script_body.to_ascii_lowercase().contains("vite")
                && !script_body.contains("--host")
            {
                let ipv4_cmd = match pm {
                    "yarn" => "yarn dev --host 127.0.0.1".to_string(),
                    "pnpm" => "pnpm run dev --host 127.0.0.1".to_string(),
                    _ => format!("{} run dev -- --host 127.0.0.1", pm),
                };
                let ipv4_opt = CommandOption {
                    id: "dev-ipv4".to_string(),
                    label: "dev (IPv4)".to_string(),
                    command: ipv4_cmd,
                    cwd: None,
                    url: script_url.clone(),
                };
                push_unique_option(&mut alternatives, &mut seen, ipv4_opt.clone());
                preferred_dev_opt = Some(ipv4_opt);
            }

            let opt = CommandOption {
                id: slugify(label),
                label: label.to_string(),
                command: cmd,
                cwd: None,
                url: script_url,
            };
            push_unique_option(&mut alternatives, &mut seen, opt.clone());
            if matches!(script_key, "dev" | "start:dev" | "serve" | "watch") {
                push_unique_option(
                    &mut multi_commands,
                    &mut seen_multi,
                    preferred_dev_opt.unwrap_or(opt),
                );
            }
        }
    }

    let mut has_prefixed_dev_or_start = false;
    if let Some(script_map) = scripts {
        let mut extra_keys: Vec<&String> = script_map
            .keys()
            .filter(|k| {
                let key = k.as_str();
                (key.starts_with("dev:") || (key.starts_with("start:") && key != "start:dev"))
                    || key == "test:watch"
            })
            .collect();
        extra_keys.sort();

        for key in extra_keys {
            if let Some(script_body) = script_map.get(key).and_then(|v| v.as_str()) {
                let cmd = pm_run(pm, key);
                let script_url = extract_port_from_command(script_body)
                    .map(|port| format!("http://localhost:{}", port))
                    .or_else(|| default_url.clone());
                let opt = CommandOption {
                    id: slugify(key),
                    label: key.clone(),
                    command: cmd,
                    cwd: None,
                    url: if key == "test:watch" { None } else { script_url },
                };
                push_unique_option(&mut alternatives, &mut seen, opt.clone());
                if key != "test:watch" {
                    has_prefixed_dev_or_start = true;
                    push_unique_option(&mut multi_commands, &mut seen_multi, opt);
                }
            }
        }
    }

    let commands = if multi_commands.len() >= 2 && (has_prefixed_dev_or_start || is_tauri) {
        multi_commands
    } else {
        Vec::new()
    };

    if let Some(first) = alternatives.first()
        && let Some(ref inferred) = first.url
    {
        default_url = Some(inferred.clone());
    }

    let primary_command = alternatives
        .first()
        .map(|o| o.command.clone())
        .unwrap_or_else(|| pm_run(pm, "dev"));

    if has_compose_file(path) {
        push_unique_option(
            &mut alternatives,
            &mut seen,
            CommandOption {
                id: "docker-compose".to_string(),
                label: "Docker Compose".to_string(),
                command: "docker compose up".to_string(),
                cwd: None,
                url: None,
            },
        );
    }

    let summary = match (en, commands.len() >= 2) {
        (true, true) => format!(
            "Detected {} project (package manager: {}) with {} launch modes",
            project_type,
            pm,
            commands.len()
        ),
        (true, false) => format!(
            "Detected {} project (package manager: {}), default command \"{}\"",
            project_type, pm, primary_command
        ),
        (false, true) => format!(
            "已识别为 {} 项目（包管理器：{}），共发现 {} 个启动模式",
            project_type,
            pm,
            commands.len()
        ),
        (false, false) => format!(
            "已识别为 {} 项目（包管理器：{}），默认命令「{}」",
            project_type, pm, primary_command
        ),
    };

    Some(DetectedProject {
        cwd,
        suggested_id,
        suggested_name,
        project_type,
        group,
        shell: default_shell(),
        command: primary_command,
        url: default_url,
        package_manager: Some(pm.to_string()),
        alternatives,
        commands,
        summary,
    })
}

fn parse_cargo_package_name(cargo_toml: &str) -> Option<String> {
    let mut in_package = false;
    for line in cargo_toml.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            in_package = trimmed == "[package]";
            continue;
        }
        if in_package
            && trimmed.starts_with("name")
            && let Some((_, rhs)) = trimmed.split_once('=')
        {
            let name = rhs.trim().trim_matches('"').trim_matches('\'');
            if !name.is_empty() {
                return Some(name.to_string());
            }
        }
    }
    None
}

fn extract_toml_quoted_strings(segment: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut chars = segment.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '"' || ch == '\'' {
            let quote = ch;
            let mut val = String::new();
            for next_ch in chars.by_ref() {
                if next_ch == quote {
                    break;
                }
                val.push(next_ch);
            }
            if !val.is_empty() {
                out.push(val);
            }
        }
    }
    out
}

fn parse_cargo_workspace_members(cargo_toml: &str, root: &Path) -> Vec<PathBuf> {
    let mut in_workspace = false;
    let mut collecting_members = false;
    let mut members_buf = String::new();

    for line in cargo_toml.lines() {
        let no_comment = line.split('#').next().unwrap_or("");
        let trimmed = no_comment.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.starts_with('[') && !trimmed.starts_with("[[") {
            in_workspace = trimmed == "[workspace]";
            collecting_members = false;
            continue;
        }
        if !in_workspace {
            continue;
        }

        if !collecting_members {
            if let Some(rest) = trimmed.strip_prefix("members") {
                let after_key = rest.trim_start();
                if let Some(rhs) = after_key.strip_prefix('=') {
                    let rhs_trimmed = rhs.trim_start();
                    members_buf.push_str(rhs_trimmed);
                    members_buf.push('\n');
                    if rhs_trimmed.contains(']') {
                        break;
                    }
                    collecting_members = true;
                }
            }
        } else {
            members_buf.push_str(trimmed);
            members_buf.push('\n');
            if trimmed.contains(']') {
                break;
            }
        }
    }

    let patterns = extract_toml_quoted_strings(&members_buf);
    let mut member_dirs = Vec::new();
    let mut seen_dirs = HashSet::new();

    for pattern in patterns {
        let cleaned = pattern.trim().trim_end_matches('/');
        if let Some(prefix) = cleaned.strip_suffix("/*") {
            let base = root.join(prefix);
            if let Ok(entries) = fs::read_dir(base) {
                let mut subdirs: Vec<PathBuf> = entries
                    .filter_map(|e| e.ok().map(|entry| entry.path()))
                    .filter(|p| p.is_dir() && p.join("Cargo.toml").is_file())
                    .collect();
                subdirs.sort();
                for dir in subdirs {
                    if seen_dirs.insert(dir.clone()) {
                        member_dirs.push(dir);
                    }
                }
            }
        } else {
            let dir = root.join(cleaned);
            if dir.is_dir() && dir.join("Cargo.toml").is_file() && seen_dirs.insert(dir.clone()) {
                member_dirs.push(dir);
            }
        }
    }

    member_dirs
}

struct CargoCrateInfo {
    pkg_name: String,
    has_lib: bool,
    bins: Vec<String>,
    is_tauri: bool,
    is_web: bool,
}

fn inspect_cargo_crate_bins(crate_dir: &Path) -> Option<CargoCrateInfo> {
    let raw = fs::read_to_string(crate_dir.join("Cargo.toml")).ok()?;
    let pkg_name = parse_cargo_package_name(&raw)?;
    let lower = raw.to_ascii_lowercase();
    let is_tauri = lower.contains("tauri") || crate_dir.join("tauri.conf.json").is_file();
    let is_web = ["axum", "actix-web", "rocket", "warp", "salvo", "poem"]
        .iter()
        .any(|k| lower.contains(k));

    let mut has_lib = crate_dir.join("src").join("lib.rs").is_file();
    let mut bins = Vec::new();
    let mut section = String::new();

    for line in raw.lines() {
        let trimmed = line.split('#').next().unwrap_or("").trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.starts_with("[[") || trimmed.starts_with('[') {
            section = trimmed.to_string();
            if trimmed == "[lib]" {
                has_lib = true;
            }
            continue;
        }
        if section == "[[bin]]"
            && trimmed.starts_with("name")
            && let Some((_, rhs)) = trimmed.split_once('=')
        {
            let name = rhs.trim().trim_matches('"').trim_matches('\'');
            if !name.is_empty() && !bins.iter().any(|b| b == name) {
                bins.push(name.to_string());
            }
        }
    }

    if crate_dir.join("src").join("main.rs").is_file()
        && !bins.iter().any(|b| b == &pkg_name)
        && bins.is_empty()
    {
        bins.push(pkg_name.clone());
    }

    let bin_dir = crate_dir.join("src").join("bin");
    if bin_dir.is_dir()
        && let Ok(entries) = fs::read_dir(bin_dir)
    {
        let mut extra_bins = Vec::new();
        for entry in entries.filter_map(|e| e.ok()) {
            let p = entry.path();
            if p.is_file() && p.extension().and_then(|s| s.to_str()) == Some("rs") {
                if let Some(stem) = p.file_stem().and_then(|s| s.to_str()) {
                    extra_bins.push(stem.to_string());
                }
            } else if p.is_dir()
                && p.join("main.rs").is_file()
                && let Some(name) = p.file_name().and_then(|s| s.to_str())
            {
                extra_bins.push(name.to_string());
            }
        }
        extra_bins.sort();
        for b in extra_bins {
            if !bins.iter().any(|existing| existing == &b) {
                bins.push(b);
            }
        }
    }

    Some(CargoCrateInfo {
        pkg_name,
        has_lib,
        bins,
        is_tauri,
        is_web,
    })
}

fn detect_rust_project(
    path: &Path,
    cwd: String,
    folder_name: &str,
    en: bool,
) -> Option<DetectedProject> {
    let cargo_path = path.join("Cargo.toml");
    if !cargo_path.is_file() {
        return None;
    }

    let raw = fs::read_to_string(&cargo_path).unwrap_or_default();
    let pkg_name = parse_cargo_package_name(&raw);
    let is_workspace = raw.lines().any(|l| l.trim() == "[workspace]");

    if is_workspace && pkg_name.is_none() {
        let member_dirs = parse_cargo_workspace_members(&raw, path);
        let mut priority_opts = Vec::new();
        let mut other_opts = Vec::new();

        for dir in &member_dirs {
            let Some(info) = inspect_cargo_crate_bins(dir) else {
                continue;
            };
            if info.bins.is_empty() {
                continue;
            }
            let url = if info.is_web {
                Some("http://localhost:8080".to_string())
            } else {
                None
            };
            let use_pkg_only = info.bins.len() == 1 && !info.has_lib;

            for bin_name in &info.bins {
                let cmd = if use_pkg_only {
                    format!("cargo run -p {}", info.pkg_name)
                } else {
                    format!("cargo run -p {} --bin {}", info.pkg_name, bin_name)
                };
                let label = if info.is_tauri {
                    format!("{} (Tauri)", info.pkg_name)
                } else {
                    bin_name.clone()
                };
                let opt = CommandOption {
                    id: slugify(bin_name),
                    label,
                    command: cmd,
                    cwd: None,
                    url: url.clone(),
                };
                if info.is_tauri || info.is_web {
                    priority_opts.push(opt);
                } else {
                    other_opts.push(opt);
                }
            }
        }

        let mut binary_opts = Vec::new();
        let mut seen_bins: HashSet<(String, String)> = HashSet::new();
        for opt in priority_opts.into_iter().chain(other_opts) {
            push_unique_option(&mut binary_opts, &mut seen_bins, opt);
        }

        let mut alternatives = Vec::new();
        let mut seen: HashSet<(String, String)> = HashSet::new();
        for opt in &binary_opts {
            push_unique_option(&mut alternatives, &mut seen, opt.clone());
        }
        push_unique_option(
            &mut alternatives,
            &mut seen,
            CommandOption {
                id: "cargo-test".to_string(),
                label: "cargo test".to_string(),
                command: "cargo test".to_string(),
                cwd: None,
                url: None,
            },
        );
        if has_compose_file(path) {
            push_unique_option(
                &mut alternatives,
                &mut seen,
                CommandOption {
                    id: "docker-compose".to_string(),
                    label: "Docker Compose".to_string(),
                    command: "docker compose up".to_string(),
                    cwd: None,
                    url: None,
                },
            );
        }

        let primary_command = binary_opts
            .first()
            .map(|o| o.command.clone())
            .unwrap_or_else(|| "cargo test".to_string());
        let url = binary_opts.iter().find_map(|o| o.url.clone());
        let commands = if binary_opts.len() >= 2 {
            binary_opts
        } else {
            Vec::new()
        };
        let summary = match (en, commands.len() >= 2) {
            (true, true) => format!(
                "Detected Rust (Cargo Workspace) project with {} runnable binaries",
                commands.len()
            ),
            (true, false) => format!(
                "Detected Rust (Cargo Workspace) project, default command \"{}\"",
                primary_command
            ),
            (false, true) => format!(
                "已识别为 Rust (Cargo Workspace) 项目，共发现 {} 个可执行二进制",
                commands.len()
            ),
            (false, false) => {
                format!("已识别为 Rust (Cargo Workspace) 项目，默认命令「{}」", primary_command)
            }
        };

        return Some(DetectedProject {
            cwd,
            suggested_id: slugify(folder_name),
            suggested_name: folder_name.to_string(),
            project_type: "Rust (Cargo Workspace)".to_string(),
            group: Some("Backend".to_string()),
            shell: default_shell(),
            command: primary_command,
            url,
            package_manager: Some("cargo".to_string()),
            alternatives,
            commands,
            summary,
        });
    }

    let pkg_name = pkg_name.unwrap_or_else(|| folder_name.to_string());
    let crate_info = inspect_cargo_crate_bins(path);
    let lower = raw.to_ascii_lowercase();
    let is_web = ["axum", "actix-web", "rocket", "warp", "salvo", "poem"]
        .iter()
        .any(|k| lower.contains(k));
    let url = if is_web {
        Some("http://localhost:8080".to_string())
    } else {
        None
    };

    let mut alternatives = Vec::new();
    let mut seen: HashSet<(String, String)> = HashSet::new();
    let mut multi_commands = Vec::new();

    if let Some(info) = crate_info.as_ref().filter(|i| i.bins.len() >= 2) {
        let mut seen_bins: HashSet<(String, String)> = HashSet::new();
        for bin_name in &info.bins {
            let opt = CommandOption {
                id: slugify(bin_name),
                label: bin_name.clone(),
                command: format!("cargo run --bin {}", bin_name),
                cwd: None,
                url: url.clone(),
            };
            push_unique_option(&mut alternatives, &mut seen, opt.clone());
            push_unique_option(&mut multi_commands, &mut seen_bins, opt);
        }
    } else {
        push_unique_option(
            &mut alternatives,
            &mut seen,
            CommandOption {
                id: "cargo-run".to_string(),
                label: "cargo run".to_string(),
                command: "cargo run".to_string(),
                cwd: None,
                url: url.clone(),
            },
        );
    }

    push_unique_option(
        &mut alternatives,
        &mut seen,
        CommandOption {
            id: "cargo-watch".to_string(),
            label: "cargo watch".to_string(),
            command: "cargo watch -x run".to_string(),
            cwd: None,
            url: url.clone(),
        },
    );
    push_unique_option(
        &mut alternatives,
        &mut seen,
        CommandOption {
            id: "cargo-test".to_string(),
            label: "cargo test".to_string(),
            command: "cargo test".to_string(),
            cwd: None,
            url: None,
        },
    );
    if has_compose_file(path) {
        push_unique_option(
            &mut alternatives,
            &mut seen,
            CommandOption {
                id: "docker-compose".to_string(),
                label: "Docker Compose".to_string(),
                command: "docker compose up".to_string(),
                cwd: None,
                url: None,
            },
        );
    }

    let primary_command = multi_commands
        .first()
        .map(|o| o.command.clone())
        .unwrap_or_else(|| "cargo run".to_string());
    let summary = match (en, multi_commands.len() >= 2) {
        (true, true) => format!(
            "Detected Rust (Cargo) project with {} binary targets",
            multi_commands.len()
        ),
        (true, false) => "Detected Rust (Cargo) project, configured cargo run".to_string(),
        (false, true) => format!(
            "已识别为 Rust (Cargo) 项目，共发现 {} 个二进制入口",
            multi_commands.len()
        ),
        (false, false) => "已识别为 Rust (Cargo) 项目，已自动配置 cargo run".to_string(),
    };

    Some(DetectedProject {
        cwd,
        suggested_id: slugify(&pkg_name),
        suggested_name: pkg_name,
        project_type: "Rust (Cargo)".to_string(),
        group: Some("Backend".to_string()),
        shell: default_shell(),
        command: primary_command,
        url,
        package_manager: Some("cargo".to_string()),
        alternatives,
        commands: multi_commands,
        summary,
    })
}

fn python_runner(path: &Path) -> (&'static str, String) {
    if path.join("uv.lock").is_file() {
        return ("uv", "uv run".to_string());
    }
    if path.join("poetry.lock").is_file() {
        return ("poetry", "poetry run".to_string());
    }

    #[cfg(windows)]
    let venv_py = path.join(".venv").join("Scripts").join("python.exe");
    #[cfg(not(windows))]
    let venv_py = path.join(".venv").join("bin").join("python");

    if venv_py.is_file() {
        #[cfg(windows)]
        return ("venv", ".\\.venv\\Scripts\\python.exe".to_string());
        #[cfg(not(windows))]
        return ("venv", "./.venv/bin/python".to_string());
    }

    ("pip", "python".to_string())
}

fn detect_python_project(
    path: &Path,
    cwd: String,
    folder_name: &str,
    en: bool,
) -> Option<DetectedProject> {
    let has_pyproject = path.join("pyproject.toml").is_file();
    let has_reqs = path.join("requirements.txt").is_file();
    let has_manage = path.join("manage.py").is_file();
    let has_main = path.join("main.py").is_file();
    let has_app = path.join("app.py").is_file();

    if !(has_pyproject || has_reqs || has_manage || has_main || has_app) {
        return None;
    }

    let (pm_name, runner) = python_runner(path);
    let combined_text = format!(
        "{}\n{}",
        fs::read_to_string(path.join("pyproject.toml")).unwrap_or_default(),
        fs::read_to_string(path.join("requirements.txt")).unwrap_or_default()
    )
    .to_ascii_lowercase();

    let run_module = |module_args: &str| -> String {
        if pm_name == "uv" || pm_name == "poetry" {
            format!("{} {}", runner, module_args)
        } else {
            format!("{} -m {}", runner, module_args)
        }
    };

    let (project_type, command, url) = if has_manage {
        (
            "Python (Django)".to_string(),
            if pm_name == "uv" || pm_name == "poetry" {
                format!("{} python manage.py runserver", runner)
            } else {
                format!("{} manage.py runserver", runner)
            },
            Some("http://localhost:8000".to_string()),
        )
    } else if combined_text.contains("fastapi") || combined_text.contains("uvicorn") {
        let entry = if path.join("app").join("main.py").is_file() {
            "app.main:app"
        } else if path.join("src").join("main.py").is_file() {
            "src.main:app"
        } else {
            "main:app"
        };
        (
            "Python (FastAPI)".to_string(),
            run_module(&format!("uvicorn {} --reload", entry)),
            Some("http://localhost:8000".to_string()),
        )
    } else if combined_text.contains("streamlit") {
        let entry = if has_app { "app.py" } else { "main.py" };
        (
            "Python (Streamlit)".to_string(),
            run_module(&format!("streamlit run {}", entry)),
            Some("http://localhost:8501".to_string()),
        )
    } else if combined_text.contains("flask") {
        (
            "Python (Flask)".to_string(),
            run_module("flask run --debug"),
            Some("http://localhost:5000".to_string()),
        )
    } else {
        let entry = if has_main { "main.py" } else { "app.py" };
        let cmd = if pm_name == "uv" || pm_name == "poetry" {
            format!("{} python {}", runner, entry)
        } else {
            format!("{} {}", runner, entry)
        };
        ("Python".to_string(), cmd, None)
    };

    let mut alternatives = Vec::new();
    let mut seen: HashSet<(String, String)> = HashSet::new();
    push_unique_option(
        &mut alternatives,
        &mut seen,
        CommandOption {
            id: "default".to_string(),
            label: if en { "Default" } else { "默认启动" }.to_string(),
            command: command.clone(),
            cwd: None,
            url: url.clone(),
        },
    );
    if has_compose_file(path) {
        push_unique_option(
            &mut alternatives,
            &mut seen,
            CommandOption {
                id: "docker-compose".to_string(),
                label: "Docker Compose".to_string(),
                command: "docker compose up".to_string(),
                cwd: None,
                url: None,
            },
        );
    }

    let summary = if en {
        format!(
            "Detected {} project (env: {}), default command \"{}\"",
            project_type, pm_name, command
        )
    } else {
        format!(
            "已识别为 {} 项目（环境：{}），默认命令「{}」",
            project_type, pm_name, command
        )
    };

    Some(DetectedProject {
        cwd,
        suggested_id: slugify(folder_name),
        suggested_name: folder_name.to_string(),
        project_type,
        group: Some("Backend".to_string()),
        shell: default_shell(),
        command,
        url,
        package_manager: Some(pm_name.to_string()),
        alternatives,
        commands: Vec::new(),
        summary,
    })
}

fn detect_go_project(
    path: &Path,
    cwd: String,
    folder_name: &str,
    en: bool,
) -> Option<DetectedProject> {
    let go_mod = path.join("go.mod");
    if !go_mod.is_file() {
        return None;
    }

    let raw = fs::read_to_string(&go_mod)
        .unwrap_or_default()
        .to_ascii_lowercase();
    let is_web = ["gin-gonic", "gofiber", "labstack/echo", "go-chi"]
        .iter()
        .any(|k| raw.contains(k));
    let url = if is_web {
        Some("http://localhost:8080".to_string())
    } else {
        None
    };

    let has_air = path.join(".air.toml").is_file();
    let primary = if has_air { "air" } else { "go run ." }.to_string();

    let mut alternatives = Vec::new();
    let mut seen: HashSet<(String, String)> = HashSet::new();
    if has_air {
        push_unique_option(
            &mut alternatives,
            &mut seen,
            CommandOption {
                id: "air".to_string(),
                label: if en {
                    "air (Hot Reload)"
                } else {
                    "air (热重载)"
                }
                .to_string(),
                command: "air".to_string(),
                cwd: None,
                url: url.clone(),
            },
        );
    }
    push_unique_option(
        &mut alternatives,
        &mut seen,
        CommandOption {
            id: "go-run".to_string(),
            label: "go run .".to_string(),
            command: "go run .".to_string(),
            cwd: None,
            url: url.clone(),
        },
    );
    if has_compose_file(path) {
        push_unique_option(
            &mut alternatives,
            &mut seen,
            CommandOption {
                id: "docker-compose".to_string(),
                label: "Docker Compose".to_string(),
                command: "docker compose up".to_string(),
                cwd: None,
                url: None,
            },
        );
    }

    Some(DetectedProject {
        cwd,
        suggested_id: slugify(folder_name),
        suggested_name: folder_name.to_string(),
        project_type: "Go".to_string(),
        group: Some("Backend".to_string()),
        shell: default_shell(),
        command: primary.clone(),
        url,
        package_manager: Some("go".to_string()),
        alternatives,
        commands: Vec::new(),
        summary: if en {
            format!("Detected Go project, configured {}", primary)
        } else {
            format!("已识别为 Go 项目，已自动配置 {}", primary)
        },
    })
}

fn detect_java_project(
    path: &Path,
    cwd: String,
    folder_name: &str,
    en: bool,
) -> Option<DetectedProject> {
    if path.join("pom.xml").is_file() {
        let pom = fs::read_to_string(path.join("pom.xml"))
            .unwrap_or_default()
            .to_ascii_lowercase();
        let is_spring = pom.contains("spring-boot");
        #[cfg(windows)]
        let mvn = if path.join("mvnw.cmd").is_file() {
            ".\\mvnw.cmd"
        } else {
            "mvn"
        };
        #[cfg(not(windows))]
        let mvn = if path.join("mvnw").is_file() {
            "./mvnw"
        } else {
            "mvn"
        };

        let cmd = if is_spring {
            format!("{} spring-boot:run", mvn)
        } else {
            format!("{} exec:java", mvn)
        };
        let url = if is_spring {
            let port = read_spring_boot_port(path).unwrap_or(8080);
            Some(format!("http://localhost:{}", port))
        } else {
            None
        };
        let mut alternatives = vec![CommandOption {
            id: if is_spring { "spring-boot" } else { "maven" }.to_string(),
            label: if is_spring { "Spring Boot" } else { "Maven" }.to_string(),
            command: cmd.clone(),
            cwd: None,
            url: url.clone(),
        }];
        if has_compose_file(path) {
            alternatives.push(CommandOption {
                id: "docker-compose".to_string(),
                label: "Docker Compose".to_string(),
                command: "docker compose up".to_string(),
                cwd: None,
                url: None,
            });
        }

        return Some(DetectedProject {
            cwd,
            suggested_id: slugify(folder_name),
            suggested_name: folder_name.to_string(),
            project_type: if is_spring {
                "Java (Spring Boot / Maven)"
            } else {
                "Java (Maven)"
            }
            .to_string(),
            group: Some("Backend".to_string()),
            shell: default_shell(),
            command: cmd.clone(),
            url,
            package_manager: Some("maven".to_string()),
            alternatives,
            commands: Vec::new(),
            summary: if en {
                format!("Detected Maven project, default command \"{}\"", cmd)
            } else {
                format!("已识别为 Maven 项目，默认命令「{}」", cmd)
            },
        });
    }

    if path.join("build.gradle").is_file() || path.join("build.gradle.kts").is_file() {
        #[cfg(windows)]
        let gradle = if path.join("gradlew.bat").is_file() {
            ".\\gradlew.bat"
        } else {
            "gradle"
        };
        #[cfg(not(windows))]
        let gradle = if path.join("gradlew").is_file() {
            "./gradlew"
        } else {
            "gradle"
        };
        let cmd = format!("{} bootRun", gradle);
        let port = read_spring_boot_port(path).unwrap_or(8080);
        let url = Some(format!("http://localhost:{}", port));
        let mut alternatives = vec![
            CommandOption {
                id: "boot-run".to_string(),
                label: "bootRun".to_string(),
                command: cmd.clone(),
                cwd: None,
                url: url.clone(),
            },
            CommandOption {
                id: "gradle-run".to_string(),
                label: "gradle run".to_string(),
                command: format!("{} run", gradle),
                cwd: None,
                url: None,
            },
        ];
        if has_compose_file(path) {
            alternatives.push(CommandOption {
                id: "docker-compose".to_string(),
                label: "Docker Compose".to_string(),
                command: "docker compose up".to_string(),
                cwd: None,
                url: None,
            });
        }
        return Some(DetectedProject {
            cwd,
            suggested_id: slugify(folder_name),
            suggested_name: folder_name.to_string(),
            project_type: "Java (Gradle)".to_string(),
            group: Some("Backend".to_string()),
            shell: default_shell(),
            command: cmd.clone(),
            url,
            package_manager: Some("gradle".to_string()),
            alternatives,
            commands: Vec::new(),
            summary: if en {
                format!("Detected Gradle project, default command \"{}\"", cmd)
            } else {
                format!("已识别为 Gradle 项目，默认命令「{}」", cmd)
            },
        });
    }

    None
}

const SKIP_SUBDIRS: &[&str] = &[
    ".git",
    ".github",
    ".vscode",
    ".idea",
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    "coverage",
    ".venv",
    "venv",
    "__pycache__",
    "src-tauri",
    "src",
    "public",
    "assets",
    "docs",
    "doc",
    "examples",
    "example",
    "test",
    "tests",
    "scripts",
    "vendor",
    "contracts",
];

const MONOREPO_CONTAINER_DIRS: &[&str] = &["apps", "packages", "services", "modules"];

fn detect_dotnet_project(
    path: &Path,
    cwd: String,
    folder_name: &str,
    en: bool,
) -> Option<DetectedProject> {
    let entries = fs::read_dir(path).ok()?;
    let mut has_csproj = false;
    let mut has_sln = false;
    let mut proj_name: Option<String> = None;

    for entry in entries.filter_map(|e| e.ok()) {
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        if let Some(ext) = p.extension().and_then(|s| s.to_str()) {
            if ext.eq_ignore_ascii_case("csproj") || ext.eq_ignore_ascii_case("fsproj") {
                has_csproj = true;
                if proj_name.is_none() {
                    proj_name = p
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .map(str::to_string);
                }
            } else if ext.eq_ignore_ascii_case("sln") {
                has_sln = true;
            }
        }
    }

    if !(has_csproj || has_sln) {
        return None;
    }

    let suggested_name = proj_name.unwrap_or_else(|| folder_name.to_string());
    let mut alternatives = vec![
        CommandOption {
            id: "dotnet-watch".to_string(),
            label: "dotnet watch run".to_string(),
            command: "dotnet watch run".to_string(),
            cwd: None,
            url: Some("http://localhost:5000".to_string()),
        },
        CommandOption {
            id: "dotnet-run".to_string(),
            label: "dotnet run".to_string(),
            command: "dotnet run".to_string(),
            cwd: None,
            url: Some("http://localhost:5000".to_string()),
        },
    ];
    if has_compose_file(path) {
        alternatives.push(CommandOption {
            id: "docker-compose".to_string(),
            label: "Docker Compose".to_string(),
            command: "docker compose up".to_string(),
            cwd: None,
            url: None,
        });
    }

    Some(DetectedProject {
        cwd,
        suggested_id: slugify(&suggested_name),
        suggested_name,
        project_type: ".NET".to_string(),
        group: Some("Backend".to_string()),
        shell: default_shell(),
        command: "dotnet watch run".to_string(),
        url: Some("http://localhost:5000".to_string()),
        package_manager: Some("dotnet".to_string()),
        alternatives,
        commands: Vec::new(),
        summary: if en {
            "Detected .NET project, default command \"dotnet watch run\"".to_string()
        } else {
            "已识别为 .NET 项目，默认命令「dotnet watch run」".to_string()
        },
    })
}

fn detect_deno_project(
    path: &Path,
    cwd: String,
    folder_name: &str,
    en: bool,
) -> Option<DetectedProject> {
    let deno_path = if path.join("deno.json").is_file() {
        path.join("deno.json")
    } else if path.join("deno.jsonc").is_file() {
        path.join("deno.jsonc")
    } else {
        return None;
    };

    let raw = fs::read_to_string(&deno_path).unwrap_or_default();
    let parsed: Option<Value> = serde_json::from_str(&raw).ok();
    let tasks = parsed
        .as_ref()
        .and_then(|v| v.get("tasks"))
        .and_then(|t| t.as_object());

    let mut alternatives = Vec::new();
    let mut seen: HashSet<(String, String)> = HashSet::new();
    if let Some(task_map) = tasks {
        for key in ["dev", "start", "serve"] {
            if let Some(body) = task_map.get(key).and_then(|v| v.as_str()) {
                let port_url = extract_port_from_command(body)
                    .map(|p| format!("http://localhost:{}", p));
                push_unique_option(
                    &mut alternatives,
                    &mut seen,
                    CommandOption {
                        id: slugify(key),
                        label: format!("deno task {}", key),
                        command: format!("deno task {}", key),
                        cwd: None,
                        url: port_url,
                    },
                );
            }
        }
    }

    if alternatives.is_empty() {
        push_unique_option(
            &mut alternatives,
            &mut seen,
            CommandOption {
                id: "deno-dev".to_string(),
                label: "deno task dev".to_string(),
                command: "deno task dev".to_string(),
                cwd: None,
                url: None,
            },
        );
    }

    let primary = alternatives[0].command.clone();
    let url = alternatives[0].url.clone();

    Some(DetectedProject {
        cwd,
        suggested_id: slugify(folder_name),
        suggested_name: folder_name.to_string(),
        project_type: "Deno".to_string(),
        group: Some("Backend".to_string()),
        shell: default_shell(),
        command: primary.clone(),
        url,
        package_manager: Some("deno".to_string()),
        alternatives,
        commands: Vec::new(),
        summary: if en {
            format!("Detected Deno project, default command \"{}\"", primary)
        } else {
            format!("已识别为 Deno 项目，默认命令「{}」", primary)
        },
    })
}

fn detect_php_project(
    path: &Path,
    cwd: String,
    folder_name: &str,
    en: bool,
) -> Option<DetectedProject> {
    let has_composer = path.join("composer.json").is_file();
    let has_artisan = path.join("artisan").is_file();
    if !has_composer && !has_artisan {
        return None;
    }

    let mut alternatives = Vec::new();
    let mut seen: HashSet<(String, String)> = HashSet::new();
    let (project_type, default_url) = if has_artisan {
        push_unique_option(
            &mut alternatives,
            &mut seen,
            CommandOption {
                id: "artisan-serve".to_string(),
                label: "php artisan serve".to_string(),
                command: "php artisan serve".to_string(),
                cwd: None,
                url: Some("http://localhost:8000".to_string()),
            },
        );
        ("PHP (Laravel)", Some("http://localhost:8000".to_string()))
    } else {
        ("PHP (Composer)", None)
    };

    if has_composer
        && let Ok(raw) = fs::read_to_string(path.join("composer.json"))
        && let Ok(val) = serde_json::from_str::<Value>(&raw)
        && let Some(scripts) = val.get("scripts").and_then(|s| s.as_object())
    {
        for key in ["dev", "serve", "start"] {
            if scripts.contains_key(key) {
                push_unique_option(
                    &mut alternatives,
                    &mut seen,
                    CommandOption {
                        id: slugify(key),
                        label: format!("composer {}", key),
                        command: format!("composer {}", key),
                        cwd: None,
                        url: default_url.clone(),
                    },
                );
            }
        }
    }

    if alternatives.is_empty() {
        push_unique_option(
            &mut alternatives,
            &mut seen,
            CommandOption {
                id: "php-server".to_string(),
                label: if en {
                    "PHP Built-in Server"
                } else {
                    "PHP 内置服务器"
                }
                .to_string(),
                command: "php -S localhost:8000 -t public".to_string(),
                cwd: None,
                url: Some("http://localhost:8000".to_string()),
            },
        );
    }

    if has_compose_file(path) {
        push_unique_option(
            &mut alternatives,
            &mut seen,
            CommandOption {
                id: "docker-compose".to_string(),
                label: "Docker Compose".to_string(),
                command: "docker compose up".to_string(),
                cwd: None,
                url: None,
            },
        );
    }

    let primary = alternatives[0].command.clone();
    let url = alternatives[0].url.clone().or(default_url);

    Some(DetectedProject {
        cwd,
        suggested_id: slugify(folder_name),
        suggested_name: folder_name.to_string(),
        project_type: project_type.to_string(),
        group: Some("Backend".to_string()),
        shell: default_shell(),
        command: primary.clone(),
        url,
        package_manager: Some("composer".to_string()),
        alternatives,
        commands: Vec::new(),
        summary: if en {
            format!("Detected {} project, default command \"{}\"", project_type, primary)
        } else {
            format!("已识别为 {} 项目，默认命令「{}」", project_type, primary)
        },
    })
}

fn extract_npm_workspace_dirs(path: &Path) -> HashSet<String> {
    let mut dirs = HashSet::new();
    let Ok(raw) = fs::read_to_string(path.join("package.json")) else {
        return dirs;
    };
    let Ok(pkg) = serde_json::from_str::<Value>(&raw) else {
        return dirs;
    };

    let arr = pkg
        .get("workspaces")
        .and_then(|w| {
            w.as_array()
                .or_else(|| w.get("packages").and_then(|p| p.as_array()))
        });

    if let Some(items) = arr {
        for item in items {
            if let Some(s) = item.as_str() {
                let top = s
                    .trim()
                    .trim_start_matches("./")
                    .split('/')
                    .next()
                    .unwrap_or("")
                    .trim();
                if !top.is_empty() && !top.contains('*') {
                    dirs.insert(top.to_ascii_lowercase());
                }
            }
        }
    }
    dirs
}

fn extract_pnpm_workspace_dirs(path: &Path) -> HashSet<String> {
    let mut dirs = HashSet::new();
    let Ok(raw) = fs::read_to_string(path.join("pnpm-workspace.yaml")) else {
        return dirs;
    };
    let mut in_packages = false;
    for line in raw.lines() {
        let trimmed = line.split('#').next().unwrap_or("").trim();
        if trimmed.is_empty() {
            continue;
        }
        if !line.starts_with(' ') && !line.starts_with('\t') && trimmed.ends_with(':') {
            in_packages = trimmed == "packages:";
            continue;
        }
        if in_packages && let Some(item) = trimmed.strip_prefix('-') {
            let clean = item
                .trim()
                .trim_matches('"')
                .trim_matches('\'')
                .trim_start_matches("./");
            if let Some(top) = clean.split('/').next().map(str::trim)
                && !top.is_empty()
                && !top.contains('*')
                && !top.starts_with('!')
            {
                dirs.insert(top.to_ascii_lowercase());
            }
        }
    }
    dirs
}

fn detect_single_root(
    path: &Path,
    cwd: String,
    folder_name: &str,
    en: bool,
) -> Option<DetectedProject> {
    if let Some(res) = detect_node_project(path, cwd.clone(), folder_name, en) {
        return Some(res);
    }
    if let Some(res) = detect_rust_project(path, cwd.clone(), folder_name, en) {
        return Some(res);
    }
    if let Some(res) = detect_python_project(path, cwd.clone(), folder_name, en) {
        return Some(res);
    }
    if let Some(res) = detect_go_project(path, cwd.clone(), folder_name, en) {
        return Some(res);
    }
    if let Some(res) = detect_java_project(path, cwd.clone(), folder_name, en) {
        return Some(res);
    }
    if let Some(res) = detect_dotnet_project(path, cwd.clone(), folder_name, en) {
        return Some(res);
    }
    if let Some(res) = detect_deno_project(path, cwd.clone(), folder_name, en) {
        return Some(res);
    }
    if let Some(res) = detect_php_project(path, cwd, folder_name, en) {
        return Some(res);
    }
    None
}

fn is_runnable_child(detected: &DetectedProject) -> bool {
    if detected.command.trim().is_empty() {
        return false;
    }
    // Skip library-only Node subpackages that have no runnable scripts
    if detected
        .package_manager
        .as_deref()
        .is_some_and(|pm| matches!(pm, "npm" | "pnpm" | "yarn" | "bun"))
        && detected.alternatives.is_empty()
    {
        return false;
    }
    true
}

fn list_visible_subdirs(dir: &Path, skip_extra: &HashSet<String>) -> Vec<(String, PathBuf)> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut subdirs: Vec<(String, PathBuf)> = entries
        .filter_map(|e| e.ok())
        .filter_map(|entry| {
            let p = entry.path();
            if !p.is_dir() {
                return None;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let lower = name.to_ascii_lowercase();
            if name.starts_with('.')
                || SKIP_SUBDIRS.contains(&lower.as_str())
                || skip_extra.contains(&lower)
            {
                return None;
            }
            Some((name, p))
        })
        .collect();
    subdirs.sort_by(|a, b| a.0.cmp(&b.0));
    subdirs
}

fn scan_child_projects(
    path: &Path,
    skip_extra: &HashSet<String>,
    en: bool,
) -> Vec<(String, DetectedProject)> {
    let subdirs = list_visible_subdirs(path, skip_extra);
    let mut found = Vec::new();

    for (name, subpath) in subdirs {
        let child_cwd = subpath.to_string_lossy().to_string();
        if let Some(detected) = detect_single_root(&subpath, child_cwd, &name, en) {
            if is_runnable_child(&detected) {
                found.push((name, detected));
            }
            continue;
        }

        let lower = name.to_ascii_lowercase();
        if MONOREPO_CONTAINER_DIRS.contains(&lower.as_str()) {
            let nested_dirs = list_visible_subdirs(&subpath, &HashSet::new());
            for (nested_name, nested_path) in nested_dirs {
                let nested_cwd = nested_path.to_string_lossy().to_string();
                if let Some(detected) =
                    detect_single_root(&nested_path, nested_cwd, &nested_name, en)
                    && is_runnable_child(&detected)
                {
                    found.push((format!("{}/{}", name, nested_name), detected));
                }
            }
        }
    }
    found
}

fn short_stack_name(proj: &DetectedProject) -> &'static str {
    if proj.project_type.starts_with("Rust") {
        "Rust"
    } else if proj.project_type.starts_with("Python") {
        "Python"
    } else if proj.project_type.starts_with("Go") {
        "Go"
    } else if proj.project_type.starts_with("Java") {
        "Java"
    } else if proj.project_type.starts_with("Tauri") {
        "Tauri"
    } else if proj.project_type.starts_with("Next") {
        "Next.js"
    } else if proj.project_type.starts_with("Vite") {
        "Vite"
    } else {
        "Node.js"
    }
}

fn join_rel_cwd(base: &str, nested: Option<&str>) -> String {
    match nested.map(str::trim).filter(|s| !s.is_empty()) {
        Some(sub) => format!("{}/{}", base, sub),
        None => base.to_string(),
    }
}

fn primary_options_for_project(proj: &DetectedProject) -> Vec<CommandOption> {
    if !proj.commands.is_empty() {
        return proj.commands.clone();
    }
    let label = proj
        .alternatives
        .first()
        .map(|a| a.label.clone())
        .unwrap_or_else(|| proj.suggested_name.clone());
    vec![CommandOption {
        id: slugify(&label),
        label,
        command: proj.command.clone(),
        cwd: None,
        url: proj.url.clone(),
    }]
}

pub fn detect_project(path: &Path) -> Result<DetectedProject, String> {
    detect_project_with_locale(path, i18n::current_locale())
}

pub fn detect_project_with_locale(path: &Path, locale: Locale) -> Result<DetectedProject, String> {
    let en = locale == Locale::En;
    if !path.is_dir() {
        return Err(if en {
            format!(
                "Selected directory does not exist or cannot be accessed: {}",
                path.display()
            )
        } else {
            format!("所选目录不存在或不可访问: {}", path.display())
        });
    }

    let cwd = path.to_string_lossy().to_string();
    let folder_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("project")
        .to_string();

    let root_opt = detect_single_root(path, cwd.clone(), &folder_name, en);
    let root_has_runnable = root_opt
        .as_ref()
        .is_some_and(|r| !r.alternatives.is_empty());
    let mut skip_extra = if root_has_runnable {
        extract_npm_workspace_dirs(path)
    } else {
        HashSet::new()
    };
    if root_has_runnable {
        skip_extra.extend(extract_pnpm_workspace_dirs(path));
    }
    let child_projects = scan_child_projects(path, &skip_extra, en);

    if let Some(root_proj) = root_opt
        && (root_has_runnable || child_projects.is_empty())
    {
        if !child_projects.is_empty() {
            let mut merged_commands = Vec::new();
            let mut seen_cmds: HashSet<(String, String)> = HashSet::new();
            let mut merged_alts = Vec::new();
            let mut seen_alts: HashSet<(String, String)> = HashSet::new();
            let mut stacks = vec![short_stack_name(&root_proj)];

            for opt in primary_options_for_project(&root_proj) {
                push_unique_option(&mut merged_commands, &mut seen_cmds, opt);
            }
            for alt in &root_proj.alternatives {
                push_unique_option(&mut merged_alts, &mut seen_alts, alt.clone());
            }

            for (child_name, child_proj) in &child_projects {
                let stack = short_stack_name(child_proj);
                if !stacks.contains(&stack) {
                    stacks.push(stack);
                }
                for opt in primary_options_for_project(child_proj) {
                    push_unique_option(
                        &mut merged_commands,
                        &mut seen_cmds,
                        CommandOption {
                            id: slugify(&format!("{}-{}", child_name, opt.id)),
                            label: format!("{} / {}", child_name, opt.label),
                            command: opt.command,
                            cwd: Some(join_rel_cwd(child_name, opt.cwd.as_deref())),
                            url: opt.url,
                        },
                    );
                }
                for alt in &child_proj.alternatives {
                    push_unique_option(
                        &mut merged_alts,
                        &mut seen_alts,
                        CommandOption {
                            id: slugify(&format!("{}-{}", child_name, alt.id)),
                            label: format!("{} / {}", child_name, alt.label),
                            command: alt.command.clone(),
                            cwd: Some(join_rel_cwd(child_name, alt.cwd.as_deref())),
                            url: alt.url.clone(),
                        },
                    );
                }
            }

            let project_type = if en {
                format!("Multi-module ({})", stacks.join(" + "))
            } else {
                format!("多模块项目 ({})", stacks.join(" + "))
            };
            let primary_cmd = merged_commands
                .first()
                .map(|o| o.command.clone())
                .unwrap_or(root_proj.command);
            let url = merged_commands
                .iter()
                .find_map(|o| o.url.clone())
                .or(root_proj.url);
            let summary = if en {
                format!(
                    "Detected {} with {} launch modes",
                    project_type,
                    merged_commands.len()
                )
            } else {
                format!(
                    "已识别为{}，共发现 {} 个启动模式",
                    project_type,
                    merged_commands.len()
                )
            };

            return Ok(DetectedProject {
                cwd,
                suggested_id: root_proj.suggested_id,
                suggested_name: root_proj.suggested_name,
                project_type,
                group: root_proj.group.or_else(|| Some("Monorepo".to_string())),
                shell: root_proj.shell,
                command: primary_cmd,
                url,
                package_manager: root_proj.package_manager,
                alternatives: merged_alts,
                commands: if merged_commands.len() >= 2 {
                    merged_commands
                } else {
                    Vec::new()
                },
                summary,
            });
        }
        return Ok(root_proj);
    }

    if !child_projects.is_empty() {
        let mut merged_commands = Vec::new();
        let mut seen_cmds: HashSet<(String, String)> = HashSet::new();
        let mut merged_alts = Vec::new();
        let mut seen_alts: HashSet<(String, String)> = HashSet::new();
        let mut stacks = Vec::new();

        for (child_name, child_proj) in &child_projects {
            let stack = short_stack_name(child_proj);
            if !stacks.contains(&stack) {
                stacks.push(stack);
            }
            for opt in primary_options_for_project(child_proj) {
                push_unique_option(
                    &mut merged_commands,
                    &mut seen_cmds,
                    CommandOption {
                        id: slugify(&format!("{}-{}", child_name, opt.id)),
                        label: format!("{} / {}", child_name, opt.label),
                        command: opt.command,
                        cwd: Some(join_rel_cwd(child_name, opt.cwd.as_deref())),
                        url: opt.url,
                    },
                );
            }
            for alt in &child_proj.alternatives {
                push_unique_option(
                    &mut merged_alts,
                    &mut seen_alts,
                    CommandOption {
                        id: slugify(&format!("{}-{}", child_name, alt.id)),
                        label: format!("{} / {}", child_name, alt.label),
                        command: alt.command.clone(),
                        cwd: Some(join_rel_cwd(child_name, alt.cwd.as_deref())),
                        url: alt.url.clone(),
                    },
                );
            }
        }

        if has_compose_file(path) {
            push_unique_option(
                &mut merged_alts,
                &mut seen_alts,
                CommandOption {
                    id: "docker-compose".to_string(),
                    label: "Docker Compose".to_string(),
                    command: "docker compose up".to_string(),
                    cwd: None,
                    url: None,
                },
            );
        }

        let project_type = if en {
            format!("Multi-module ({})", stacks.join(" + "))
        } else {
            format!("多模块项目 ({})", stacks.join(" + "))
        };
        let primary_cmd = merged_commands
            .first()
            .map(|o| o.command.clone())
            .unwrap_or_default();
        let url = merged_commands.iter().find_map(|o| o.url.clone());
        let commands = if merged_commands.len() >= 2 {
            merged_commands
        } else {
            Vec::new()
        };
        let summary = match (en, !commands.is_empty()) {
            (true, true) => format!("Detected {} with {} launch modes", project_type, commands.len()),
            (true, false) => format!("Detected {}, default command \"{}\"", project_type, primary_cmd),
            (false, true) => format!("已识别为{}，共发现 {} 个启动模式", project_type, commands.len()),
            (false, false) => format!("已识别为{}，默认命令「{}」", project_type, primary_cmd),
        };

        return Ok(DetectedProject {
            cwd,
            suggested_id: slugify(&folder_name),
            suggested_name: folder_name,
            project_type,
            group: Some("Monorepo".to_string()),
            shell: default_shell(),
            command: primary_cmd,
            url,
            package_manager: None,
            alternatives: merged_alts,
            commands,
            summary,
        });
    }

    if has_compose_file(path) {
        return Ok(DetectedProject {
            cwd,
            suggested_id: slugify(&folder_name),
            suggested_name: folder_name,
            project_type: "Docker Compose".to_string(),
            group: Some("Infra".to_string()),
            shell: default_shell(),
            command: "docker compose up".to_string(),
            url: None,
            package_manager: Some("docker".to_string()),
            alternatives: vec![CommandOption {
                id: "docker-compose".to_string(),
                label: "docker compose up".to_string(),
                command: "docker compose up".to_string(),
                cwd: None,
                url: None,
            }],
            commands: Vec::new(),
            summary: if en {
                "Detected Docker Compose project, configured docker compose up".to_string()
            } else {
                "已识别为 Docker Compose 项目，已自动配置 docker compose up".to_string()
            },
        });
    }

    Ok(DetectedProject {
        cwd,
        suggested_id: slugify(&folder_name),
        suggested_name: folder_name,
        project_type: if en {
            "Custom Directory".to_string()
        } else {
            "自定义目录".to_string()
        },
        group: None,
        shell: default_shell(),
        command: String::new(),
        url: None,
        package_manager: None,
        alternatives: Vec::new(),
        commands: Vec::new(),
        summary: if en {
            "No common project manifest found; pre-filled directory and shell — please enter a start command".to_string()
        } else {
            "未检测到常见项目配置文件，已自动填充目录与默认 Shell，请补充启动命令".to_string()
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_temp_dir(label: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("devpanel_detect_{}_{}", label, nanos));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn detects_vite_pnpm_project() {
        let dir = make_temp_dir("vite_pnpm");
        fs::write(dir.join("pnpm-lock.yaml"), "").unwrap();
        fs::write(
            dir.join("package.json"),
            r#"{
              "name": "@acme/web-console",
              "scripts": {
                "dev": "vite --port 5178",
                "preview": "vite preview"
              },
              "dependencies": { "react": "^19.0.0" },
              "devDependencies": { "vite": "^6.0.0" }
            }"#,
        )
        .unwrap();

        let res = detect_project(&dir).unwrap();
        assert_eq!(res.project_type, "Vite + React");
        assert_eq!(res.package_manager.as_deref(), Some("pnpm"));
        if cfg!(windows) {
            assert_eq!(res.command, "pnpm run dev --host 127.0.0.1");
            assert_eq!(res.alternatives.len(), 3);
        } else {
            assert_eq!(res.command, "pnpm run dev");
            assert_eq!(res.alternatives.len(), 2);
        }
        assert_eq!(res.url.as_deref(), Some("http://localhost:5178"));
        assert_eq!(res.suggested_id, "web-console");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn detects_vite_config_port_and_host() {
        let dir_no_host = make_temp_dir("vite_port_only");
        fs::write(
            dir_no_host.join("package.json"),
            r#"{
              "name": "web-no-host",
              "scripts": { "dev": "vite" },
              "dependencies": { "vue": "^3.5.0" },
              "devDependencies": { "vite": "^8.0.0" }
            }"#,
        )
        .unwrap();
        fs::write(
            dir_no_host.join("vite.config.ts"),
            "export default defineConfig({\n  server: {\n    // host: '0.0.0.0',\n    port: 5175,\n    strictPort: true\n  }\n})\n",
        )
        .unwrap();
        let res1 = detect_project(&dir_no_host).unwrap();
        assert_eq!(res1.project_type, "Vite + Vue");
        assert_eq!(res1.url.as_deref(), Some("http://localhost:5175"));
        if cfg!(windows) {
            assert_eq!(res1.command, "npm run dev -- --host 127.0.0.1");
            assert!(res1.alternatives.iter().any(|o| o.command == "npm run dev"));
        }
        let _ = fs::remove_dir_all(&dir_no_host);

        let dir_with_host = make_temp_dir("vite_with_host");
        fs::write(
            dir_with_host.join("package.json"),
            r#"{
              "name": "web-with-host",
              "scripts": { "dev": "vite" },
              "dependencies": { "vue": "^3.5.0" },
              "devDependencies": { "vite": "^8.0.0" }
            }"#,
        )
        .unwrap();
        fs::write(
            dir_with_host.join("vite.config.ts"),
            "export default defineConfig({\n  server: {\n    host: '127.0.0.1',\n    port: 5179\n  }\n})\n",
        )
        .unwrap();
        let res2 = detect_project(&dir_with_host).unwrap();
        assert_eq!(res2.command, "npm run dev");
        assert_eq!(res2.url.as_deref(), Some("http://localhost:5179"));
        assert_eq!(res2.alternatives.len(), 1);
        let _ = fs::remove_dir_all(&dir_with_host);
    }

    #[test]
    fn detects_spring_boot_ports_from_yaml_and_properties() {
        let yaml_dir = make_temp_dir("spring_yaml");
        fs::create_dir_all(yaml_dir.join("src/main/resources")).unwrap();
        fs::write(
            yaml_dir.join("pom.xml"),
            "<project><dependencies><dependency>spring-boot-starter-web</dependency></dependencies></project>",
        )
        .unwrap();
        fs::write(
            yaml_dir.join("src/main/resources/application.yaml"),
            "server:\n  port: ${SERVER_PORT:9100} # dev port\nspring:\n  application:\n    name: demo\n",
        )
        .unwrap();
        let res_yaml = detect_project(&yaml_dir).unwrap();
        assert_eq!(res_yaml.project_type, "Java (Spring Boot / Maven)");
        assert_eq!(res_yaml.url.as_deref(), Some("http://localhost:9100"));
        let _ = fs::remove_dir_all(&yaml_dir);

        let props_dir = make_temp_dir("spring_props");
        fs::create_dir_all(props_dir.join("src/main/resources")).unwrap();
        fs::write(
            props_dir.join("pom.xml"),
            "<project><dependencies><dependency>spring-boot-starter-web</dependency></dependencies></project>",
        )
        .unwrap();
        fs::write(
            props_dir.join("src/main/resources/application.properties"),
            "# comment\nserver.port=8090\n",
        )
        .unwrap();
        let res_props = detect_project(&props_dir).unwrap();
        assert_eq!(res_props.url.as_deref(), Some("http://localhost:8090"));
        let _ = fs::remove_dir_all(&props_dir);
    }

    #[test]
    fn detects_tauri_project() {
        let dir = make_temp_dir("tauri");
        fs::create_dir_all(dir.join("src-tauri")).unwrap();
        fs::write(
            dir.join("src-tauri").join("tauri.conf.json"),
            r#"{"build":{"devUrl":"http://127.0.0.1:1420"}}"#,
        )
        .unwrap();
        fs::write(
            dir.join("package.json"),
            r#"{
              "name": "dev-panel",
              "scripts": { "dev": "vite", "tauri": "tauri" },
              "devDependencies": { "@tauri-apps/cli": "^2", "vite": "^6" }
            }"#,
        )
        .unwrap();

        let res = detect_project(&dir).unwrap();
        assert_eq!(res.project_type, "Tauri 桌面应用");
        assert_eq!(res.command, "npm run tauri dev");
        assert_eq!(res.url.as_deref(), Some("http://127.0.0.1:1420"));
        assert_eq!(res.group.as_deref(), Some("Desktop"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn detects_rust_python_go_and_unknown() {
        let rust_dir = make_temp_dir("rust");
        fs::write(
            rust_dir.join("Cargo.toml"),
            "[package]\nname = \"my-api\"\n[dependencies]\naxum = \"0.8\"\n",
        )
        .unwrap();
        let rust_res = detect_project(&rust_dir).unwrap();
        assert_eq!(rust_res.project_type, "Rust (Cargo)");
        assert_eq!(rust_res.command, "cargo run");
        assert_eq!(rust_res.url.as_deref(), Some("http://localhost:8080"));
        let _ = fs::remove_dir_all(&rust_dir);

        let py_dir = make_temp_dir("fastapi");
        fs::write(
            py_dir.join("pyproject.toml"),
            "[project]\ndependencies = [\"fastapi\", \"uvicorn\"]\n",
        )
        .unwrap();
        fs::write(py_dir.join("main.py"), "").unwrap();
        let py_res = detect_project(&py_dir).unwrap();
        assert_eq!(py_res.project_type, "Python (FastAPI)");
        assert!(py_res.command.contains("uvicorn main:app --reload"));
        let _ = fs::remove_dir_all(&py_dir);

        let go_dir = make_temp_dir("go");
        fs::write(go_dir.join("go.mod"), "module example.com/svc\nrequire github.com/gin-gonic/gin v1.10.0\n").unwrap();
        let go_res = detect_project(&go_dir).unwrap();
        assert_eq!(go_res.project_type, "Go");
        assert_eq!(go_res.command, "go run .");
        assert_eq!(go_res.url.as_deref(), Some("http://localhost:8080"));
        let _ = fs::remove_dir_all(&go_dir);

        let empty_dir = make_temp_dir("empty");
        let empty_res = detect_project(&empty_dir).unwrap();
        assert_eq!(empty_res.project_type, "自定义目录");
        assert_eq!(empty_res.command, "");
        let _ = fs::remove_dir_all(&empty_dir);
    }

    #[test]
    fn detects_cargo_workspace_multiple_binaries() {
        let dir = make_temp_dir("cargo_ws");
        fs::write(
            dir.join("Cargo.toml"),
            "[workspace]\nresolver = \"3\"\nmembers = [\"crates/agent-core\", \"crates/agent-app\", \"crates/agent-update\"]\n",
        )
        .unwrap();

        let app_dir = dir.join("crates/agent-app");
        fs::create_dir_all(app_dir.join("src")).unwrap();
        fs::write(
            app_dir.join("Cargo.toml"),
            "[package]\nname = \"liyin-agent-app\"\nversion = \"0.1.0\"\n[[bin]]\nname = \"liyin-rpa-agent\"\npath = \"src/main.rs\"\n[dependencies]\ntauri = \"2\"\n",
        )
        .unwrap();
        fs::write(app_dir.join("src/main.rs"), "fn main() {}").unwrap();

        let core_dir = dir.join("crates/agent-core");
        fs::create_dir_all(core_dir.join("src/bin")).unwrap();
        fs::write(
            core_dir.join("Cargo.toml"),
            "[package]\nname = \"liyin-agent-core\"\nversion = \"0.1.0\"\n[lib]\nname = \"liyin_agent_core\"\n[[bin]]\nname = \"liyin-rpa-agentd\"\npath = \"src/bin/liyin-rpa-agentd.rs\"\n",
        )
        .unwrap();
        fs::write(core_dir.join("src/lib.rs"), "").unwrap();
        fs::write(core_dir.join("src/bin/liyin-rpa-agentd.rs"), "fn main() {}").unwrap();

        let upd_dir = dir.join("crates/agent-update");
        fs::create_dir_all(upd_dir.join("src")).unwrap();
        fs::write(
            upd_dir.join("Cargo.toml"),
            "[package]\nname = \"liyin-agent-update\"\nversion = \"0.1.0\"\n",
        )
        .unwrap();
        fs::write(upd_dir.join("src/lib.rs"), "").unwrap();

        let res = detect_project(&dir).unwrap();
        assert_eq!(res.project_type, "Rust (Cargo Workspace)");
        assert_eq!(res.commands.len(), 2);
        assert_eq!(res.commands[0].command, "cargo run -p liyin-agent-app");
        assert_eq!(
            res.commands[1].command,
            "cargo run -p liyin-agent-core --bin liyin-rpa-agentd"
        );
        assert!(!res
            .commands
            .iter()
            .any(|c| c.command.contains("liyin-agent-update")));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn detects_hybrid_node_and_rust_monorepo() {
        let dir = make_temp_dir("hybrid_edge");
        fs::write(
            dir.join("package.json"),
            r#"{
              "name": "liyin-rpa-edge",
              "workspaces": ["contracts", "node-runtime", "packages/*", "examples/*"],
              "scripts": {
                "dev": "npm run dev -w liyin-rpa-devtools --",
                "test:watch": "vitest"
              }
            }"#,
        )
        .unwrap();

        // Library workspace package without runnable scripts should be skipped
        let nr_dir = dir.join("node-runtime");
        fs::create_dir_all(&nr_dir).unwrap();
        fs::write(nr_dir.join("package.json"), r#"{"name": "@liyin/rpa-runtime"}"#).unwrap();

        // Rust Cargo workspace subdir with 2 binaries
        let host_dir = dir.join("agent-host");
        fs::create_dir_all(host_dir.join("crates/agent-app/src")).unwrap();
        fs::create_dir_all(host_dir.join("crates/agent-core/src/bin")).unwrap();
        fs::write(
            host_dir.join("Cargo.toml"),
            "[workspace]\nmembers = [\"crates/*\"]\n",
        )
        .unwrap();
        fs::write(
            host_dir.join("crates/agent-app/Cargo.toml"),
            "[package]\nname = \"liyin-agent-app\"\n[[bin]]\nname = \"liyin-rpa-agent\"\npath = \"src/main.rs\"\n[dependencies]\ntauri = \"2\"\n",
        )
        .unwrap();
        fs::write(host_dir.join("crates/agent-app/src/main.rs"), "fn main() {}").unwrap();
        fs::write(
            host_dir.join("crates/agent-core/Cargo.toml"),
            "[package]\nname = \"liyin-agent-core\"\n[lib]\n[[bin]]\nname = \"liyin-rpa-agentd\"\npath = \"src/bin/liyin-rpa-agentd.rs\"\n",
        )
        .unwrap();
        fs::write(host_dir.join("crates/agent-core/src/lib.rs"), "").unwrap();
        fs::write(
            host_dir.join("crates/agent-core/src/bin/liyin-rpa-agentd.rs"),
            "fn main() {}",
        )
        .unwrap();

        let res = detect_project(&dir).unwrap();
        assert_eq!(res.project_type, "多模块项目 (Node.js + Rust)");
        assert_eq!(res.commands.len(), 3);
        assert_eq!(res.commands[0].cwd, None);
        assert_eq!(res.commands[0].command, "npm run dev");
        assert_eq!(res.commands[1].cwd.as_deref(), Some("agent-host"));
        assert_eq!(res.commands[1].command, "cargo run -p liyin-agent-app");
        assert_eq!(res.commands[2].cwd.as_deref(), Some("agent-host"));
        assert_eq!(
            res.commands[2].command,
            "cargo run -p liyin-agent-core --bin liyin-rpa-agentd"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn detects_two_level_pnpm_monorepo_and_more_languages() {
        let mono_dir = make_temp_dir("pnpm_mono");
        fs::write(
            mono_dir.join("package.json"),
            r#"{"name": "acme-workspace", "private": true}"#,
        )
        .unwrap();
        fs::write(
            mono_dir.join("pnpm-workspace.yaml"),
            "packages:\n  - 'apps/*'\n  - 'services/*'\n",
        )
        .unwrap();
        let web_dir = mono_dir.join("apps/web");
        fs::create_dir_all(&web_dir).unwrap();
        fs::write(
            web_dir.join("package.json"),
            r#"{"name":"web","scripts":{"dev":"vite"},"devDependencies":{"vite":"^6.0.0"}}"#,
        )
        .unwrap();
        let api_dir = mono_dir.join("services/api");
        fs::create_dir_all(&api_dir).unwrap();
        fs::write(api_dir.join("go.mod"), "module acme/api\n").unwrap();

        let mono_res = detect_project(&mono_dir).unwrap();
        assert_eq!(mono_res.project_type, "多模块项目 (Vite + Go)");
        assert_eq!(mono_res.commands.len(), 2);
        assert_eq!(mono_res.commands[0].cwd.as_deref(), Some("apps/web"));
        assert_eq!(mono_res.commands[1].cwd.as_deref(), Some("services/api"));
        let _ = fs::remove_dir_all(&mono_dir);

        let dotnet_dir = make_temp_dir("dotnet");
        fs::write(dotnet_dir.join("MyApi.csproj"), "<Project />").unwrap();
        let dotnet_res = detect_project(&dotnet_dir).unwrap();
        assert_eq!(dotnet_res.project_type, ".NET");
        assert_eq!(dotnet_res.command, "dotnet watch run");
        let _ = fs::remove_dir_all(&dotnet_dir);

        let deno_dir = make_temp_dir("deno");
        fs::write(
            deno_dir.join("deno.json"),
            r#"{"tasks":{"dev":"deno run --watch main.ts --port 3456"}}"#,
        )
        .unwrap();
        let deno_res = detect_project(&deno_dir).unwrap();
        assert_eq!(deno_res.project_type, "Deno");
        assert_eq!(deno_res.command, "deno task dev");
        assert_eq!(deno_res.url.as_deref(), Some("http://localhost:3456"));
        let _ = fs::remove_dir_all(&deno_dir);

        let php_dir = make_temp_dir("laravel");
        fs::write(php_dir.join("composer.json"), r#"{"name":"acme/app"}"#).unwrap();
        fs::write(php_dir.join("artisan"), "#!/usr/bin/env php").unwrap();
        let php_res = detect_project(&php_dir).unwrap();
        assert_eq!(php_res.project_type, "PHP (Laravel)");
        assert_eq!(php_res.command, "php artisan serve");
        assert_eq!(php_res.url.as_deref(), Some("http://localhost:8000"));
        let _ = fs::remove_dir_all(&php_dir);
    }

    #[test]
    fn detects_projects_in_english_locale() {
        let empty_dir = make_temp_dir("empty_en");
        let empty_res = detect_project_with_locale(&empty_dir, Locale::En).unwrap();
        assert_eq!(empty_res.project_type, "Custom Directory");
        assert!(empty_res.summary.contains("No common project manifest"));
        let _ = fs::remove_dir_all(&empty_dir);

        let tauri_dir = make_temp_dir("tauri_en");
        let tauri_sub = tauri_dir.join("src-tauri");
        fs::create_dir_all(&tauri_sub).unwrap();
        fs::write(tauri_sub.join("tauri.conf.json"), r#"{"build":{}}"#).unwrap();
        fs::write(
            tauri_dir.join("package.json"),
            r#"{"name":"demo","scripts":{"dev":"vite","tauri":"tauri"},"devDependencies":{"@tauri-apps/cli":"^2"}}"#,
        )
        .unwrap();
        let tauri_res = detect_project_with_locale(&tauri_dir, Locale::En).unwrap();
        assert_eq!(tauri_res.project_type, "Tauri Desktop App");
        assert!(tauri_res.summary.contains("Detected Tauri Desktop App"));
        let _ = fs::remove_dir_all(&tauri_dir);
    }
}
