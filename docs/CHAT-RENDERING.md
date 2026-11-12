# How the conversation draws what agents write (app/chat-render.js)

One module, no DOM and no network, tested in Node (`node app/test/chat-render.test.mjs`). The shell (`app/prototype.html`) passes in the icons and the box markup. Everything is escaped first; links are http(s) and mailto only; nothing remote is loaded (a picture shows only when it resolves to a file in this workspace).

## Markdown
Headings (`#` to `####`), paragraphs with soft line breaks, bold, italic, strikethrough, inline code, fenced code (a copy button, highlighting through the shell's own highlighter, and a fence still open while a reply streams shows as code), block quotes, rules, bullet and numbered lists (nested by indentation), tables (with column alignment), and links (plain addresses become links too). Raw HTML is shown as text.

## Hand-over markers an agent can write in a reply
| Marker | Shows |
|---|---|
| `{{file:path}}` | a small chip that opens the file in the editor (3D models open the viewer) |
| `{{card:name}}` | a file box: icon, name, kind and size, **Open** (the editor for a workspace file; the picture view, the 3D viewer, a new tab for a PDF; a download for the rest) and **Download** |
| `{{image:name}}` | a small picture tile in the conversation; a click opens the big view (arrow keys move between pictures, Esc closes, Download inside) |
| `{{image:name\|big}}` | the picture large, inline |
| `{{image:name\|file}}` | the picture packaged as a file box, like any other file |
| `[attached: name size id=...]` | what an uploaded attachment looks like (pictures as tiles, the rest as boxes) |
`name` is a workspace file path, an uploaded file's name, or its id. A text SVG in the workspace is drawn as a picture. An unknown name shows "not found in this workspace", never an error. Attachments on a person's message use the same tiles and boxes.
The agents are told about these markers in their prompt (`FILE_RULES` in `agents/src/agent.js`, checked in `agents/test/skillwire.test.js`), and the `stylistic-presentation` skill shows how to make a chart or box diagram as an SVG. **Not built:** an agent cannot yet attach a file it generated (a chart from a script) to the room: uploads are open to people's tokens and to agents' only through the same HTTP route, with no agent tool for it. Until then an agent can point at files that are already in the workspace or were uploaded.

## Work boxes
Consecutive tool steps (`role: tool` messages) fold into one box. While the agent works it shows a spinner, "coder is working" and the latest step; after, it collapses to one quiet line ("Ran 3 commands", "Read 2 files", "Worked through 5 steps, 1 failed") with a check; a click shows every step with its output. A request to an agent that nothing has answered yet shows a "thinking" row with animated dots. "Live" means: the last step is under 45 s old, or an agent holds a file claim; a reply after the steps, or silence, ends it. An approval card splits boxes (it needs to stay visible).

## Running apps and the browser pane
A link of the form `.../preview/<24 hex>/` in a message (what an agent posts after starting the project) opens in the **browser pane** instead of a new tab (hold Ctrl or Cmd for a tab). The pane (globe button, top right) has an address bar, reload, phone / tablet / desktop sizes, a load time, "open in a new tab", and **Ask coder to test it**, which sends the page and the chosen screen size to the agent. The frame is sandboxed, never gets the app's own identity back, and sends no referrer. **Not built:** automated checks inside the pane (a page from another address cannot be inspected from here), and an agent that drives a real browser (the agent container has no browser; see ABILITIES.md).
