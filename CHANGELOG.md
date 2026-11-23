# Changelog

## 0.1.0

First release.

- Opens Markdown files in a Paseo file tab: GitHub-flavored Markdown, alerts, task lists, footnotes, front matter, a table of contents, syntax highlighting and KaTeX math.
- Draws every Mermaid diagram type in the colors of the Paseo theme. Diagrams and images open full screen with pinch zoom.
- View, Split and Source modes with live preview, automatic saving and a conflict prompt when the file changes on disk.
- Outline, find, reading width and text size per tab.
- A row of buttons for Markdown files created or changed during each turn, each opening in its own tab.
- `/mdv path/to/file.md[:line]`, an optional `show_markdown` tool for agents, and a settings screen.
- A file path menu to copy the path, reveal the file in Finder or open it in the default app.
- English and Korean interface text.
- Documents are sanitized and shown under a content security policy, so HTML inside a Markdown file cannot run script.
