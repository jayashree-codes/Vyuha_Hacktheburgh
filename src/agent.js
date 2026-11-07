// Vyuha's project agent, powered by Gemini.
// It only runs inside a project. Each request rebuilds the system prompt from the
// project's current state (goal, phase, sources, decisions, code), so the model
// always works from what's actually on disk. The model acts through tools:
// browsing (pages it opens are filed into the project), reading and writing code
// files, recording decisions and moving the project to another phase.
const { GoogleGenAI, Type } = require('@google/genai');

const MAX_TOOL_ROUNDS = 8;
const RETRY_WAITS = [2000, 5000, 10000];   // pauses before retrying when Gemini is overloaded
const sleep = ms => new Promise(r => setTimeout(r, ms));
// 503 / UNAVAILABLE = Google's servers are busy; temporary, worth retrying
const isBusy = e => /\b503\b|UNAVAILABLE|overloaded|high demand/i.test(String((e && e.message) || e));

async function withRetry(fn, onRetry) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (!isBusy(e) || i >= RETRY_WAITS.length) throw e;
      if (onRetry) onRetry(i + 1, RETRY_WAITS[i]);
      await sleep(RETRY_WAITS[i]);
    }
  }
}

const SITES = ['web', 'youtube', 'huggingface_datasets', 'kaggle', 'github', 'stackoverflow', 'arxiv', 'wikipedia'];

