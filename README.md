# Vyuha

A project-aware browser. Type anything in the search bar and Vyuha opens the right site **inside the app**. If the prompt is about one of your projects, every page you visit in that tab is filed into the project's folders, so you can always see which datasets, videos and docs a project was built from.

## Run it

You need **Node.js 18 or newer** (`node --version` to check).

```bash
cd vyuha
npm install      # downloads Electron (~100 MB, first time only)
npm start
```

Optional: `npm test` runs the router checks.

## Try these

| Type in the search bar | What happens |
|---|---|
| `youtube video for python` | Opens YouTube results for "python" in a Vyuha tab. Not saved anywhere. |
| `find datasets for the sentiment classifier` | Opens Hugging Face Datasets. The tab shows **Filing to sentiment-classifier**, and every page you open in it lands in that project's `datasets/`, `videos/` or `research/` folder. |
| `Where is the sentiment classifier at?` | Opens the project and answers from its notes on the project's start page. |
| `github.com` | Goes straight to the address. |

Inside a project, the tab shows the project's folders on the left and the browser on the right. Click a source to open it in the tab, or the ⓘ next to it to see why it was filed. Ctrl/Cmd+B hides the folders.

Other useful controls:

- **File → Open Project** switches context.
- **File → New Project** creates a project folder.
- **Settings → Preferences** chooses what gets filed.
- On any unsaved tab, the **File to…** dropdown in the toolbar starts filing it into a project.

## Working like VS Code

A project tab is laid out like VS Code:

```
┌ folders & sources ┬ editor tabs: Search | Page | train.py | … ┬ Gemini ┐
│ files (real tree) │ web page, Monaco editor or project notes  │ chat   │
│ datasets/ videos/ ├───────────────────────────────────────────┤        │
│ research/ phases/ │ Terminal (runs in the project folder)     │        │
└───────────────────┴───────────────────────────────────────────┴────────┘
```

- **Open Folder** (File → Open Folder, Cmd+O): open any folder on your computer, such as an existing git repo, as a project. Its files appear in the sidebar. Vyuha keeps that project's sources, decisions and chat in a `.vyuha/` folder inside it, so you may want to add `.vyuha/` to `.gitignore`.
- **Editor:** click a file to open it in Monaco, the editor engine VS Code itself uses. Cmd+S saves, and a dot marks unsaved changes. When Gemini edits a file you have open, the change appears in the editor and Cmd+Z undoes it.
- **Terminal** (Cmd+J): runs commands in the project folder through your login shell, so `python`, `pip`, `conda`, `git` and `npm` work as in your normal terminal. It isn't a full interactive terminal: programs that wait for keyboard input won't work.
- **Gemini panel** (Cmd+I): Gemini sees whatever you have open, either the file in the editor (including unsaved edits) or the web page. It can run commands; each one appears with **Run** and **Skip** buttons and only runs if you click **Run**. Output is shown in the terminal and sent back to Gemini.

- **Resizing panels:** drag the sidebar's right edge, the Gemini panel's left edge or the terminal's top edge. Double-click an edge to reset it. Sizes are remembered between sessions. While you drag, the web page is hidden for a moment so the drag stays smooth. With an edge focused (Tab), the arrow keys resize it, and Shift+arrow resizes in bigger steps.

Setup for these features: `npm install monaco-editor` (once).

## Organising a project

The sidebar has three sections. Hover a section header for its **+** buttons, and use **⋮** (or right-click) on any row:

| Section | What you can do |
|---|---|
| **Files** | New file, new folder, rename, delete. Deleted items go to the Trash, so they can be recovered. Open editor tabs follow renames. |
| **Sources** | Add your own collections (e.g. *papers*), rename them, add links by hand, move sources between collections, mark a suggested dataset as chosen. *datasets*, *videos* and *research* are built in (automatic filing uses them), so they can be renamed but not deleted. |
| **Plan** | Add, rename, reorder and delete phases, and set the current one. Phases stay numbered in order, and their sources, decisions and notes follow them. |

## Source Control and GitHub

Switch the sidebar to **Source Control** (next to Explorer), as in VS Code:

- **Initialize repository**, see changed files (M modified, U new, D deleted) and click one for a side-by-side diff against the last commit.
- Write a message (or click **✦ Write message** to have Gemini write it from the diff), then **Commit**.
- **Pull** and **Push**. **Publish to GitHub** creates the repository on your account, makes the first commit and pushes.
- **File → Clone Repository…** copies a GitHub repository to your Mac and opens it as a project.
- Vyuha's own notes folder (`.vyuha`) is kept out of the repository automatically, through `.git/info/exclude`; your `.gitignore` isn't changed.

GitHub access uses a personal access token: Settings → GitHub → **Create a token** (give it the *repo* permission), paste it, then **Save and test**. It's stored encrypted in your keychain, and sent to GitHub as a header for each push, pull or clone, never written into the repository. If git doesn't know your name and email yet, Vyuha uses your GitHub name with GitHub's private *noreply* email for that repository.

## Deleting a project

File → **Delete Project…**, or the project's **⋮** menu in the sidebar header:
- **A Vyuha project** moves to the Trash.
- **An opened folder** gives you a choice: **Remove from Vyuha** (the folder and its files stay; reopening it restores the project from `.vyuha`) or **Move Folder to Trash**.

## Recommendations and plans

- **Specific suggestions.** Gemini finds real items: YouTube videos (title, channel, length, read from YouTube's own results), GitHub repositories (from GitHub's search API, by stars) and datasets (Hugging Face API and Kaggle).
- **Every recommended link is filed.** After each reply, Vyuha files every link Gemini recommended into the matching collection (videos, repositories, datasets, research), marked *suggested* (○). Links are checked first, and YouTube videos are checked against YouTube, so made-up links aren't saved.
- **Plans become phases.** Ask Gemini to plan the project and the default phases are replaced by real ones, each with a goal and a task checklist. Tick tasks yourself in the phase page, or Gemini ticks them as work gets done. The sidebar shows progress per phase (e.g. 1/3). If Gemini writes a roadmap without saving it, Vyuha turns it into phases.

