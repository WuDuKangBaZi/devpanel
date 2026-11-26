import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProjectConfig, SessionMemoryInfo } from "../types/project.ts";
import {
  buildMiniSessionItems,
  clampMiniBounds,
  DEFAULT_MINI_BOUNDS,
  MINI_MAX_HEIGHT,
  MINI_MAX_WIDTH,
  MINI_MIN_HEIGHT,
  MINI_MIN_WIDTH,
} from "./miniMode.ts";

describe("miniMode helpers", () => {
  it("clamps mini window bounds and preserves finite coordinates", () => {
    assert.deepEqual(clampMiniBounds({}), DEFAULT_MINI_BOUNDS);
    assert.deepEqual(
      clampMiniBounds({ width: 100, height: 80, x: 42.6, y: Number.NaN }),
      {
        width: MINI_MIN_WIDTH,
        height: MINI_MIN_HEIGHT,
        x: 43,
      }
    );
    assert.deepEqual(
      clampMiniBounds({ width: 1200, height: 1400, x: 100, y: 200 }),
      {
        width: MINI_MAX_WIDTH,
        height: MINI_MAX_HEIGHT,
        x: 100,
        y: 200,
      }
    );
  });

  it("flattens single and multi-command projects with status, URL, and memory", () => {
    const projects: ProjectConfig[] = [
      {
        id: "web",
        name: "Web",
        cwd: "/web",
        command: "pnpm dev",
        url: "http://localhost:5173",
      },
      {
        id: "mono",
        name: "Mono",
        cwd: "/mono",
        command: "pnpm dev",
        commands: [
          { id: "api", name: "API", command: "cargo run" },
          {
            id: "ui",
            name: "UI",
            command: "vite",
            url: "http://localhost:3000",
          },
        ],
      },
    ];
    const memory: Record<string, SessionMemoryInfo> = {
      web: {
        sessionKey: "web",
        rootPid: 10,
        rssBytes: 128 * 1024 * 1024,
        privateBytes: 90 * 1024 * 1024,
        processCount: 2,
        processes: [],
      },
    };

    const items = buildMiniSessionItems(
      projects,
      { web: "running", "mono::api": "starting" },
      { "mono::api": "http://127.0.0.1:8080" },
      memory
    );

    assert.equal(items.length, 3);
    assert.deepEqual(items[0], {
      sessionKey: "web",
      projectId: "web",
      commandId: null,
      title: "Web",
      status: "running",
      url: "http://localhost:5173",
      rssBytes: 128 * 1024 * 1024,
    });
    assert.deepEqual(items[1], {
      sessionKey: "mono::api",
      projectId: "mono",
      commandId: "api",
      title: "Mono",
      subtitle: "API",
      status: "starting",
      url: undefined,
      rssBytes: 0,
    });
    assert.equal(items[2].url, "http://localhost:3000");
    assert.equal(items[2].status, "stopped");
  });
});