const TOOLS = [{
  functionDeclarations: [
    {
      name: 'find_videos',
      description: 'Find specific YouTube videos. Returns real videos with title, URL, channel, length and views. Use this whenever the user wants videos or tutorials, then recommend specific ones.',
      parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING } }, required: ['query'] }
    },
    {
      name: 'find_repos',
      description: 'Find specific GitHub repositories (sorted by stars). Returns name, URL, stars, language and description.',
      parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: 'GitHub search terms, e.g. "sms spam classifier python"' } }, required: ['query'] }
    },
    {
      name: 'find_datasets',
      description: 'Find specific datasets on Hugging Face and Kaggle. Returns names and URLs.',
      parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING } }, required: ['query'] }
    },
    {
      name: 'set_plan',
      description: 'Set the project plan: replaces the phases with the ones given, each with a goal and a checklist of concrete tasks. Use it when the user starts a project, asks for a plan or roadmap, or the plan changes.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          phases: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING, description: 'Short phase name, e.g. "Get the data"' },
                goal: { type: Type.STRING, description: 'One sentence: what is true when this phase is done' },
                tasks: { type: Type.ARRAY, items: { type: Type.STRING }, description: '3-7 concrete tasks' }
              },
              required: ['name', 'tasks']
            }
          },
          current: { type: Type.STRING, description: 'Name of the phase the user is in now' }
        },
        required: ['phases']
      }
    },
    {
      name: 'update_task',
      description: "Tick off (or reopen) a task in a phase's checklist when it's done. Adds the task if it isn't there yet.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          phase: { type: Type.STRING, description: 'Phase name; defaults to the current phase' },
          task: { type: Type.STRING, description: 'The task text, or enough of it to identify it' },
          done: { type: Type.BOOLEAN }
        },
        required: ['task', 'done']
      }
    },
    {
      name: 'search_web',
      description: 'Search a site and read the results page. The results page is filed into the project. Use "huggingface_datasets" or "kaggle" for datasets, "youtube" for videos, "web" for general searches.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          site: { type: Type.STRING, enum: SITES, description: 'Where to search' },
          query: { type: Type.STRING, description: 'Search terms' },
          reason: { type: Type.STRING, description: 'One line on why this helps the project; saved with the source' }
        },
        required: ['site', 'query', 'reason']
      }
    },
    {
      name: 'open_page',
      description: 'Open a URL, read its text and links. The page is filed into the project as a source. Use this to look at a specific result, dataset card, doc page or video.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          url: { type: Type.STRING },
          reason: { type: Type.STRING, description: 'One line on why this page matters to the project' }
        },
        required: ['url', 'reason']
      }
    },
    {
      name: 'read_file',
      description: "Read a file in the project folder. Paths are relative to the project root, e.g. src/train.py.",
      parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING } }, required: ['path'] }
    },
    {
      name: 'write_file',
      description: "Create or overwrite a file in the project folder (relative path, folders are created as needed). Always write the complete file. If the user has the file open in the editor it updates there too.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          path: { type: Type.STRING },
          content: { type: Type.STRING, description: 'The full file contents' },
          source_urls: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'URLs of filed sources this file is based on' }
        },
        required: ['path', 'content']
      }
    },
    {
      name: 'run_command',
      description: "Run a shell command in the project folder on the user's computer, e.g. `python train.py`, `pip install -r requirements.txt`, `pytest`, `git status`. The user must approve each command first, so explain why in `reason`. Output is shown in Vyuha's terminal panel and returned to you. Commands that wait for keyboard input won't work. Long-running servers are stopped after the time limit.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          command: { type: Type.STRING },
          reason: { type: Type.STRING, description: 'One line shown to the user when asking for approval' },
          timeout_seconds: { type: Type.NUMBER, description: 'Stop the command after this many seconds (default 120, max 900)' }
        },
        required: ['command', 'reason']
      }
    },
    {
      name: 'record_source',
      description: 'File a source into the project folders: the dataset you chose (always do this, even if you only download it in code), or a key doc or video. Use the dataset\'s main page URL.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          url: { type: Type.STRING },
          title: { type: Type.STRING, description: 'Short name, e.g. "SMS Spam Collection (UCI)"' },
          type: { type: Type.STRING, description: 'The collection to file it in: "dataset", "video", "repo", "research", or the name of one of the project\'s own collections' },
          why: { type: Type.STRING, description: 'One line on why it is used' }
        },
        required: ['url', 'title', 'type', 'why']
      }
    },
    {
      name: 'update_notes',
      description: "Write the notes for a phase (shown as phases/<phase>.md). Use it to save the plan or roadmap in the planning phase, and a short summary of what was done when a phase finishes. Markdown checklists work well. Doesn't change the current phase.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          phase: { type: Type.STRING, description: 'An existing phase, e.g. "1-planning"' },
          note: { type: Type.STRING },
          append: { type: Type.BOOLEAN, description: 'Add to the existing notes instead of replacing them' }
        },
        required: ['phase', 'note']
      }
    },
    {
      name: 'record_decision',
      description: 'Record a project decision in decisions.md, with the sources behind it.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          detail: { type: Type.STRING, description: 'What was decided and why, in one or two sentences' },
          source_urls: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ['title', 'detail']
      }
    },
    {
      name: 'set_phase',
      description: 'Move the project to a phase (existing or new, e.g. "4-evaluation") and record a short note on its status.',
      parameters: {
        type: Type.OBJECT,
        properties: { phase: { type: Type.STRING }, note: { type: Type.STRING } },
        required: ['phase', 'note']
      }
    }
  ]
}];

const TEACH_MODE = `MODE: TEACH ME. The user is here to learn how to build this, like a student with a patient tutor.
- Answer like a regular chat assistant: explain in the conversation, don't take actions by default.
- Teach from first principles. Say what the problem is, why each step exists, and how the pieces connect (data → preparation → features → model → evaluation → improvement, or whatever fits the task).
- Lay out a numbered roadmap first, then go through one step at a time. End each reply with what to try next or one short question that checks understanding.
- Show short code examples in fenced code blocks with comments, and explain what each part does. Prefer simple, standard libraries (e.g. scikit-learn before deep learning) unless the user asks otherwise.
- Use small worked examples with real numbers when a concept needs it (e.g. compute precision and recall on a 10-email example).
- Adapt to the user's level; if they seem new to something, slow down and define terms.
- Don't write files or run commands unless the user asks you to (they can also switch to "Build with me"). You may use search_web or open_page to point to real datasets, docs or videos, and cite them.
- Do keep the project organised even in this mode: when you lay out a roadmap, save it with set_plan; tick tasks with update_task when the user says they've done them; and file every specific video, repository, dataset or page you recommend with record_source.`;

const BUILD_MODE = `MODE: BUILD WITH ME. The user wants you to do the work alongside them.
- Be concise and practical. Plan briefly, then act: write files, run them, read the output and fix problems.
- Explain what you did and why in a few sentences after acting.`;

