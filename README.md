<h1 align="center">MDViewer</h1>

<p align="center">
  A Markdown reader and editor for <a href="https://paseo.sh">Paseo</a>.<br>
  Click a <code>.md</code> link in a conversation and read it in a tab, with diagrams, math and live editing.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Paseo-0.15.4%2B-3987e5" alt="Requires Paseo 0.15.4 or later">
  <img src="https://img.shields.io/badge/platform-desktop%20%7C%20web%20%7C%20mobile-6b7280" alt="Desktop, web and mobile">
</p>

- **Opens where you click.** Markdown links in replies, the Files tree and search open in the viewer. After each reply, a row of buttons lists the Markdown files the reply mentioned.
- **Reads like a document.** GitHub-flavored Markdown with alerts, task lists, footnotes, front matter, a table of contents, syntax highlighting and KaTeX math, in Paseo's light or dark theme.
- **Draws diagrams.** Every Mermaid diagram type: flowcharts, sequence, state, class, ER, Gantt, pie, mindmap and git graphs. Click one to open it full screen and pinch to zoom.
- **Edits in place.** View, Split and Source modes in the same tab. Split shows the source above the preview and redraws as you type; edits save on their own.
- **One tab per file.** Each file gets its own tab named after it, and opening it again brings that tab back.

## Install

```sh
paseo plugin install github:robinhur/paseo-mdviewer
```

Or from a local checkout:

```sh
git clone https://github.com/robinhur/paseo-mdviewer.git
cd paseo-mdviewer
npm install
paseo plugin install "$(pwd)"
```

The built engine and runtimes in `server/generated/` are committed, so no build step is needed to install.

Plugins must be enabled on the daemon (**Settings → Plugins → Enable plugins**).

The first time you open a `.md` file, Paseo asks which viewer to use. Pick **MDViewer** and tick **Don't ask again**. You can change it later in **Settings → Files** or with **Open with…** in the tab menu.

## Use it

| Where | What happens |
|---|---|
| A `.md` link in a reply | Opens the file in a Paseo file tab, drawn by MDViewer |
| The buttons below a reply | Opens each file in its own MDViewer tab |
| The Files tree or search | Opens in MDViewer once it is the chosen viewer |
| `/mdv path/to/file.md[:line]` | Opens the file, relative to the workspace, at that line |
| ⌘K → Open MDViewer | Opens an empty viewer tab |

### In the tab

- **View / Split / Source** switch the mode. Split puts the source above the preview.
- **Outline** shows the headings beside the document and follows your scroll.
- **Find** (⌘F) highlights matches and steps through them with Enter.
- **Full width** and **A- / A+** change the reading width and text size. Pinch on a trackpad does the same.
- **Click the path** (or right-click it) to copy the path, file name or folder, reveal the file in Finder, or open it in the default app.
- **Click a diagram or image** to open it full screen. Pinch or Ctrl+scroll zooms at the pointer, drag or scroll pans, double-click toggles zoom, Esc closes.
- **Click a checkbox** in a task list to tick it in the file.
- **Hover a code block** for a Copy button.

### Agent card tool

With **Agent card tool** turned on, Claude and Codex sessions get a `show_markdown` tool. An agent calls it after writing a report or plan, and the conversation shows a card with the document title, its main sections and an Open button.

## Settings

**Settings → Plugins → MDViewer** (cog). Values are stored on the daemon and shared by every connected device.

| Setting | Default | |
|---|---|---|
| Open buttons after each reply | On | Lists the Markdown files a reply mentions below it |
| Agent card tool | Off | Gives agents `show_markdown`; applies to sessions opened afterwards |
| Open documents in | View | Starting mode for new tabs |
| Reading width | Normal | Narrow, normal or full width |
| Text size | 100% | Starting size for new tabs |
| Save automatically | On | Off: edits wait for the Save button |

## How it works

The daemon turns Markdown into HTML with markdown-it, highlight.js and KaTeX. The app shows that HTML in a sandboxed iframe inside the tab, where Mermaid draws the diagrams. The iframe has scripts but no access to the app; the two exchange messages only. On mobile and other non-web clients, the tab falls back to Paseo's own Markdown renderer.

The reply buttons come from a daemon hook that runs after each turn: it reads the turn's replies, finds Markdown paths, keeps the ones that exist under the agent's working directory, and appends a button row to the conversation.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design and [docs/SETTINGS.md](docs/SETTINGS.md) for settings.

## With Better Paseo

Better Paseo's **Plugin markdown for replies** draws replies itself and opens file links with the operating system. Turn it off to have Markdown links in replies open in MDViewer. The reply buttons work either way.

## Data access

- Reads Markdown files and the images they reference on the daemon machine, and writes the files you edit.
- Reads the end of each finished conversation turn to find mentioned files.
- Runs `open` (macOS), `explorer` (Windows) or `xdg-open` (Linux) on the daemon machine when you choose Reveal in Finder or Open in default app.
- Keeps the list of files opened in their own tabs in `~/.paseo/plugin-data/paseo-mdviewer/recent.json`.
- Sends nothing over the network.

## Known limits

- Tabs opened from reply links use Paseo's file tab, whose icon Paseo chooses by file type.
- The same file can be open twice: once from a reply link and once from a reply button.
- The source editor is plain text, without line numbers or syntax colors.
- Full-screen diagrams, find and the outline need the desktop or web app.

## Development

```sh
npm install
npm run build        # bundles engine/ into server/generated and embeds Mermaid and KaTeX
npm run typecheck
paseo plugin reload paseo-mdviewer
paseo plugin logs paseo-mdviewer
```

Run `npm run build` after changing `engine/` or upgrading mermaid, katex or the markdown-it plugins.

| Path | Contents |
|---|---|
| `engine/` | Markdown renderer, bundled at build time |
| `server/` | RPC handlers, file access, reply buttons, agent tool |
| `client/` | Panels, toolbar, settings screen, conversation rows |
| `client/shell.ts` | The iframe: styles, Mermaid, outline, find, zoom |
| `shared/` | RPC contracts, settings schema, path matching |
