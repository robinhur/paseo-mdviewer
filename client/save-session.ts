export type SaveResult =
  | { status: "ok"; version: string }
  | { status: "conflict" }
  | { status: "error"; message: string };
type Writer = (text: string, force: boolean, expectedVersion: string) => Promise<SaveResult>;
type SaveState = "idle" | "dirty" | "saving" | "saved" | "conflict" | "error";
interface Snapshot {
  text: string | undefined;
  draft: string | null;
  status: SaveState;
  error: string | null;
}

/** One tab's draft and original disk revision. Polling never rebases unsaved edits. */
export function createSaveSession() {
  let state: Snapshot = { text: undefined, draft: null, status: "idle", error: null };
  let diskVersion: string | undefined;
  let baseVersion: string | undefined;
  let saving = false;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<Snapshot>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    receive(text: string, version: string) {
      if (diskVersion === version) return;
      diskVersion = version;
      update({
        text,
        ...(state.draft !== null && !saving && baseVersion !== version ? { status: "conflict" as const } : {}),
      });
    },
    edit(value: string) {
      if (diskVersion === undefined) return;
      if (state.draft === null) baseVersion = diskVersion;
      update({ draft: value, status: saving ? "saving" : state.status === "conflict" ? "conflict" : "dirty", error: null });
    },
    discard() {
      if (saving) return;
      baseVersion = undefined;
      update({ draft: null, status: "idle", error: null });
    },
    async save(write: Writer, force = false) {
      if (saving || state.draft === null || baseVersion === undefined || (state.status === "conflict" && !force)) return;
      const value = state.draft;
      const expectedVersion = baseVersion;
      const observedVersion = diskVersion;
      saving = true;
      update({ status: "saving", error: null });
      let result: SaveResult;
      try {
        result = await write(value, force, expectedVersion);
      } catch (error) {
        result = { status: "error", message: error instanceof Error ? error.message : String(error) };
      }
      saving = false;
      if (result.status === "ok") {
        // A refresh of our own write is expected; a different revision is not.
        if (diskVersion !== observedVersion && diskVersion !== result.version) {
          update({ status: "conflict" });
          return;
        }
        diskVersion = result.version;
        baseVersion = result.version;
        const caughtUp = state.draft === value;
        update({ text: value, draft: caughtUp ? null : state.draft, status: caughtUp ? "saved" : "dirty" });
      } else if (result.status === "conflict") {
        update({ status: "conflict" });
      } else {
        update({ status: "error", error: result.message });
      }
    },
  };
}
