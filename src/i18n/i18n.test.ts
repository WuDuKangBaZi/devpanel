import assert from "node:assert/strict";
import test from "node:test";
import { en } from "./en.ts";
import { zhCN } from "./zh-CN.ts";

function collectLeafPaths(obj: Record<string, unknown>, prefix = ""): string[] {
  const paths: string[] = [];
  for (const [key, val] of Object.entries(obj)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (val && typeof val === "object" && !Array.isArray(val)) {
      paths.push(...collectLeafPaths(val as Record<string, unknown>, next));
    } else {
      paths.push(next);
    }
  }
  return paths.sort();
}

test("en and zh-CN dictionaries have identical key structure", () => {
  const zhPaths = collectLeafPaths(zhCN as unknown as Record<string, unknown>);
  const enPaths = collectLeafPaths(en as unknown as Record<string, unknown>);
  assert.deepEqual(enPaths, zhPaths);
});

test("parameterized i18n formatters produce non-empty localized text", () => {
  assert.equal(zhCN.status.ofStatus("running"), "运行中");
  assert.equal(en.status.ofStatus("running"), "Running");
  assert.match(zhCN.toasts.projectSaved("Web"), /Web/);
  assert.match(en.toasts.projectSaved("Web"), /Web/);
  assert.equal(en.sidebar.commandsCount(1), "1 cmd");
  assert.equal(en.sidebar.commandsCount(3), "3 cmds");
});
