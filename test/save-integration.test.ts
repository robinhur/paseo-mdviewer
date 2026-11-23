import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { createSaveSession, type SaveResult } from "../client/save-session";
import { readMarkdown, writeMarkdown } from "../server/files";

function fixture(context: TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), "mdviewer-save-integration-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "document.md");
  writeFileSync(file, "# original");
  return file;
}

async function load(session: ReturnType<typeof createSaveSession>, file: string) {
  const result = await readMarkdown(file);
  assert.equal(result.status, "ok");
  if (result.status !== "ok") throw new Error("fixture could not be read");
  session.receive(result.text, result.version);
}

function writer(file: string) {
  return async (text: string, force: boolean, version: string): Promise<SaveResult> => {
    const result = await writeMarkdown(file, text, undefined, force ? undefined : version);
    if (result.status === "ok") return { status: "ok", version: result.version };
    if (result.status === "conflict") return { status: "conflict" };
    return { status: "error", message: result.status === "problem" ? result.problem : result.message };
  };
}

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

test("polling an external revision does not save an old draft over it", async (context) => {
  const file = fixture(context);
  const session = createSaveSession();
  await load(session, file);
  session.edit("# old draft");
  writeFileSync(file, "# external revision");
  await load(session, file);
  await session.save(writer(file));
  assert.equal(session.getSnapshot().status, "conflict");
  assert.equal(session.getSnapshot().draft, "# old draft");
  assert.equal(readFileSync(file, "utf8"), "# external revision");
});

test("two tabs saving one disk revision retain the losing draft and one complete winner", async (context) => {
  const file = fixture(context);
  const sessions = [createSaveSession(), createSaveSession()];
  await Promise.all(sessions.map((session) => load(session, file)));
  const drafts = ["A".repeat(1024 * 1024), "B".repeat(10)];
  sessions.forEach((session, index) => session.edit(drafts[index]));
  await Promise.all(sessions.map((session) => session.save(writer(file))));
  assert.deepEqual(sessions.map((session) => session.getSnapshot().status).sort(), ["conflict", "saved"]);
  const winner = sessions.findIndex((session) => session.getSnapshot().status === "saved");
  assert.ok(readFileSync(file, "utf8") === drafts[winner], "disk must equal the complete successful draft");
  assert.equal(sessions[1 - winner].getSnapshot().draft, drafts[1 - winner]);
});

test("explicit overwrite saves the retained draft after a real disk conflict", async (context) => {
  const file = fixture(context);
  const session = createSaveSession();
  await load(session, file);
  session.edit("# chosen draft");
  writeFileSync(file, "# external revision");
  await session.save(writer(file));
  assert.equal(session.getSnapshot().status, "conflict");
  await session.save(writer(file), true);
  assert.equal(session.getSnapshot().status, "saved");
  assert.equal(readFileSync(file, "utf8"), "# chosen draft");
});

test("discarding a conflicted draft lets the next edit use the latest disk revision", async (context) => {
  const file = fixture(context);
  const session = createSaveSession();
  await load(session, file);
  session.edit("# abandoned draft");
  writeFileSync(file, "# external revision");
  await load(session, file);
  session.discard();
  assert.equal(session.getSnapshot().text, "# external revision");
  session.edit("# edit of external revision");
  await session.save(writer(file));
  assert.equal(session.getSnapshot().status, "saved");
  assert.equal(readFileSync(file, "utf8"), "# edit of external revision");
});

test("saving detects an unpolled external edit even when its mtime is restored", async (context) => {
  const file = fixture(context);
  const session = createSaveSession();
  await load(session, file);
  session.edit("# old draft");
  const before = statSync(file);
  writeFileSync(file, "# external revision");
  utimesSync(file, before.atime, before.mtime);
  await session.save(writer(file));
  assert.equal(session.getSnapshot().status, "conflict");
  assert.equal(session.getSnapshot().draft, "# old draft");
  assert.equal(readFileSync(file, "utf8"), "# external revision");
});

test("typing while a real disk save response is delayed preserves the next revision", async (context) => {
  const file = fixture(context);
  const session = createSaveSession();
  await load(session, file);
  session.edit("# first draft");
  const persisted = barrier();
  const respond = barrier();
  const diskWriter = writer(file);
  let writes = 0;
  const slowWriter = async (text: string, force: boolean, version: string) => {
    writes++;
    const result = await diskWriter(text, force, version);
    persisted.release();
    await respond.promise;
    return result;
  };
  const saving = session.save(slowWriter);
  await persisted.promise;
  session.edit("# newer draft");
  await session.save(slowWriter);
  assert.equal(writes, 1);
  respond.release();
  await saving;
  assert.equal(session.getSnapshot().draft, "# newer draft");
  assert.equal(session.getSnapshot().status, "dirty");
  await session.save(diskWriter);
  assert.equal(session.getSnapshot().status, "saved");
  assert.equal(readFileSync(file, "utf8"), "# newer draft");
});

test("a deleted file is not recreated and its unsaved draft remains available", async (context) => {
  const file = fixture(context);
  const session = createSaveSession();
  await load(session, file);
  session.edit("# recoverable draft");
  rmSync(file);
  await session.save(writer(file));
  assert.equal(session.getSnapshot().status, "error");
  assert.equal(session.getSnapshot().draft, "# recoverable draft");
  assert.throws(() => statSync(file), { code: "ENOENT" });
});
