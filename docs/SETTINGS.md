# Settings

Open the settings screen from Paseo Settings → Plugins → MDViewer (cog) or from "MDViewer settings" in the Command Center. Values are stored on the daemon and shared by every connected device. Six settings exist today; the rest are candidates.

한국어: [docs/ko/SETTINGS.md](ko/SETTINGS.md)

## Current settings

| Key | Label | Default | Behavior |
|---|---|---|---|
| `turnButtons` | Show changed documents after each turn | On | Appends buttons for Markdown files created or changed during the turn |
| `agentTool` | Agent card tool | Off | Gives agents the `show_markdown` tool. Applies to sessions opened after the change |
| `defaultMode` | Open documents in | View | Starting mode of a newly opened document: View, Split or Source |
| `width` | Reading width | Normal | Narrow 700px, normal 860px, or full width |
| `fontScale` | Text size | 100% | Text size of a newly opened document. Pinch or A-/A+ changes it per tab |
| `autosave` | Save automatically | On | Off: only the toolbar's Save button saves |

The schema lives in `shared/settings.ts`. The starting mode and text size apply to new tabs; an open tab keeps the values stored with it.

## Candidates

Added when they are needed.

Conversation

- Maximum number of buttons (12)
- Which agents get the card tool (Claude, Codex, both)

Viewer

- Outline open by default (off)
- Body and code fonts
- Fixed theme (follow Paseo, light, dark)
- Code color set (GitHub)

Rendering

- Mermaid (on)
- Math (on)
- Front matter card (on)
- Emoji shortcodes (on)
- Local images (on)

Editing

- Delay before automatic saving (0.7 seconds)
- Save when a checkbox is clicked (on)
- Split direction (stacked, side by side)

Files

- Extensions to handle (md, markdown, mdx, mdown, mkd)
- Restore tabs opened before (on)