const cut = (s, n) => (s && s.length > n ? s.slice(0, n) + `\n…(${s.length - n} more characters)` : s || '');

function systemPrompt(p, files, paths = [], mode = 'teach') {
  const colName = id => ((p.collections || []).find(c => c.id === id) || { name: id }).name;
  const sources = p.events.map(e => `- [${colName(e.type)}${e.status === 'rejected' ? ', rejected' : ''}] ${e.title || e.url} | ${e.url} | phase ${e.phase || '-'} | why: ${e.why || '-'}`).join('\n') || '(none yet)';
  const decisions = (p.decisions || []).map(d => `- ${d.title}: ${d.detail} (phase ${d.phase})`).join('\n') || '(none yet)';
  const notes = p.phases.map(ph => `- ${ph}${ph === p.phase ? ' (current)' : ''}: ${(p.phaseNotes || {})[ph] || ''}`).join('\n');
  let budget = 24000;
  const code = files.map(f => {
    const body = cut(f.content, Math.max(0, Math.min(6000, budget)));
    budget -= body.length;
    return `--- ${f.name} ---\n${body}`;
  }).join('\n\n') || '(no files yet)';
  const tree = paths.length ? paths.slice(0, 400).join('\n') + (paths.length > 400 ? `\n…and ${paths.length - 400} more` : '') : '(empty)';

  return `You are the project agent inside Vyuha, a browser that keeps every project's research, decisions and code together.
You are working on ONE project: "${p.id}".

Goal: ${p.summary}
Current phase: ${p.phase}

Phases:
${notes}

Decisions so far:
${decisions}

Source collections: ${(p.collections || []).map(c => c.name).join(', ')}
Sources already filed:
${sources}

Project folder: ${p.root || ''}
Files in the project folder:
${tree}

Contents of some files (use read_file for others):
${code}

${mode === 'build' ? BUILD_MODE : TEACH_MODE}

How to work:
- When you need information from the web, use search_web and open_page rather than relying on memory. Every page you open is filed into the project, so only open pages that are relevant.
- When you write code, use write_file with the complete file and list the source URLs it is based on. Read a file before changing it.
- To check your work, use run_command (e.g. run the script or tests). Each command needs the user's approval, so don't run trivial or risky commands; never delete files or touch anything outside the project folder.
- To show a static HTML page, tell the user to open the file and click Preview (top right of the editor tabs); it opens inside Vyuha and reloads on every save. Don't start a web server for static files.
- run_command stops commands after their time limit, so it can't keep a server running. If the project really needs a server (Flask, Node, etc.), ask the user to start it themselves in the Terminal panel, then open http://localhost:PORT in Vyuha's address bar.
- Messages may start with a note about what the user is currently looking at (a file or a web page). Use it when the question refers to "this".
- Recommend SPECIFIC things, never just a search page:
  - Videos: call find_videos and recommend particular videos (title, channel, link).
  - Code: call find_repos and recommend particular repositories (name, stars, link).
  - Data: call find_datasets (and search_web if needed) and recommend particular datasets (name, size, link).
  - Then call record_source for each item you recommend (type "video", "repo" or "dataset"), and include its link in your reply.
- Keep the project's records current, so the folders show what was used:
  - When the user starts the project or asks for a plan, call set_plan with 3-6 phases in order, each with a goal and concrete tasks. Set current to where the user is.
  - As work gets done, call update_task to tick tasks off; when a phase's tasks are done, call set_phase to move on.
  - Whenever you recommend, compare or choose datasets, call record_source with type "dataset" for each one, using its real main page URL (use search_web first if you aren't sure of the URL). Do this even if you only download it in code.
  - When a meaningful choice is made (a dataset, a library, an approach), call record_decision.
  - When a phase's work is done, add a short summary to its notes (update_notes with append) and move on with set_phase.
- Cite sources as markdown links using their real URLs. Never invent URLs.
- Stay within this project. If the user asks about something unrelated, answer briefly without filing anything.`;
}

