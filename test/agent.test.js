// Exercises the agent's tool loop with a stand-in for the Gemini client. Run: node test/agent.test.js
const assert = require('assert');
const agent = require('../src/agent');

function fakeClient(script) {
  const sent = [];
  return {
    sent,
    chats: { create: (opts) => {
      assert.ok(opts.config.systemInstruction.includes('sentiment-classifier'), 'system prompt names the project');
      assert.ok(opts.config.tools[0].functionDeclarations.length >= 6, 'tools declared');
      let i = 0;
      return {
        sendMessage: async ({ message }) => { sent.push(message); return script[i++]; },
        getHistory: () => [{ role: 'user', parts: [{ text: 'hi' }] }, { role: 'model', parts: [{ text: 'ok' }] }]
      };
    } }
  };
}

// Every tool's required fields must exist in its properties (Gemini rejects the whole request otherwise)
{
  const { TOOLS } = require('../src/agent');
  for (const fd of TOOLS[0].functionDeclarations) {
    for (const r of fd.parameters.required || []) {
      assert.ok(fd.parameters.properties[r], `${fd.name}: required field "${r}" is not defined`);
    }
  }
}

(async () => {
  const calls = [];
  const tools = {
    search_web: async a => { calls.push(['search_web', a]); return { url: 'https://huggingface.co/datasets?search=x', title: 'r', text: 'results', links: [] }; },
    write_file: async a => { calls.push(['write_file', a]); return { ok: true }; },
    record_decision: async a => { calls.push(['record_decision', a]); return { ok: true }; }
  };
  const client = fakeClient([
    { functionCalls: [{ id: 'c1', name: 'search_web', args: { site: 'huggingface_datasets', query: 'movie reviews', reason: 'data' } }] },
    { functionCalls: [
      { id: 'c2', name: 'write_file', args: { name: 'eval.py', content: 'print(1)' } },
      { id: 'c3', name: 'record_decision', args: { title: 'Use IMDb', detail: 'Balanced.' } }
    ] },
    { functionCalls: undefined, text: 'Done. See [IMDb](https://ai.stanford.edu/~amaas/data/sentiment/).' }
  ]);
  const project = { id: 'sentiment-classifier', summary: 's', phase: '3-modelling', phases: ['3-modelling'], phaseNotes: {}, events: [], decisions: [] };
  const res = await agent.run({ model: 'm', project, files: [], history: [], message: 'find data and write eval', tools, client });

  assert.deepStrictEqual(calls.map(c => c[0]), ['search_web', 'write_file', 'record_decision']);
  assert.strictEqual(client.sent.length, 3);
  const second = client.sent[2];   // tool results sent back together, matched by id
  assert.deepStrictEqual(second.map(p => p.functionResponse.id), ['c2', 'c3']);
  assert.ok(res.text.startsWith('Done.'));

  // trimHistory removes long page text but keeps structure
  const big = [{ role: 'user', parts: [{ functionResponse: { name: 'open_page', response: { output: { url: 'u', title: 't', text: 'x'.repeat(5000) } } } }] }];
  const trimmed = agent.trimHistory(big);
  assert.ok(JSON.stringify(trimmed).length < 600);
  assert.strictEqual(trimmed[0].parts[0].functionResponse.response.output.url, 'u');

  // friendly errors
  assert.match(agent.friendlyError(new Error('API key not valid. Please pass a valid API key.'), 'm'), /rejected the API key/);
  assert.match(agent.friendlyError(new Error('models/foo is not found for API version v1beta'), 'foo'), /wasn't found/);
  // overloaded: retries, then switches to the backup model
  agent._setRetryWaits([10, 10, 10]);
  const busy = new Error('{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}');
  const used = [], notices = [];
  let fails = 0;
  const flaky = { chats: { create: o => ({
    sendMessage: async () => { used.push(o.model); if (o.model === 'main' && fails++ < 99) throw busy; return { text: 'from backup' }; },
    getHistory: () => [] }) } };
  const r2 = await agent.run({ model: 'main', fallbackModel: 'backup', project, files: [], history: [], message: 'hi', tools: {}, client: flaky, onNotice: n => notices.push(n) });
  assert.strictEqual(r2.text, 'from backup');
  assert.strictEqual(used.filter(m => m === 'main').length, 4, 'tried main once plus 3 retries');
  assert.ok(notices.some(n => /switched to backup/.test(n)));
  // recovers on retry without switching
  let n = 0;
  const blip = { chats: { create: () => ({ sendMessage: async () => { if (n++ < 1) throw busy; return { text: 'ok' }; }, getHistory: () => [] }) } };
  assert.strictEqual((await agent.run({ model: 'main', fallbackModel: 'backup', project, files: [], history: [], message: 'hi', tools: {}, client: blip })).text, 'ok');
  assert.match(agent.friendlyError(busy, 'main'), /overloaded/);
  // streaming: text arrives in pieces, tool calls in between, and the mode reaches the system prompt
  const seen = [];
  let prompt = '';
  async function* chunks(list) { for (const c of list) yield c; }
  const streamed = [
    [{ text: 'Step 1: ' }, { text: 'get data.' }, { functionCalls: [{ id: 's1', name: 'search_web', args: { site: 'kaggle', query: 'spam', reason: 'data' } }] }],
    [{ candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }, { text: 'Try the SMS Spam dataset.' }] } }] }]
  ];
  let k = 0;
  const streamClient = { chats: { create: o => { prompt = o.config.systemInstruction; return {
    sendMessageStream: async () => chunks(streamed[k++]), getHistory: () => [] }; } } };
  const r3 = await agent.run({ model: 'm', project, files: [], history: [], message: 'teach me', mode: 'teach',
    tools: { search_web: async () => ({ ok: true }) }, client: streamClient, onText: t => seen.push(t) });
  assert.ok(prompt.includes('MODE: TEACH ME'));
  assert.deepStrictEqual(seen, ['Step 1: ', 'Step 1: get data.', 'Step 1: get data.\n\nTry the SMS Spam dataset.']);
  assert.strictEqual(r3.text, 'Step 1: get data.\n\nTry the SMS Spam dataset.');
  assert.ok(!r3.text.includes('thinking'));
  console.log('all agent checks passed');
})().catch(e => { console.error(e); process.exit(1); });
