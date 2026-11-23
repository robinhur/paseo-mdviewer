import assert from "node:assert/strict";
import { test } from "node:test";
import { createSaveSession, type SaveResult } from "../client/save-session";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("clean documents follow external changes, including after a save", async () => {
  const session = createSaveSession();
  session.receive("A", "v1");
  session.receive("B", "v2");
  assert.equal(session.getSnapshot().text, "B");
  session.edit("C");
  await session.save(async () => ({ status: "ok", version: "v3" }));
  assert.equal(session.getSnapshot().draft, null);
  session.receive("external", "v4");
  assert.equal(session.getSnapshot().text, "external");
  assert.equal(session.getSnapshot().draft, null);
});

test("polling cannot advance the edit baseline or silently resume a conflicted draft", async () => {
  const session = createSaveSession();
  session.receive("A", "v1");
  session.edit("my draft");
  session.receive("external B", "v2");
  assert.equal(session.getSnapshot().status, "conflict");
  assert.equal(session.getSnapshot().draft, "my draft");
  session.edit("my newer draft");
  let calls = 0;
  await session.save(async () => { calls++; return { status: "ok", version: "v3" }; });
  assert.equal(calls, 0);
  assert.equal(session.getSnapshot().status, "conflict");
  await session.save(async (text, force, version) => {
    assert.equal(text, "my newer draft");
    assert.equal(force, true);
    assert.equal(version, "v1");
    return { status: "ok", version: "v3" };
  }, true);
  assert.equal(session.getSnapshot().draft, null);
});

test("discard uses the latest disk content without writing", () => {
  const session = createSaveSession();
  session.receive("A", "v1");
  session.edit("draft");
  session.receive("B", "v2");
  session.discard();
  assert.deepEqual(session.getSnapshot(), { text: "B", draft: null, status: "idle", error: null });
});

test("typing during a save is retained and the next save uses the successful version", async () => {
  const session = createSaveSession();
  session.receive("A", "v1");
  session.edit("first");
  const pending = deferred<SaveResult>();
  let calls = 0;
  const first = session.save(async (_text, _force, version) => {
    calls++;
    assert.equal(version, "v1");
    return pending.promise;
  });
  session.edit("second");
  await session.save(async () => { calls++; return { status: "ok", version: "wrong" }; });
  assert.equal(calls, 1);
  pending.resolve({ status: "ok", version: "v2" });
  await first;
  assert.equal(session.getSnapshot().draft, "second");
  assert.equal(session.getSnapshot().status, "dirty");
  await session.save(async (text, _force, version) => {
    assert.equal(text, "second");
    assert.equal(version, "v2");
    return { status: "ok", version: "v3" };
  });
  assert.equal(session.getSnapshot().text, "second");
  assert.equal(session.getSnapshot().draft, null);
});

test("a failed or rejected save preserves the latest draft and allows retry", async () => {
  for (const reject of [false, true]) {
    const session = createSaveSession();
    session.receive("A", "v1");
    session.edit("draft");
    await session.save(async () => {
      if (reject) throw new Error("offline");
      return { status: "error", message: "offline" };
    });
    assert.equal(session.getSnapshot().status, "error");
    assert.equal(session.getSnapshot().draft, "draft");
    await session.save(async (_text, _force, version) => {
      assert.equal(version, "v1");
      return { status: "ok", version: "v2" };
    });
    assert.equal(session.getSnapshot().status, "saved");
  }
});

test("an own-write refresh is not mistaken for an external conflict", async () => {
  const session = createSaveSession();
  session.receive("A", "v1");
  session.edit("draft");
  await session.save(async () => {
    session.receive("draft", "v2");
    return { status: "ok", version: "v2" };
  });
  assert.equal(session.getSnapshot().status, "saved");
});

test("an external update during a save remains visible and retains the draft", async () => {
  const session = createSaveSession();
  session.receive("A", "v1");
  session.edit("draft");
  const pending = deferred<SaveResult>();
  const saving = session.save(() => pending.promise);
  session.receive("external", "v3");
  pending.resolve({ status: "ok", version: "v2" });
  await saving;
  assert.equal(session.getSnapshot().status, "conflict");
  assert.equal(session.getSnapshot().text, "external");
  assert.equal(session.getSnapshot().draft, "draft");
});

test("independent tabs and old in-flight completions never share draft state", async () => {
  const old = createSaveSession();
  old.receive("old", "v1");
  old.edit("old draft");
  const pending = deferred<SaveResult>();
  const saving = old.save(() => pending.promise);
  const next = createSaveSession();
  next.receive("next", "n1");
  pending.resolve({ status: "ok", version: "v2" });
  await saving;
  assert.equal(next.getSnapshot().text, "next");
  assert.equal(next.getSnapshot().status, "idle");
});
