MDViewer opens Markdown files in a Paseo tab and draws them like a document: GitHub-flavored Markdown, syntax highlighting, KaTeX math and every Mermaid diagram type, in Paseo's light or dark theme. The same tab switches to Split or Source mode to edit the file, and edits save on their own.

Files open from Markdown links in replies, the Files tree, search, or `/mdv path/to/file.md`. After each reply, a row of buttons lists the Markdown files the reply mentioned, and each one opens in its own tab. The first time you open a `.md` file, Paseo asks which viewer to use; choose MDViewer and tick Don't ask again. Requires Paseo 0.15.4 or later on the app and daemon.

Inside a tab you can show an outline, find text, change the reading width and text size, open a diagram or image full screen and pinch to zoom, tick task-list checkboxes, and copy code blocks. Clicking the file path copies the path, file name or folder, or reveals the file in Finder.

Settings: reply buttons (on), an agent card tool that lets Claude and Codex post a document card (off), the starting mode, reading width, text size, and automatic saving.

The plugin reads Markdown files and the images they reference on the daemon machine, writes files you edit, reads the end of each finished turn to find mentioned files, and runs the system file opener when you ask to reveal or open a file. It sends nothing over the network. Full-screen diagrams, find and the outline need the desktop or web app; other clients use Paseo's own Markdown renderer. With Better Paseo's "Plugin markdown for replies" turned on, reply links open with the operating system instead.
