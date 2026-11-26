import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  MemoryHistoryPoint,
  ProjectConfig,
  SessionMemoryInfo,
} from "../types/project.ts";
import {
  buildMiniSparklinePoints,
  buildSessionMemoryMap,
  computeHistoryStats,
  formatBytes,
  formatBytesCompact,
  formatMemoryShare,
  getMemoryLevel,
  getProjectTotalMemoryBytes,
} from "./memoryFormat.ts";

describe("memoryFormat helpers", () => {
  it("formats byte sizes across units", () => {
    assert.equal(formatBytes(0), "0 B");
    assert.equal(formatBytes(-10), "0 B");
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(1536), "1.5 KB");
    assert.equal(formatBytes(12.5 * 1024 * 1024), "12.5 MB");
    assert.equal(formatBytes(248 * 1024 * 1024), "248 MB");
    assert.equal(formatBytes(2.5 * 1024 * 1024 * 1024), "2.50 GB");
    assert.equal(formatBytes(12.4 * 1024 * 1024 * 1024), "12.4 GB");
    assert.equal(formatBytes(1.25 * 1024 * 1024 * 1024 * 1024), "1.25 TB");
  });

  it("formats compact byte sizes for badges", () => {
    assert.equal(formatBytesCompact(0), "0 MB");
    assert.equal(formatBytesCompact(256 * 1024), "<1 MB");
    assert.equal(formatBytesCompact(128 * 1024 * 1024), "128 MB");
    assert.equal(formatBytesCompact(1.4 * 1024 * 1024 * 1024), "1.4 GB");
  });

  it("classifies memory usage threshold levels", () => {
    assert.equal(getMemoryLevel(42), "normal");
    assert.equal(getMemoryLevel(75), "warning");
    assert.equal(getMemoryLevel(89.9), "warning");
    assert.equal(getMemoryLevel(90), "danger");
    assert.equal(getMemoryLevel(99), "danger");
  });

  it("aggregates multi-command project memory from session map", () => {
    const sessions: SessionMemoryInfo[] = [
      {
        sessionKey: "mono::api",
        rootPid: 100,
        rssBytes: 150 * 1024 * 1024,
        privateBytes: 120 * 1024 * 1024,
        processCount: 2,
        processes: [],
      },
      {
        sessionKey: "mono::web",
        rootPid: 200,
        rssBytes: 250 * 1024 * 1024,
        privateBytes: 200 * 1024 * 1024,
        processCount: 3,
        processes: [],
      },
    ];
    const map = buildSessionMemoryMap(sessions);

    const mono: ProjectConfig = {
      id: "mono",
      name: "Mono",
      cwd: "/mono",
      command: "pnpm dev",
      commands: [
        { id: "api", name: "API", command: "cargo run" },
        { id: "web", name: "Web", command: "vite" },
      ],
    };
    const single: ProjectConfig = {
      id: "other",
      name: "Other",
      cwd: "/other",
      command: "node index.js",
    };

    assert.equal(
      getProjectTotalMemoryBytes(mono, map),
      400 * 1024 * 1024
    );
    assert.equal(getProjectTotalMemoryBytes(single, map), 0);
  });

  it("computes history summary statistics", () => {
    assert.deepEqual(computeHistoryStats([]), {
      systemCurrent: 0,
      systemPeak: 0,
      systemAvg: 0,
      managedCurrent: 0,
      managedPeak: 0,
      managedAvg: 0,
    });

    const points: MemoryHistoryPoint[] = [
      {
        timestampMs: 1000,
        systemPercent: 40,
        systemUsedBytes: 4000,
        managedRssBytes: 100,
        appRssBytes: 50,
      },
      {
        timestampMs: 2000,
        systemPercent: 80,
        systemUsedBytes: 8000,
        managedRssBytes: 300,
        appRssBytes: 60,
      },
      {
        timestampMs: 3000,
        systemPercent: 60,
        systemUsedBytes: 6000,
        managedRssBytes: 200,
        appRssBytes: 55,
      },
    ];

    assert.deepEqual(computeHistoryStats(points), {
      systemCurrent: 60,
      systemPeak: 80,
      systemAvg: 60,
      managedCurrent: 200,
      managedPeak: 300,
      managedAvg: 200,
    });
  });

  it("formats memory share percentages with sub-0.1% floor", () => {
    assert.equal(formatMemoryShare(0, 1000), "0.0%");
    assert.equal(formatMemoryShare(100, 0), "0.0%");
    assert.equal(formatMemoryShare(1, 5000), "<0.1%");
    assert.equal(formatMemoryShare(256, 1024), "25.0%");
  });

  it("builds SVG mini sparkline polyline points", () => {
    assert.equal(buildMiniSparklinePoints([], 36, 12), "");
    assert.equal(buildMiniSparklinePoints([100], 36, 12), "");
    const pts = buildMiniSparklinePoints([0, 50, 100], 40, 14, 2);
    const coords = pts.split(" ");
    assert.equal(coords.length, 3);
    assert.ok(coords[0].startsWith("0,"));
    assert.ok(coords[2].startsWith("40,"));
  });
});
