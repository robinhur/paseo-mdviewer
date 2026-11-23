# Architecture

MDViewer is a Paseo plugin that opens Markdown files, draws them for reading, and lets you edit them in the same tab. The daemon turns Markdown into HTML, and the app shows that HTML in an isolated iframe where diagrams are drawn.

한국어: [docs/ko/ARCHITECTURE.md](ko/ARCHITECTURE.md)

## Goals and non-goals

Goals

- Open a `.md` file in Paseo with one click. Links in replies, the Files tree, search and the buttons under a reply all lead to the same viewer.
- Draw GitHub-level Markdown, Mermaid diagrams and math well on the desktop.
- Edit and save in the same tab, in View, Split or Source mode.
- Make sure a document an agent wrote is not missed.
- Treat every document as untrusted content.

Non-goals

- It does not draw replies in a conversation. Paseo or another plugin does that.
- It is not a code editor. Source editing is a plain text input.
- It does not handle other document types such as PDF or Office files.

## Structure

| Location | Runs in | Does |
|---|---|---|
| `engine/render.ts` | Bundled at build time | Markdown to HTML with markdown-it and its plugins, highlight.js and KaTeX |
| `server/` | Daemon subprocess | RPC handlers, Markdown file access, the file manager, reply buttons, the agent tool |
| `server/generated/` | Build output | `engine.js` (the renderer bundle) and `runtime.ts` (Mermaid, DOMPurify, KaTeX styles and fonts) |
| `client/` | Paseo app | File panel, per-file tabs, toolbar, path menu, settings screen, conversation rows, translations |
| `client/shell.ts` | Inside the iframe | Styles, sanitizing, Mermaid, outline, find, zoom, and link, copy and checkbox handling |
| `shared/` | Both | RPC contracts, settings schema, path matching, text edits |
| `scripts/` | Development machine | Renderer bundle, runtime embedding, third-party notices (`build.mjs`), screenshots (`screenshots.mts`) |

The daemon bundles a plugin's server code with its own bundler and follows the type declarations of imported packages. markdown-it and highlight.js ship declarations it cannot follow, so `scripts/build.mjs` bundles the renderer into `server/generated/engine.js` ahead of time. For the same reason Mermaid, DOMPurify and KaTeX are embedded as strings in a generated module instead of being read from `node_modules` at run time. The plugin therefore has no runtime dependencies.

## Main flows

### Opening a file

1. The user opens a `.md` file from a reply link, the Files tree or a search result.
2. Paseo creates a file tab and uses the remembered viewer for the extension, MDViewer.
3. Both panel types read through `useMarkdownFile`, which follows changes on disk through the daemon.
4. The render RPC returns HTML, and the panel passes it to the iframe with `postMessage`.

Reply buttons, `/mdv`, links inside a document and the agent card open a per-file tab instead. Each file has an agent panel with the id `doc-<path hash>`, so opening the same file from the same conversation focuses its tab. These tabs are agent panels because Paseo lists every workspace panel in the new-tab menu, where one entry per opened file would flood it. The daemon keeps the list of opened files in `plugin-data/paseo-mdviewer/recent.json` and the client registers their panels at startup, so tabs Paseo restores find their panel.

A Paseo file tab has no conversation of its own. A link to another Markdown file inside it opens beside the workspace's most recently updated conversation.

### Drawing

- Daemon: split off front matter, render with markdown-it, give each block a `data-line`, embed local images as data URIs, and mark local links with `data-path`.
- iframe: sanitize the HTML, insert it, then turn each Mermaid block into SVG. Diagram colors come from the Paseo theme through Mermaid's `base` theme and theme variables. A diagram that did not change reuses its cached SVG, which avoids flicker while editing.

### Editing and saving

- Typing in Split or Source mode creates a draft, which is drawn again after 0.14 seconds.
- With automatic saving on, the draft is saved 0.7 seconds after typing stops. Unsaved edits also have a Save button. New input during a save remains dirty for the next save.
- Both panel types use the same versioned RPC. The draft keeps the content version from its first edit; polling cannot advance that baseline. External changes stop automatic saving and preserve the draft until the user discards it or explicitly overwrites. Deletion and read errors keep unsaved text accessible.
- The daemon serializes writes per resolved path, checks the expected content version, writes a complete temporary file beside the original, and rechecks before replacing it. Markdown symlinks keep pointing at their target; file permissions and a UTF-8 BOM are preserved. Missing files and non-Markdown targets are refused.
- Other programs do not share this process-local queue. A concurrent external write between the final check and replacement is not protected by an OS-level compare-and-swap.

