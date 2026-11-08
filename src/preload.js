// The only bridge between Vyuha's own UI and the main process.
// Web pages (YouTube etc.) never get this; they run in separate, sandboxed views.
const { contextBridge, ipcRenderer } = require('electron');

const invoke = ch => (...args) => ipcRenderer.invoke(ch, ...args);
const send = ch => (...args) => ipcRenderer.send(ch, ...args);
const listen = ch => cb => ipcRenderer.on(ch, (_e, ...args) => cb(...args));

contextBridge.exposeInMainWorld('vyuha', {
  // tabs and browsing
  getState: invoke('state:get'),
  prompt: invoke('prompt'),
  navigate: invoke('navigate'),
  newTab: send('tab:new'),
  closeTab: send('tab:close'),
  activate: send('tab:activate'),
  setPane: send('tab:pane'),
  back: send('nav:back'),
  forward: send('nav:forward'),
  reload: send('nav:reload'),
  home: send('nav:home'),
  fileTab: send('tab:file'),
  unfileTab: send('tab:unfile'),
  setSlot: send('slot'),
  overlay: send('overlay'),
  // projects and files
  openProject: send('project:open'),
  closeProject: send('project:close'),
  openFolder: send('project:openFolder'),
  getProject: invoke('project:get'),
  createProject: invoke('project:create'),
  openLink: send('project:openLink'),
  deleteEvent: invoke('event:delete'),
  updateEvent: invoke('event:update'),
  editProject: invoke('project:edit'),
  closePage: send('page:close'),
  readFile: invoke('file:read'),
  writeFile: invoke('file:write'),
  previewFile: invoke('file:preview'),
  // projects and source control
  deleteProject: invoke('project:delete'),
  revealProject: send('project:reveal'),
  gitStatus: invoke('git:status'),
  gitOp: invoke('git:op'),
  gitClone: invoke('git:clone'),
  githubStatus: invoke('github:status'),
  githubSetToken: invoke('github:setToken'),
  onGitChanged: listen('git-changed'),
  // team context (its own branch; code push/pull are separate)
  teamState: invoke('team:state'),
  teamSetup: invoke('team:setup'),
  teamPull: invoke('team:pull'),
  teamPending: invoke('team:pending'),
  teamPublish: invoke('team:publish'),
  teamAction: invoke('team:action'),
  teamImportStyle: invoke('team:importStyle'),
  teamUndoStyle: invoke('team:undoStyle'),
  onTeam: listen('team'),
  // terminal
  termGet: invoke('term:get'),
  termRun: invoke('term:run'),
  termStop: send('term:stop'),
  termClear: send('term:clear'),
  // settings and Gemini
  getSettings: invoke('settings:get'),
  setSettings: invoke('settings:set'),
  agentStatus: invoke('agent:status'),
  agentAsk: invoke('agent:ask'),
  agentChat: invoke('agent:chat'),
  agentClear: invoke('agent:clear'),
  agentSetMode: invoke('agent:setMode'),
  agentApprove: send('agent:approve'),
  agentSetKey: invoke('agent:setKey'),
  agentTest: invoke('agent:test'),
  // behaviour learning (numbers only)
  behaviourPreview: invoke('behaviour:preview'),
  behaviourNote: send('behaviour:note'),
  behaviourSummary: invoke('behaviour:summary'),
  behaviourEdit: invoke('behaviour:edit'),
  behaviourAnalyse: invoke('behaviour:analyse'),
  behaviourReveal: send('behaviour:reveal'),
  // events from the main process
  onState: listen('state'),
  onUi: listen('ui'),
  onAgent: listen('agent'),
  onTerm: listen('term'),
  onFileChanged: listen('file-changed')
});
