import { useRpc, useTranslation } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { readRpc, statRpc, writeRpc } from "../shared/rpc";
import { messages } from "./messages";
import type { SaveResult } from "./save-session";

/** Both panel types use the same versioned writer and server-side per-file queue. */
export function useMarkdownFile(path: string) {
  const { t } = useTranslation(messages);
  const read = useRpc(readRpc);
  const stat = useRpc(statRpc);
  const write = useRpc(writeRpc);
  const queryClient = useQueryClient();
  const doc = useQuery({ queryKey: ["mdviewer-read", path], queryFn: () => read({ path }) });
  const watch = useQuery({ queryKey: ["mdviewer-stat", path], queryFn: () => stat({ path }), refetchInterval: 1500 });
  const data = doc.data;
  const mtime = data?.status === "ok" ? data.mtime : undefined;
  const diskMtime = watch.data?.mtime;
  const refetch = doc.refetch;
  useEffect(() => {
    if (diskMtime !== undefined && diskMtime !== mtime) void refetch();
  }, [diskMtime, mtime, refetch]);

  const problemText = useCallback((problem: "missing" | "not_markdown" | "too_large") => {
    if (problem === "missing") return t("file.missing", { path });
    if (problem === "not_markdown") return t("file.notMarkdown", { path });
    return t("file.tooLarge", { path });
  }, [path, t]);

  const save = useCallback(async (text: string, force: boolean, expectedVersion: string): Promise<SaveResult> => {
    // An older in-flight read must not later replace the saved snapshot.
    await queryClient.cancelQueries({ queryKey: ["mdviewer-read", path], exact: true });
    const result = await write({ path, text, expectedVersion: force ? undefined : expectedVersion });
    if (result.status === "ok") {
      queryClient.setQueryData(["mdviewer-read", path], { status: "ok", path, text, mtime: result.mtime, version: result.version });
      return { status: "ok", version: result.version };
    }
    if (result.status === "conflict") return { status: "conflict" };
    return { status: "error", message: result.status === "problem" ? problemText(result.problem) : result.message };
  }, [path, write, queryClient, problemText]);

  const error = data?.status === "problem" ? problemText(data.problem) : data?.status === "error" ? data.message : doc.error ? String(doc.error) : undefined;
  return {
    text: data?.status === "ok" ? data.text : undefined,
    version: data?.status === "ok" ? data.version : undefined,
    error,
    save,
    reload: () => { void doc.refetch(); },
  };
}