### Changed-document buttons

1. The `agent.turn.before` hook records a bounded snapshot of regular Markdown file paths and metadata under the agent's working directory. Hidden entries, dependency and build directories, and symbolic links are skipped. The scan does not read file contents.
2. The matching `agent.turn.after` hook records its observed end time before waiting for settings or scanning, then compares a fresh snapshot with the start snapshot. A file is a candidate only when it was created or its metadata changed, and its filesystem change time is not later than the observed end (at millisecond resolution). Reply text and its Markdown formatting are not inputs.
3. Up to 12 candidates, newest first, are appended as a `mdviewer-files` row with `source: "turn-changes"` and the heading "Documents changed this turn". Older mention-based rows still parse but are hidden; stored timeline entries are not deleted.
4. No changes or no matching start snapshot means no row. Completed directories retain their direct entry names. Even if another subtree exceeds the scan limit, a completed parent or ancestor can prove that a document or its containing folder is new. An existing but unscanned path is not assumed to be new.

The turn-start notification is asynchronous, not a barrier before the agent runs. Very early changes can precede the scan, and bounded scans can miss files. Changes by another program or agent in the same directory also count. This is a file-change signal, not a claim about authorship or importance. Existing file links, file panels and `/mdv` keep their normal opening behavior.

## Security

A Markdown file can carry HTML, and it may come from a repository the user did not write.

- The iframe is created with `sandbox="allow-scripts"`. It has an opaque origin and no access to the app.
- The preview document sets a content security policy: scripts need the document's nonce, styles may be inline, images may be `data:` or `https:`, fonts may be `data:`, and everything else, including `connect-src`, is `'none'`.
- DOMPurify sanitizes the rendered HTML before it is inserted. `style`, `form`, `iframe`, `object`, `embed`, `base`, `link` and `meta` are also dropped.
- Mermaid runs with `securityLevel: "strict"`.
- The viewer's own element ids start with `mdv-`, so a heading id cannot take over the viewer's styling.
- The panel accepts these messages from the iframe: `ready`, `open`, `external`, `copy`, `toggleTask`, `scale`. `external` opens `http`, `https` and `mailto` links only. `open` opens Markdown files in MDViewer and reveals any other local file in the file manager.
- The daemon's read, stat, write and remember handlers refuse paths that are not Markdown files. Writing never creates a file. The file manager's "open" action works for Markdown files only.

`test/browser.test.mts` loads hostile documents into the real preview document and checks these properties.

## Invariants

- App code outside the iframe does not touch the DOM. DOM access lives in `client/web.ts` and only runs on the web platform.
- On platforms without a web view the tab shows the document with Paseo's own Markdown component.
- Timeline row kinds use lowercase letters, digits and hyphens.
- All text colors in the app come from the Paseo theme, and all interface text comes from `client/locales/`.
- Server responses carry codes, not sentences. The client translates them.

## Failure handling

| Situation | Behavior |
|---|---|
| Render RPC fails | The previous render stays |
| The sanitizer did not load | The document is not shown, and a message says why |
| Mermaid syntax error | That block shows the error and the rest is drawn |
| File deleted | The tab shows "File not found" |
| Save conflict | A banner asks to discard or overwrite |
| A panel throws while rendering | The tab shows the error and reports it to the plugin log |
| The turn hook fails | No button row is added, and the error goes to the plugin log |

## Known limits

- Paseo chooses the icon of its file tabs by file type. A plugin cannot change it.
- The party that draws a reply decides how its links open. With Better Paseo's "Plugin markdown for replies" on, links open with the operating system.
- On Paseo 0.16.2, plugin timeline rows do not receive the host's file-link resolver context. The public `Markdown` component can draw a file link there but cannot open its tab. SDK 0.15.4 also exposes no native file-tab opener, so reply buttons retain per-file plugin panels. See the [host timeline boundary](https://github.com/getpaseo/paseo/blob/2ee30f4164af42ba209236ab3a31bf9532592fc3/packages/app/src/agent-stream/view.tsx#L945-L948).
- A per-file tab belongs to the conversation it was opened from.
- File manager actions run on the machine the daemon runs on.
