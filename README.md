# Vyuha

A project-aware browser and AI workspace that keeps everything about a project in one place.

## Installation

### Prerequisites

- [Node.js](https://nodejs.org) 18 or newer (includes npm). Check with `node --version`.
- [Git](https://git-scm.com)
- About 300 MB of free disk space (Electron is downloaded on first launch).

### Steps

1. Clone the repository:

   ```bash
   git clone https://github.com/jayashree-codes/Vyuha_Hacktheburgh.git
   cd Vyuha_Hacktheburgh
   ```
2. If node not available already
   ```
   brew install node
   ```

2. Install the dependencies (Electron, Monaco editor, Google Gen AI SDK):

   ```bash
   npm install
   ```
   If dependencies still not installed - use:
   ```
   npm install monaco-editor
   npm install @google/genai
   ```

3. Start the app:

   ```bash
   node node_modules/electron/install.js
   npm start
   ```

   The first launch downloads the Electron binary (~100 MB), so it can take a minute. After that the Vyuha window opens.

### Gemini API key

To use the Gemini assistant, get a key from [Google AI Studio](https://aistudio.google.com), then in the app open **Settings → Preferences**, paste the key and click **Save and test**. You can also set the `GEMINI_API_KEY` environment variable. The rest of the app works without a key.

---

## Using Vyuha: a complete walkthrough

This walkthrough assumes you have never used Vyuha before. The example is a **spam email filter**: you want to build a program that decides whether an email is spam. You do not need to know how yet. Vyuha will help you learn, and it will remember everything you look at along the way.

Shortcuts are shown for Windows/Linux (`Ctrl`). On Mac use `Cmd` instead.

### Step 0. Add your Gemini API key (do this first, before creating a project)

**Do this before anything else.** Planning, chat, search and code writing (Steps 2 to 7) all need the key. Without it, Vyuha only works as a browser and notes keeper.

1. Get a key from [Google AI Studio](https://aistudio.google.com) (sign in, then click **Get API key**).
2. In Vyuha open **Settings → Preferences…** (or press `Ctrl+,`).
3. Under **Gemini, used inside projects**, paste the key into **API key**.
4. Click **Save and test**. The message under the button tells you whether the key works.
5. Click **Save settings**.

### Step 1. Create the project

(Make sure Step 0 is done first.)

1. On the home page press `Ctrl+Shift+N` (or choose **File → New Project…**).
2. In **Project name** type `spam-email-filter`.
3. In **Goal in one line** type `Detect whether an email is spam or not`.
4. Click **Create project**.

Vyuha creates a folder for the project and opens it on a full-page **Gemini** chat. The left sidebar now shows the project.

Already have a folder of code? Use **File → Open Folder…** (`Ctrl+O`) instead. Vyuha keeps its notes in a `.vyuha/` folder inside it.

### Step 2. Make a project plan

1. At the top of the chat, check that **Teach me** is selected (see "Modes" below). It is the default.
2. In the box at the bottom type:

   `I want to build a spam email filter. I'm a beginner. Plan the project for me.`

3. Press `Enter` (or click the arrow).

Gemini replies and creates real **phases**, for example *Planning, Data, Model, Evaluation*. Each phase has a goal and a checklist of tasks.

To see and use the plan:

1. Look at the **Plan** section in the left sidebar. Each phase shows progress such as `1/4`.
2. Click a phase to open its page.
3. Tick a task when you finish it. The counter in the sidebar updates. (Gemini also ticks tasks when it completes them.)
4. To change the plan, hover the **Plan** header and click **+** to add a phase, or click **⋮** (or right-click) on a phase to rename, reorder or delete it.

### Step 3. Find videos, datasets and documents

Ask in plain language. Vyuha chooses the site from the words you use.

| You type | Where it goes |
|---|---|
| `youtube video for spam detection` | YouTube search results |
| `datasets for spam email` | Hugging Face Datasets |
| `github repos for spam filter` | GitHub repository search |
| `papers on spam classification` | arXiv |
| `what is naive bayes` | Wikipedia |
| `error ModuleNotFoundError sklearn` | Stack Overflow |
| `github.com` or any web address | That address directly |
| anything else | Google |

There are two places to type:

- **The home search bar** (open a new tab with `Ctrl+T`): a simple router. The page opens inside Vyuha. It is filed to a project only if your words match that project's keywords.
- **Inside a project**: ask Gemini, for example `Find me a good dataset for spam email and explain why it is a good choice`. Gemini searches Hugging Face, Kaggle, YouTube, GitHub, arXiv and other sites, reads the results, and replies with real links. Each step it takes appears in the chat, and you can click a step to open that page.

### Step 4. Open and understand a page

1. Click a link in a Gemini reply, or in the sidebar's **Sources** section. The page opens in an editor tab inside Vyuha.
2. Press `Ctrl+I` to open the **Gemini side panel** next to the page.
3. Type: `Summarise this page in simple words and tell me how it helps my spam filter`.

Gemini can see the page you have open, so you do not need to paste anything. The same works for code: open a file, press `Ctrl+I`, and ask `Explain this file line by line`.

### Step 5. Keep track of everything you opened

Every page you open **in a project tab** is filed automatically, and every link Gemini recommends is filed too.

1. Look at the **Sources** section in the sidebar. Pages are grouped into **datasets**, **videos** and **research** (plus any collections you add).
2. Click a source to reopen it in the editor area.
3. Click the **ⓘ** next to a source to see *why* it was filed.
4. A **○** next to a source means *suggested by Gemini*. When you decide to use it, click **⋮ → Mark as chosen**.
5. To add a link yourself, hover **Sources** and click **+**. Fill in **Address**, **Title** (for example `SMS Spam Collection (UCI)`), choose a **Collection**, and optionally **Why it's useful**. Click **Add link**.
6. To organise, use **⋮** on a source to move it to another collection, or on a collection to rename or delete it. The built-in collections (datasets, videos, research) can be renamed but not deleted.

Pages opened in a tab that is **not** attached to a project are not recorded. To start filing such a tab, use the **File to…** dropdown in the toolbar and pick a project.

### Step 6. Build the filter with Gemini (the IDE side)

A project looks like a code editor:

```
┌ sidebar ──────────┬ editor tabs ─────────────────────────────┬ Gemini ┐
│ Explorer | Source │ web page, code file, or project notes    │ side   │
│ Control           ├──────────────────────────────────────────┤ panel  │
│ Files / Sources / │ Terminal (runs in the project folder)    │        │
│ Plan              │                                          │        │
└───────────────────┴──────────────────────────────────────────┴────────┘
```

Follow these in order. The right column is what you should see.

| # | Do this | You should see |
|---|---|---|
| 1 | At the top of the chat click **Build with me**. | The button is highlighted. (**Teach me** only explains; **Build with me** writes files and runs commands.) |
| 2 | Type: `Create train.py that trains a Naive Bayes spam filter with scikit-learn on a small CSV of emails. Install what is needed.` and press `Enter`. | The reply streams in. Steps appear as lines in the chat, such as `Wrote train.py`. `train.py` appears in **Files** in the sidebar. |
| 3 | Wait for Gemini to propose a command, for example `pip install scikit-learn pandas`. | A card with the command and two buttons, **Run** and **Skip**. **Nothing has run yet.** Vyuha never runs a command until you click **Run**. |
| 4 | Click **Run**. | Output scrolls in the **Terminal** panel at the bottom. The same output goes back to Gemini, which carries on or fixes the error. |
| 5 | In the sidebar **Files** section click `train.py`. | The file opens in the **Monaco editor** (the editor used by VS Code), with colours and line numbers. |
| 6 | Change a line, for example add a comment, then press `Ctrl+S`. | A dot on the tab (unsaved) disappears when you save. |
| 7 | Press `Ctrl+J` to show the Terminal, type `python train.py` and press `Enter`. | The program's output (or its error) appears in the Terminal. It runs inside the project folder. It is not a fully interactive terminal, so programs that wait for keyboard input will not work. |
| 8 | If it fails, click **Gemini** (`Ctrl+I`) and type: `It failed, please fix it`. | Gemini reads the open file (including unsaved edits) and edits it. The change appears in the editor and `Ctrl+Z` undoes it. |
| 9 | Type: `Record the decision: we use Naive Bayes because it is fast and works well on small data.` | A step `Recorded decision` appears in the chat. It is saved with the project, linked to the sources used. |
| 10 | Click **Source Control** at the top of the sidebar, then **Initialize repository** (if shown). | Your changed files are listed with **M** (modified), **U** (new) or **D** (deleted). |
| 11 | Click `train.py` in that list. | A side-by-side diff against the last commit. |
| 12 | Click **✦ Write message**, then **Commit**. | Gemini writes the commit message from your changes. The file list empties. |
| 13 | Optional: add a GitHub token (**Settings → Preferences… → GitHub → Create a token**, give it the *repo* permission, paste it, **Save and test**), then click **Publish to GitHub**. | A repository is created on your GitHub account and the code is pushed. |

**Files section:** use **+** or **⋮** (or right-click) to create a file or folder, rename, or delete. Deleted items go to the Trash, so they can be recovered.

### Step 7. How Vyuha adapts to the way you type (test it yourself)

Vyuha measures *how* you write each message (length, how specific it is, typing speed, pauses, corrections, rephrasing) and uses that to choose how Gemini answers. #### Reading the style chip

Above the text box there is a small rounded button called the **style chip**. It shows Vyuha's plan for your next message *before* you send it. It updates while you type. Example: `● Steady · Full detail ⌄`.

It has three parts:

**1. The state (the first word): how Vyuha reads you right now.** This is for display; it is worked out from the same measurements as the style.

| State | What it means | What triggers it |
|---|---|---|
| **Steady** | Nothing stands out. This is the default. | None of the cases below. |
| **Exploring** | You are still working out what you want. | A vague, open or hesitant message: few specific terms, words like `ideas`, `maybe`, `some`, `stuff`, a question like `what` / `why`, or many pauses. |
| **Focused** | You know what you want. | A specific, direct message (technical terms, constraints like `using` / `exactly`, a request like `write` / `fix` / `build`) while your energy is not low. |
| **Low energy** | You may be tired. | Slow or short typing compared with your normal, working late at night (11 pm to 5 am), or a session longer than 90 minutes. |
| **Last answer missed** | The previous answer did not help. | You asked again in different words, started with `no` / `that's not what I meant`, or the previous answer's "it worked" score was low. |

If more than one fits, the order is: Last answer missed, then Exploring, then Focused, then Low energy, then Steady.

**2. The style (after the dot `·`): how Gemini will answer.**

| Shown | Meaning |
|---|---|
| **Overview**, **Step by step**, **Full detail**, **Ask first** | The style Vyuha will ask Gemini to use for this one message. |
| **normal answer** (for example `Steady · normal answer`) | Gemini will answer normally with no style. This happens when Vyuha is less than 40% sure, or when the message is randomly kept as a plain comparison sample (about 1 message in 10) so Vyuha can check whether styling really helps. |
| **Adapting is off** | You switched off **Adapt Gemini's answers** in **How Vyuha Sees You…**. |
| **You: Full detail** | You picked this style yourself from the chip menu. The chip is highlighted. |
| **Auto** | Nothing typed yet, so no plan yet. |

**3. The dot and the hover text.** A grey dot means no style is planned (nothing typed, or a normal answer). A coloured dot means Vyuha has chosen a style. Hold the mouse over the chip to read why: which style, how sure Vyuha is (for example `72% sure`), whether it comes from one of your own rules ("from your pattern"), and which rule matched.

**The chip menu.** Click the chip to open it. It lists **Auto** (Vyuha picks), **Overview** (a few bullet ideas, short), **Step by step** (numbered walkthrough, medium), **Full detail** (complete code, edge cases), **Ask first** (check what you mean, then answer), and **How Vyuha sees you…** (opens the full page). Your pick applies to your **next message only**, then the chip returns to **Auto**. Picking a style yourself teaches Vyuha the most.

**The line under every answer.** A small line with a sparkle icon says which style was used and why. Click it to open **How Vyuha Sees You…**.

| Line says | Meaning |
|---|---|
| `Overview · you chose` | You picked it from the chip menu. |
| `Overview · chosen by Vyuha, 72% sure` | Vyuha picked it, with that confidence. |
| `Overview · from your pattern` | One of your own rules matched (see **Your patterns** in How Vyuha Sees You). |
| `... · Vyuha is trying this style to learn what suits you` | Occasionally Vyuha tries a different style on purpose, so it can notice when your preferences change. |
| `Normal · normal answer, kept as a comparison sample` | About 1 in 10 messages is answered without styling, as a comparison. |
| `Normal · normal answer, Vyuha was only 35% sure` | Vyuha wasn't confident enough, so it did not style the answer. |
| `Normal · adapting off` | Adapting is switched off. |

**Where the numbers live.** Open **Settings → How Vyuha Sees You…**. Under **Right now** it shows the same state with three sliders (clarity: exploring to clear, energy: low to focused, satisfaction: missed to working). The style and state are only about *length, depth and structure*. Gemini still tells you about mistakes and risks plainly.

#### Test it yourself

Do these in order, in the same project. Watch the chip after each step.

| # | Do this | You should see |
|---|---|---|
| 1 | Type slowly, with pauses: `spam filter ideas?` | The chip changes while you type, to something like `Exploring · Overview`. After you send, the reply is short bullet points, and the line under it says `Overview · chosen by Vyuha, N% sure`. |
| 2 | Switch to **Build with me** and type: `Write train.py using TF-IDF and LogisticRegression, 80/20 stratified split, print per-class F1` | The chip shows something like `Focused · Full detail`, and you get a long, structured reply with code. |
| 3 | Within 5 minutes, send: `no, I meant explain why stratified splitting matters` | The chip and the line under the answer read `Last answer missed`. The style should not be `Full detail` again. |
| 4 | Click the chip, choose **Ask first**, send anything. | The line under the reply says `Ask first · you chose`, and the chip goes back to **Auto** for the next message. |
| 5 | After a long reply, send: `shorter please` | In **Settings → How Vyuha Sees You…**, the previous reply's "it worked" score is lower. |
| 6 | Click **Copy** on a code block in a reply, then send another message. | That reply's "it worked" score goes up. |
| 7 | Open **Settings → How Vyuha Sees You…** | The numbers have moved since step 1. **You kept Vyuha's choice** counts your step 4 override. The "learned from" counts per style go up. |
| 8 | Click **Run analysis now**. | Notes appear, most likely saying there is too little data so far. |
| 9 | Click **Show files** and open `signals.jsonl`. | One line per message, with the features, style, source and reward. None of your text is in it. |

Notes:

- The exact chip wording (for example `Exploring` or `Focused`) depends on your own typing, so yours may differ. What matters is that the chip changes and the line under each reply says which style was used and why.
- "Slow", "fast", "short" and "detailed" always mean compared with **your own average**. Vyuha uses typical defaults until you have sent about 10 messages.
- **Typing speed on its own does not force a style.** It is one input among several. If you want slow typing to give an overview, add your own rule at the bottom of **How Vyuha Sees You…** (*When* `I'm typing slower than usual`, *answer with* `Overview`, click **Add rule**).
- A rephrase (asking the same thing again in different words) counts as "the last answer missed", and Vyuha will ask you a clarifying question first.

What Vyuha looks at in each message:

| Signal | Meaning |
|---|---|
| Words in the prompt | short or long, compared with *your own* normal |
| Specific terms | technical words like `dataset`, `classifier`, `TF-IDF`, and constraints like `using`, `exactly`, `only` |
| Typing speed | keys per second |
| Pauses | pauses longer than 2 seconds |
| Corrections | how many keys are backspaces |
| Rephrasing | you asked the last question again |
| Open question or request | `what / why / ideas` versus `write / fix / build` |
| Project phase, mode, time | early phase, Build mode, late at night, a session longer than 90 minutes |
| Your reaction to the reply | copying code, approving a command, ticking a task, opening a source, or saying `shorter please` |

Only numbers are stored (counts and timings), never the text you type or your keystrokes. Everything stays on your computer.

### Step 8. Working with a team (3 people, one project)

Use this when several people work on the same GitHub repository. Vyuha adds a shared layer called **team context** so everyone can see the plan, who owns what, the decisions made, and fixes for errors someone already solved.

The example: **Asha** starts the spam email filter. **Priya** and **Ravi** join her. Each person runs their own copy of Vyuha on their own computer, with their own Gemini key.

#### Git commit vs. Publish context: how they differ

These are two separate things. Neither replaces the other.

| | **Git commit / push** (Source Control) | **Publish context** (team context) |
|---|---|---|
| What it shares | Your **code and files** | Your **plan progress, ownership, decisions and error fixes** |
| Where it goes | The normal code branches (for example `main`) | A separate hidden branch called `vyuha_context`. Your code branches are never touched. |
| Buttons | **Commit**, **Push**, **Pull** | **Publish context**, **Pull context** |
| Who sees it | Anyone who pulls the code | Anyone with the team context set up who clicks **Pull context** |
| Needs a review step? | You write a commit message | Yes. A review window shows exactly what will be sent and lets you edit or untick items. |
| Can they conflict? | Yes, code merges can conflict | No. Each person only ever writes to their own folder on the context branch. |
| Is it automatic? | No | No. Nothing is shared until **you** click **Publish context**. |

In one sentence: **commit shares what you built; publish context shares what you planned, decided and learned.**

**Never shared**, even when you publish: your prompts, your chat with Gemini, and your typing/behaviour data. They stay on your computer.

#### What is tracked, and who sees it

| Item | Where you see it | Notes |
|---|---|---|
| **Plan** (phases and tasks) | **Team → Overview**, and the **Plan** section | The phases Gemini created, with a progress bar per phase. |
| **Phase owner** | **Team → Overview**, and the top of each phase page | One owner per phase. Shows who planned it and, if relevant, who it was taken over from. |
| **Task assignee** | The phase page, next to each task | `unassigned` until someone claims or is assigned it. |
| **Progress** | Ticks on tasks, shown as `done/total` | Anyone can tick a task they finished. The tick records who did it and when. |
| **Decisions** | **Team → Decisions** | Who decided, when, why, and the area. A replaced decision stays visible, struck through, with who replaced it and why. |
| **Issues and fixes** | **Team → Issues and fixes** | An error, its cause, and its fix (see "Error fixes" below). |
| **Everything that happened** | **Team → Timeline** | One line per event, for example "Priya started Backend". |
| **Actions the rules refused** | **Team → Overview → Refused actions** | For example someone tried to rename a phase they don't own. |
| **Members** | **Team → Overview → Members** | Each person and when they were last active. |
| **Answer styles** | **Team → Answer styles** | Only if the person ticked "Share my answer style". |

A readable summary of the same information, `TEAM.md`, is also written into the context branch, so you can read it on GitHub too.

#### Step-by-step: three people

| # | Who | Do this | You should see |
|---|---|---|---|
| 1 | Asha | Create the project, make the plan with Gemini (Steps 1 to 2), then publish the code to GitHub: **Source Control → Publish to GitHub** (needs the GitHub token from Step 6). | The project is on GitHub. A `Team context` area appears at the bottom of Source Control with a **Set up team context** button. |
| 2 | Asha | Click **Set up team context**. | A toast says `Team context is set up`. A **Team** row appears in the sidebar with a member count of `1`, and Source Control now shows **Pull context** and **Publish context**. Asha is recorded as the creator. |
| 3 | Asha | Click **Publish context**. Review the window, then click **Publish**. | The window says how many new plan events will be sent. `Last published:` shows the time. The plan is now shared. |
| 4 | Priya and Ravi | Each: **File → Clone Repository…**, enter `owner/repo` (the same GitHub repository), open it as a project. | The code arrives. The project opens. |
| 5 | Priya and Ravi | Open **Source Control** and click **Set up team context**. | The **Team** row appears with the plan Asha published. The member count rises as each person joins. |
| 6 | Priya | Open **Team → Overview**. | A table of phases (for example Planning, Backend, Frontend, Testing) with **Owner** (`unowned` for phases nobody has started) and **Progress**. |
| 7 | Priya | Open the **Backend** phase page and click **Start this phase**. | The owner reads `Priya`. Planned by `Asha` is shown next to it. |
| 8 | Ravi | At the same time, open **Frontend** and click **Start this phase**. | Ravi becomes the owner of Frontend. |
| 9 | Priya, Ravi | Each clicks **Publish context** and then **Publish**. | Both publishes succeed. They never block each other, because each person writes only their own folder. |
| 10 | Asha | Click **Pull context**. | The member count shows 3. **Team → Overview** shows Priya as owner of Backend and Ravi as owner of Frontend. **Team → Timeline** lists who started what. |

#### Ownership: every action

On a phase page, with team context set up, you see an **Owner** line and these controls.

| Button | What it does | Rule |
|---|---|---|
| **Start this phase** | You become the owner. | Only when the phase has no owner. |
| **Claim** (next to a task) | You take that task. If the phase has no owner, you also become its owner. | Anyone. Gemini does this for you before starting a task. |
| **Assign** (pick a name, then click) | Gives a task to a teammate. | Anyone. |
| **Hand off** (pick a name, then click) | Gives the phase to a teammate. | Only the current owner. |
| **Take over** | Takes a phase from its owner. | Only when the owner has been **inactive for 2 hours**. Before that the button is disabled and tells you how many minutes ago the owner was last active. |
| **Take back** | Returns the phase to you. | Only for the person it was taken from. |
| Rename a phase or task, remove a phase or task, reorder tasks | Edits the plan. | **Only the phase owner.** If the phase has no owner, nobody. |
| Reorder phases | Changes the order of the plan. | **Only the project creator** (Asha). |
| Tick a task | Marks it done, recorded with your name and time. | Anyone. If the phase has no owner, ticking a task makes you its owner. |

If someone tries something the rules don't allow, a toast says `Not allowed: <reason>` and it is listed under **Refused actions**. The plan is not changed.

"Active" means the person has published or acted recently, so a teammate who has not published for a while may look inactive even if they are working.

#### How one person uses another person's context

You do not copy anything by hand. There are four ways it reaches you.

1. **Read it.** Click **Pull context**, then open **Team**. The tabs are **Overview** (phases, owners, progress, members), **Issues and fixes** (search by error text, file or area), **Decisions**, **Timeline** and **Answer styles**.
2. **Gemini already knows it.** Every time you message Gemini in a team project, it is told who the members are, who owns each phase, which tasks you have claimed, the current team decisions and recently fixed issues. For example, ask `What should I work on next?` and it answers using the team plan. Gemini will not rename or reorder phases owned by someone else.
3. **Reuse a teammate's error fix.** If you run a command in the Terminal and it fails with an error a teammate already fixed, a bar appears above the terminal: `Priya fixed this error before: <title>`. Click **View fix** to open the full card, or **Ask Gemini to apply it** to have Gemini make the same fix in your files and run the command again. If the teammate is still stuck on it, the bar says `Priya is also stuck on this`. Click **×** to dismiss it.
4. **Answer like a teammate.** On **Team → Answer styles**, click **Answer like Priya**. Priya's learned answer style is blended with yours, and her rules are added to yours labelled "borrowed". Your own history is not changed. Click **Undo the last imported style** to go back. This only works if Priya ticked **Share my answer style** when she published.

#### Error fixes: how a card gets made

1. You run a command in the Terminal (or Gemini does, after you click **Run**) and it fails.
2. You fix it, and the command works.
3. Vyuha writes a short **issue card** as a draft: symptom, cause, fix, and the files changed. Gemini writes it from the error and its own replies. Your own prompts are not used.
4. A toast says `Fixed: <title>. Publish context to share the fix with your team.`
5. Click **Publish context**. In the review window, each draft shows a tick box, a title, **Symptom**, **Cause** and **Fix**. Edit anything, or untick the card to keep it private, then click **Publish**.
6. Teammates click **Pull context**. The card appears in **Team → Issues and fixes**, and the bar in step 3 above appears if they hit the same error.

Also in the review window: **Share my answer style**. Tick it only if you want teammates to be able to choose **Answer like you**. Only learned weights and rules are shared, never your messages or typing.

#### Test it yourself (two people on one computer are enough)

| # | Do this | You should see |
|---|---|---|
| 1 | Open Source Control in a project that is on GitHub. | A **Team context** area with **Set up team context**. |
| 2 | Click it. | `Team context is set up`, and a **Team** row in the sidebar. |
| 3 | Open a phase page and click **Start this phase**. | You are shown as the owner. |
| 4 | Click **Publish context**. | A review window with the number of new plan events. Click **Publish**: `Team context published`. |
| 5 | Open **Team → Timeline**. | A line for your action. |
| 6 | Run a command that fails (for example `python nothing.py`), fix it, run it again. | A toast `Fixed: …` and a draft issue in the next publish review. |
| 7 | Publish again with the draft ticked. | The card appears in **Team → Issues and fixes**. |
| 8 | On a second machine or account, clone, set up, **Pull context**, and run the same failing command. | The bar above the terminal: `<name> fixed this error before`. |
| 9 | On the second machine, try **Take over** on the first person's phase right away. | The button is disabled, with the number of minutes since they were last active. |

---

## Preferences, modes and where to find everything

### Modes (Gemini)

At the top of the project's full-page chat:

| Mode | What Gemini does |
|---|---|
| **Teach me** (default) | Acts as a tutor. Lays out a roadmap, explains each step from first principles, shows commented code to try, and checks your understanding. It does not create files or run commands unless you ask. |
| **Build with me** | Plans, writes files, runs them (with your approval) and fixes what breaks. |

### Answer style chip

Next to every chat box. Click it to pick the style for your **next message only**:

| Style | What you get |
|---|---|
| **Auto** | Vyuha picks from how you are working (default). |
| **Overview** | 4 to 7 short bullet ideas, under about 150 words, ending with a question. |
| **Step by step** | A numbered walkthrough with the reasoning, medium length. |
| **Full detail** | Complete code, the reasons behind choices, edge cases, with headings. |
| **Ask first** | Restates what it thinks you mean and asks one or two questions before answering. |

The chip's label shows Vyuha's plan before you send. Under each answer, a small tag tells you which style was used and why.

### Settings → Preferences… (`Ctrl+,`)

| Setting | What it does |
|---|---|
| **Research pages** | Docs, articles and search results are filed to `research/`. Untick to stop saving them. |
| **Dataset pages** | Hugging Face, Kaggle and open-data pages are filed to `datasets/`. |
| **Videos** | YouTube pages are filed to `videos/`. |
| **GitHub token** | Needed to publish, push, pull and clone private repositories. Buttons: **Save and test**, **Create a token**, **Remove**. |
| **Gemini API key** | Your key. **Save and test** checks it. **Remove key** deletes it. |
| **Model** | The Gemini model to use. |
| **Backup model** | Used when the main model is overloaded. |

Click **Save settings** to apply.

### Settings → How Vyuha Sees You…

Shows everything Vyuha has learned about how you like answers:

- **Right now:** your current state (clarity, energy, satisfaction) and the last style used.
- **Your normal:** your average words per prompt, specific terms, typing speed, pauses and corrections.
- **Your patterns:** rules such as "when my prompt is vague, give an overview". Each shows its status (*Your rule*, *Testing*, *Confirmed*, *Retired*) and its evidence. You can **Switch off** or **Delete** any rule.
- **Add a rule:** at the bottom of "Your patterns", choose *When* (for example `I'm typing slower than usual`) and *answer with* (for example `Overview`), then click **Add rule**. Your own rules apply straight away.
- **Is it working?:** how often you kept Vyuha's choice, and how often you rephrased.
- **Analyst:** **Run analysis now** asks Gemini to suggest new patterns from totals (never your messages).
- **Controls:** the **Learn from how I work** and **Adapt Gemini's answers** switches, **Show files**, and **Delete everything learned**.

### Keyboard shortcuts

| Action | Shortcut |
|---|---|
| New tab | `Ctrl+T` |
| Close tab | `Ctrl+W` |
| New project | `Ctrl+Shift+N` |
| Open folder as a project | `Ctrl+O` |
| Save the open file | `Ctrl+S` |
| Focus the address bar | `Ctrl+L` |
| Show or hide the sidebar | `Ctrl+B` |
| Show or hide the terminal | `Ctrl+J` |
| Show or hide the Gemini side panel | `Ctrl+I` |
| Reload the page | `Ctrl+R` |
| Preferences | `Ctrl+,` |
| Undo a Gemini edit in the editor | `Ctrl+Z` |

### Mouse

- Click a file, source or phase to open it.
- Click **⋮** or right-click a row for rename, delete, move and other actions.
- Hover a section header (Files, Sources, Plan) to reveal its **+** button.
- Drag the edge of the sidebar, Gemini panel or terminal to resize it. Double-click an edge to reset. Sizes are remembered.
- With an edge focused (press `Tab`), the arrow keys resize it; `Shift`+arrow resizes in bigger steps.

### Other menu items

- **File → Open Project** switches to another project.
- **File → Clone Repository…** copies a GitHub repository and opens it as a project.
- **File → Delete Project…** (or the project's **⋮** menu): a Vyuha project moves to the Trash. For an opened folder you choose **Remove from Vyuha** (files stay) or **Move Folder to Trash**.

### Where your data is stored

Each project is a real folder with `project.json` (sources and decisions) and a `code/` folder. Default location:

- Windows: `%APPDATA%\vyuha\projects\`
- macOS: `~/Library/Application Support/vyuha/projects/`
- Linux: `~/.config/vyuha/projects/`

Learned style data is stored on your computer too (use **Show files** in *How Vyuha Sees You*).

### Known limits

- **Google sign-in** may refuse to work inside Electron ("This browser may not be secure"). Browsing sites without signing in works fine.
- **Routing uses keyword rules:** "video" goes to YouTube, "datasets" to Hugging Face, and so on.
- **Without a Gemini key**, project questions are answered only from the project's notes.
- **Gemini sees only what a normal visitor sees.** Some sites (for example Kaggle) need sign-in for full content.

