import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LaunchBinding, ProjectConfig } from "../types/project.ts";
import {
  getProjectAggregateStatus,
  makeSessionKey,
  makeUniqueId,
  resolveBindingTargets,
  resolveCommandCwd,
  resolveProjectOpenUrl,
  resolveSessionOpenUrl,
  slugifyId,
} from "./projectCommands.ts";

describe("projectCommands helpers", () => {
  it("builds session keys consistently", () => {
    assert.equal(makeSessionKey("app"), "app");
    assert.equal(makeSessionKey("app", null), "app");
    assert.equal(makeSessionKey("app", "  "), "app");
    assert.equal(makeSessionKey("app", "api"), "app::api");
  });

  it("resolves relative and absolute command working directories", () => {
    assert.equal(resolveCommandCwd("D:\\Code\\repo"), "D:\\Code\\repo");
    assert.equal(
      resolveCommandCwd("D:\\Code\\repo\\", "apps/web"),
      "D:\\Code\\repo\\apps\\web"
    );
    assert.equal(resolveCommandCwd("/srv/repo/", "services/api"), "/srv/repo/services/api");
    assert.equal(resolveCommandCwd("D:\\Code\\repo", "E:\\Other"), "E:\\Other");
    assert.equal(resolveCommandCwd("/srv/repo", "/opt/other"), "/opt/other");
  });

  it("computes project aggregate status across multi-command sessions", () => {
    const project: ProjectConfig = {
      id: "mono",
      name: "Mono",
      cwd: "/mono",
      command: "npm run dev",
      commands: [
        { id: "web", name: "Web", command: "npm run dev" },
        { id: "api", name: "API", command: "cargo run" },
      ],
    };
    assert.equal(getProjectAggregateStatus(project, {}), "stopped");
    assert.equal(
      getProjectAggregateStatus(project, { "mono::api": "starting" }),
      "starting"
    );
    assert.equal(
      getProjectAggregateStatus(project, {
        "mono::web": "running",
        "mono::api": "stopping",
      }),
      "running"
    );
  });

  it("resolves binding targets and deduplicates repeated entries", () => {
    const projects: ProjectConfig[] = [
      { id: "db", name: "DB", cwd: "/db", command: "docker compose up" },
      {
        id: "mono",
        name: "Mono",
        cwd: "/mono",
        command: "npm run dev",
        commands: [
          { id: "web", name: "Web", command: "npm run dev" },
          { id: "api", name: "API", command: "cargo run" },
        ],
      },
    ];
    const binding: LaunchBinding = {
      id: "stack",
      name: "Stack",
      targets: [
        { projectId: "db" },
        { projectId: "mono", commandId: "api" },
        { projectId: "mono", commandId: "api" },
        { projectId: "missing" },
      ],
    };
    const resolved = resolveBindingTargets(binding, projects);
    assert.equal(resolved.length, 2);
    assert.equal(resolved[0].sessionKey, "db");
    assert.equal(resolved[1].sessionKey, "mono::api");
    assert.equal(resolved[1].label, "Mono · API");
  });

  it("slugifies and creates unique IDs", () => {
    assert.equal(slugifyId(" My Web App! "), "my-web-app");
    assert.equal(makeUniqueId("api", ["api", "api-2"]), "api-3");
  });

  it("hides open URLs unless a local access URL is configured", () => {
    assert.equal(
      resolveSessionOpenUrl(undefined, "http://127.0.0.1:5173"),
      undefined
    );
    assert.equal(
      resolveSessionOpenUrl("   ", "http://127.0.0.1:5173"),
      undefined
    );
    assert.equal(
      resolveSessionOpenUrl("http://localhost:5173", "http://127.0.0.1:5174"),
      "http://127.0.0.1:5174"
    );
    assert.equal(
      resolveSessionOpenUrl("http://localhost:5173", undefined),
      "http://localhost:5173"
    );

    const noUrlProject: ProjectConfig = {
      id: "worker",
      name: "Worker",
      cwd: "/worker",
      command: "python worker.py",
    };
    assert.equal(
      resolveProjectOpenUrl(noUrlProject, { worker: "http://127.0.0.1:8000" }),
      undefined
    );

    const monoNoUrl: ProjectConfig = {
      id: "mono-no-url",
      name: "Mono",
      cwd: "/mono",
      command: "pnpm dev",
      commands: [{ id: "api", name: "API", command: "cargo run" }],
    };
    assert.equal(
      resolveProjectOpenUrl(monoNoUrl, {
        "mono-no-url::api": "http://127.0.0.1:8080",
      }),
      undefined
    );

    const monoPartialUrl: ProjectConfig = {
      id: "mono",
      name: "Mono",
      cwd: "/mono",
      command: "pnpm dev",
      commands: [
        { id: "api", name: "API", command: "cargo run" },
        {
          id: "web",
          name: "Web",
          command: "vite",
          url: "http://localhost:5173",
        },
      ],
    };
    assert.equal(
      resolveProjectOpenUrl(monoPartialUrl, {
        "mono::api": "http://127.0.0.1:8080",
      }),
      "http://localhost:5173"
    );
    assert.equal(
      resolveProjectOpenUrl(monoPartialUrl, {
        "mono::web": "http://127.0.0.1:5174",
      }),
      "http://127.0.0.1:5174"
    );
  });
});
