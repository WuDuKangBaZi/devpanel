import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldBlockBrowserShortcut } from "./webviewGuard.ts";

function mkKey(
  key: string,
  mods: {
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
  } = {}
) {
  return {
    key,
    ctrlKey: Boolean(mods.ctrlKey),
    metaKey: Boolean(mods.metaKey),
    shiftKey: Boolean(mods.shiftKey),
    altKey: Boolean(mods.altKey),
  };
}

describe("webviewGuard helpers", () => {
  it("blocks WebView2 DevTools, reload, print, zoom, and browser navigation shortcuts", () => {
    assert.equal(shouldBlockBrowserShortcut(mkKey("F12")), true);
    assert.equal(shouldBlockBrowserShortcut(mkKey("F5")), true);
    assert.equal(shouldBlockBrowserShortcut(mkKey("F3")), true);
    assert.equal(shouldBlockBrowserShortcut(mkKey("F7")), true);
    assert.equal(
      shouldBlockBrowserShortcut(mkKey("I", { ctrlKey: true, shiftKey: true })),
      true
    );
    assert.equal(
      shouldBlockBrowserShortcut(mkKey("J", { ctrlKey: true, shiftKey: true })),
      true
    );
    assert.equal(
      shouldBlockBrowserShortcut(mkKey("C", { ctrlKey: true, shiftKey: true })),
      true
    );
    assert.equal(
      shouldBlockBrowserShortcut(mkKey("r", { ctrlKey: true })),
      true
    );
    assert.equal(
      shouldBlockBrowserShortcut(mkKey("p", { ctrlKey: true })),
      true
    );
    assert.equal(
      shouldBlockBrowserShortcut(mkKey("u", { ctrlKey: true })),
      true
    );
    assert.equal(
      shouldBlockBrowserShortcut(mkKey("+", { ctrlKey: true })),
      true
    );
    assert.equal(
      shouldBlockBrowserShortcut(mkKey("ArrowLeft", { altKey: true })),
      true
    );
  });

  it("allows DevPanel shortcuts and standard text editing shortcuts", () => {
    assert.equal(
      shouldBlockBrowserShortcut(mkKey("c", { ctrlKey: true })),
      false
    );
    assert.equal(
      shouldBlockBrowserShortcut(mkKey("v", { ctrlKey: true })),
      false
    );
    assert.equal(
      shouldBlockBrowserShortcut(mkKey("f", { ctrlKey: true })),
      false
    );
    assert.equal(
      shouldBlockBrowserShortcut(mkKey("j", { ctrlKey: true })),
      false
    );
    assert.equal(
      shouldBlockBrowserShortcut(mkKey("k", { ctrlKey: true })),
      false
    );
    assert.equal(
      shouldBlockBrowserShortcut(mkKey("m", { ctrlKey: true })),
      false
    );
    assert.equal(
      shouldBlockBrowserShortcut(mkKey("m", { ctrlKey: true, shiftKey: true })),
      false
    );
    assert.equal(
      shouldBlockBrowserShortcut(mkKey("t", { ctrlKey: true, shiftKey: true })),
      false
    );
    assert.equal(
      shouldBlockBrowserShortcut(mkKey("r", { ctrlKey: true, shiftKey: true })),
      true
    );
  });
});