// Keep saved history small: drop long page texts from old tool results and keep the last turns.
function trimHistory(history, maxContents = 40) {
  const h = JSON.parse(JSON.stringify(history || []));
  for (const c of h) {
    for (const part of c.parts || []) {
      const fr = part.functionResponse;
      if (fr && JSON.stringify(fr.response || {}).length > 1500) {
        const out = (fr.response && fr.response.output) || {};
        fr.response = { output: { url: out.url, title: out.title, note: 'Page text removed from saved history to save space.' } };
      }
    }
  }
  if (h.length <= maxContents) return h;
  // restart at a user message that contains text (not a tool result), so calls and results stay paired
  for (let i = h.length - maxContents; i < h.length; i++) {
    const c = h[i];
    if (c.role === 'user' && (c.parts || []).some(p => typeof p.text === 'string')) return h.slice(i);
  }
  return h.slice(-2);
}

function friendlyError(e, model) {
  const msg = String((e && e.message) || e);
  if (/API_KEY_INVALID|API key not valid|PERMISSION_DENIED.*key|401/i.test(msg)) return 'Gemini rejected the API key. Check it in Settings.';
  if (/not found|404/i.test(msg) && /model/i.test(msg)) return `The model "${model}" wasn't found. Check the model name in Settings.`;
  if (/INVALID_ARGUMENT|\b400\b/.test(msg) && /function_declarations|tools/.test(msg)) return 'Vyuha sent Gemini an invalid tool definition (a bug in Vyuha, not your key). Details: ' + msg.slice(0, 200);
  if (isBusy(e)) return `Gemini (${model}) is overloaded right now. This is on Google's side, not your key. Try again in a minute, or choose a lighter model in Settings.`;
  if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) return 'Gemini rate limit or quota reached. Wait a minute and try again, or check your plan in Google AI Studio.';
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|network/i.test(msg)) return "Couldn't reach Gemini. Check your internet connection.";
  return `Gemini error: ${msg.slice(0, 300)}`;
}

// Text parts of a streamed chunk, leaving out the model's hidden thinking
function chunkText(ch) {
  const parts = ch.candidates && ch.candidates[0] && ch.candidates[0].content && ch.candidates[0].content.parts;
  if (!parts) return ch.text || '';
  return parts.filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join('');
}

// Send one message; stream the reply text as it arrives when the SDK supports it
async function send(chat, message, onText, prefix) {
  if (!chat.sendMessageStream) {
    const r = await chat.sendMessage({ message });
    if (r.text && onText) onText(prefix + r.text);
    return { text: r.text || '', functionCalls: r.functionCalls };
  }
  const stream = await chat.sendMessageStream({ message });
  let text = '';
  const calls = [];
  for await (const ch of stream) {
    const t = chunkText(ch);
    if (t) { text += t; if (onText) onText(prefix + text); }
    if (ch.functionCalls && ch.functionCalls.length) calls.push(...ch.functionCalls);
  }
  return { text, functionCalls: calls.length ? calls : undefined };
}

async function run({ apiKey, model, fallbackModel, project, files, paths, history, message, tools, client, onNotice, onText, mode }) {
  const ai = client || new GoogleGenAI({ apiKey });
  const notice = onNotice || (() => {});
  const start = m => ai.chats.create({
    model: m,
    config: { systemInstruction: systemPrompt(project, files, paths, mode), tools: TOOLS },
    history: history || []
  });
  const onRetry = (n, ms) => notice(`Gemini is busy, retrying in ${ms / 1000}s (attempt ${n + 1})`);
  let full = '';   // reply text across tool rounds
  const join = t => (full && t ? full + '\n\n' + t : full + t);
  const sendNow = (c, m) => send(c, m, onText && (s => onText(s)), full ? full + '\n\n' : '');

  let chat = start(model);
  let res;
  try {
    res = await withRetry(() => sendNow(chat, message), onRetry);
  } catch (e) {
    // still overloaded after retries: try the backup model once
    if (!isBusy(e) || !fallbackModel || fallbackModel === model) throw e;
    notice(`${model} is overloaded, switched to ${fallbackModel} for this request`);
    chat = start(fallbackModel);
    res = await withRetry(() => sendNow(chat, message), onRetry);
  }
  full = join(res.text || '');
  let rounds = 0;
  while (res.functionCalls && res.functionCalls.length) {
    if (++rounds > MAX_TOOL_ROUNDS) {
      return { text: join(`I stopped after ${MAX_TOOL_ROUNDS} rounds of actions. Ask me to continue if you want me to keep going.`), history: chat.getHistory() };
    }
    const parts = [];
    for (const call of res.functionCalls) {
      let output;
      try {
        const fn = tools[call.name];
        output = fn ? await fn(call.args || {}) : { error: `Unknown tool ${call.name}` };
      } catch (err) { output = { error: err.message }; }
      parts.push({ functionResponse: { id: call.id, name: call.name, response: { output } } });
    }
    res = await withRetry(() => sendNow(chat, parts), onRetry);
    full = join(res.text || '');
  }
  return { text: full, history: chat.getHistory() };
}

