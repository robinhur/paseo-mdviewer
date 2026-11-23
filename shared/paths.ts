/** File extensions MDViewer treats as Markdown, without the dot. */
export const MARKDOWN_EXTENSIONS = ["md", "markdown", "mdx", "mdown", "mkd"] as const;

const MARKDOWN_FILE = new RegExp(`\\.(?:${MARKDOWN_EXTENSIONS.join("|")})$`, "i");

export function isMarkdownPath(file: string): boolean {
  return MARKDOWN_FILE.test(file);
}

const MARKDOWN_MENTION = /[^\s`'"()[\]<>{}|*]+\.(?:md|markdown|mdx)(?::\d+(?:-\d+)?|#L\d+(?:-L?\d+)?)?(?![\w/])/gi;

/** Markdown file paths a message mentions, in order, without duplicates. */
export function findMarkdownPaths(text: string, limit = 20): string[] {
  const seen = new Set<string>();
  for (const match of text.matchAll(MARKDOWN_MENTION)) {
    const value = match[0].replace(/^[([{<]+/, "").replace(/^\.\/(?=\.)/, "");
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !value.startsWith("file://")) continue;
    seen.add(value);
    if (seen.size >= limit) break;
  }
  return [...seen];
}