## Gemini inside projects

Gemini is used only inside projects; the home search bar stays a plain router.

1. Get a key from Google AI Studio.
2. Install the SDK once: `npm install @google/genai`
3. In Vyuha: **Settings → Preferences**, paste the key, then click **Save and test**.

The default model is `gemini-3.8-flash`, and you can change it in the same dialog. The key is encrypted with your OS keychain (Electron `safeStorage`) and stays in the main process; the UI never sees it. Setting `GEMINI_API_KEY` in your environment also works.

Opening a project lands on **Gemini**, a full-page chat like the Gemini or ChatGPT apps. Replies stream in as they're written. It has two modes:

- **Teach me** (default): Gemini acts as a tutor. It lays out a roadmap, explains each step from first principles, shows commented code you can try, and checks your understanding. It doesn't create files or run commands unless you ask.
- **Build with me**: Gemini plans, writes files, runs them (with your approval) and fixes what breaks.

While you have a file or page open, the **Gemini** button (or Cmd+I) opens the same conversation as a side panel that also sees what you're looking at. Every request includes the project's current state: goal, phases, decisions, filed sources and code files. Gemini can act through these tools:

| Tool | What it does |
|---|---|
| `search_web` | Searches the web, YouTube, Hugging Face, Kaggle, GitHub, Stack Overflow, arXiv or Wikipedia in a hidden browser, and reads the results. |
| `open_page` | Opens and reads a page. |
| `read_file`, `write_file` | Read and write files anywhere in the project folder (never outside it), linking each file to the sources it used. |
| `run_command` | Runs a shell command in the project folder after you click Run. |
| `record_decision` | Adds an entry to `decisions.md`. |
| `set_phase` | Moves the project to another phase, with a note. |

Pages Gemini opens are filed into the project exactly like pages you open, with Gemini's reason saved as "why". Each step appears in the chat; click it to open the page or file. The conversation is saved in the project folder as `chat.json`.

From the home page, a question about a project ("where is the sentiment classifier at?") opens that project and asks Gemini.

## How it works

```
┌─────────────────────────── BrowserWindow ───────────────────────────┐
│ renderer/  (Vyuha's own UI: tabs, address bar, home, workspace)      │
├──────────────────────────────────────────────────────────────────────┤
│ WebContentsView per web tab  (real Chromium page: YouTube, HF, …)    │
└──────────────────────────────────────────────────────────────────────┘
        ▲ IPC (preload.js)                          │ did-navigate events
        │                                           ▼
   src/main.js ── src/router.js (where should this prompt go?)
               └─ src/store.js  (projects on disk, the provenance log)
```

- **Why sites load inside the app.** Each web tab is a `WebContentsView`, a full Chromium page laid over the content area. It isn't an iframe, so the "don't embed me" headers that YouTube and Google send don't apply.
- **How filing works.** A tab is either attached to a project or not:
  - **Attached:** `main.js` listens to `did-navigate` and `did-navigate-in-page`, and appends each page to the project's `project.json`. The page's title is added once it loads. `router.classify()` decides the folder (datasets, videos or research).
  - **Not attached:** nothing is recorded.
- **What counts as project-related.** `router.detectProject()` checks the prompt against each project's `keywords`.
- **Security.** Web pages run sandboxed in their own session (`persist:vyuha-web`) and never get access to the Vyuha API. Only Vyuha's own UI gets `preload.js`.

## Where your data lives

Each project is a real folder: `project.json` holds sources and decisions, and `code/` holds the code files. The path is shown at the bottom of the explorer and printed in the terminal on start. Typically:

- macOS: `~/Library/Application Support/vyuha/projects/`
- Windows: `%APPDATA%\vyuha\projects\`
- Linux: `~/.config/vyuha/projects/`

To start fresh, delete that `projects` folder and the two sample projects are recreated.

## Files

```
src/main.js      window, tabs, menu, IPC, provenance logging, Gemini wiring
src/agent.js     Gemini: system prompt, tools, retries
src/terminal.js  runs commands for the Terminal panel and Gemini
src/router.js    prompt → site, project detection, page classification
src/store.js     projects on disk
src/seed.js      sample projects
src/preload.js   the bridge the UI is allowed to use
renderer/        index.html, styles.css, app.js (the UI)
test/            router checks
```

## Known limits

- **Google sign-in** may refuse to log in inside Electron ("This browser may not be secure"). Browsing YouTube, Hugging Face and similar sites without signing in works fine.
- **Routing is keyword rules.** "videos" goes to YouTube, "datasets" to Hugging Face, and so on.
- **Without a Gemini key**, project questions are answered from the project's notes (phase and decisions).
- **Gemini can only read what pages show to a normal visitor.** Some sites (e.g. Kaggle) need sign-in for full content.

## Next steps

1. **Connect the agent.** Add `src/agent.js` that calls an LLM API with the project's `project.json` (summary, phase, sources, decisions) as context. Expose it over IPC and show replies on the project's start page. Keep the API key in the main process, never in the renderer.
2. **Smarter routing.** Replace `router.route()` with an LLM call that returns `{site, query, project}`, and keep the rules as a fallback.
3. **Better notes per source.** When a page is filed, ask the LLM for a one-line "why this matters" from the page text (`webContents.executeJavaScript('document.body.innerText')`).
4. **Package it.** Use `electron-builder` to produce a `.dmg` or `.exe`.