// After a reply that talks about datasets, list the datasets it named with their main pages,
// as structured JSON, so Vyuha can file them even if the model didn't call record_source.
async function extractDatasets({ apiKey, model, client, question, reply }) {
  const ai = client || new GoogleGenAI({ apiKey });
  if (!ai.models || !ai.models.generateContent) return [];
  const r = await withRetry(() => ai.models.generateContent({
    model,
    contents: `From the assistant reply below, list every dataset it names or recommends (not libraries, models or tools).
For each, give the name, the URL of its main public page (prefer the official source: UCI, Kaggle, Hugging Face, the authors' site), and one line on what it is.
Only include URLs you are confident exist. Return [] if no datasets are named.

User asked: ${question}

Reply:
${reply.slice(0, 12000)}`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: { name: { type: Type.STRING }, url: { type: Type.STRING }, why: { type: Type.STRING } },
          required: ['name', 'url']
        }
      }
    }
  }));
  try {
    const list = JSON.parse(r.text || '[]');
    return Array.isArray(list) ? list.filter(d => d && d.name).slice(0, 12) : [];
  } catch (e) { return []; }
}

// After a reply that lays out a roadmap, turn it into phases with tasks (used if the model didn't call set_plan)
async function extractPlan({ apiKey, model, client, question, reply }) {
  const ai = client || new GoogleGenAI({ apiKey });
  if (!ai.models || !ai.models.generateContent) return null;
  const r = await withRetry(() => ai.models.generateContent({
    model,
    contents: `Turn the roadmap in the assistant reply below into a project plan: 3-6 phases in order, each with a short name, a one-sentence goal and 3-7 concrete tasks taken from the reply. Set "current" to the first phase unless the reply says the user is further along. If the reply has no roadmap, return {"phases": []}.

User asked: ${question}

Reply:
${reply.slice(0, 12000)}`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          phases: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: {
            name: { type: Type.STRING }, goal: { type: Type.STRING }, tasks: { type: Type.ARRAY, items: { type: Type.STRING } } }, required: ['name', 'tasks'] } },
          current: { type: Type.STRING }
        },
        required: ['phases']
      }
    }
  }));
  try { return JSON.parse(r.text || '{}'); } catch (e) { return null; }
}

async function commitMessage({ apiKey, model, client, changes, diff, added }) {
  const ai = client || new GoogleGenAI({ apiKey });
  const r = await withRetry(() => ai.models.generateContent({
    model,
    contents: `Write a git commit message for these changes. First line: imperative mood, at most 60 characters, no period. If useful, a blank line then 1-3 short bullet points. Reply with the message only.

Changed files:
${changes}

${diff ? 'Diff:\n' + diff : ''}
${added ? '\n' + added : ''}`
  }));
  return (r.text || '').replace(/^```\w*\n?|```$/g, '').trim();
}

async function test({ apiKey, model }) {
  const ai = new GoogleGenAI({ apiKey });
  const r = await ai.models.generateContent({ model, contents: 'Reply with the single word OK.' });
  return (r.text || '').trim();
}

// tests use short waits
const _setRetryWaits = w => RETRY_WAITS.splice(0, RETRY_WAITS.length, ...w);

module.exports = { run, test, commitMessage, extractDatasets, extractPlan, trimHistory, friendlyError, SITES, TOOLS, systemPrompt, _setRetryWaits };
