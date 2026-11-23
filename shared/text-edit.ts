/**
 * Ticks or unticks the task-list checkbox at `line` (0-based), looking at most two lines further
 * because a list item's source line can sit just below the line the renderer reports.
 * Returns the new text, or null when there is no checkbox there.
 */
export function toggleTaskLine(text: string, line: number): string | null {
  if (!Number.isSafeInteger(line) || line < 0) return null;
  const lines = text.split("\n");
  if (line >= lines.length) return null;
  for (let i = line; i < Math.min(lines.length, line + 3); i++) {
    const match = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\].*)$/.exec(lines[i]);
    if (match) {
      lines[i] = match[1] + (match[2] === " " ? "x" : " ") + match[3];
      return lines.join("\n");
    }
  }
  return null;
}

/** The 0-based line that the character at `offset` is on. */
export function lineAt(text: string, offset: number): number {
  let line = 0;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}
