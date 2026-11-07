// Decides where a prompt typed in the Vyuha search bar should go,
// and whether it belongs to one of your projects.
// Rule-based for now; later this can be replaced by an LLM call.

const enc = encodeURIComponent;

const ROUTES = [
  { key: 'youtube', name: 'YouTube', match: /\b(youtube|videos?|lectures?|playlists?)\b/i,
    url: q => `https://www.youtube.com/results?search_query=${enc(q)}` },
  { key: 'hf', name: 'Hugging Face Datasets', match: /\b(datasets?|corpus|corpora)\b/i,
    url: q => `https://huggingface.co/datasets?search=${enc(q)}` },
  { key: 'github', name: 'GitHub', match: /\b(github|repos?|repository|repositories)\b/i,
    url: q => `https://github.com/search?q=${enc(q)}&type=repositories` },
  { key: 'so', name: 'Stack Overflow', match: /\b(error|exception|traceback|stack ?overflow|not working)\b/i, keep: true,
    url: q => `https://stackoverflow.com/search?q=${enc(q)}` },
  { key: 'arxiv', name: 'arXiv', match: /\b(papers?|arxiv|preprints?)\b/i,
    url: q => `https://arxiv.org/search/?query=${enc(q)}&searchtype=all` },
  { key: 'maps', name: 'Google Maps', match: /\b(near me|directions|maps?|nearby)\b/i, keep: true,
    url: q => `https://www.google.com/maps/search/${enc(q)}` },
  { key: 'news', name: 'Google News', match: /\b(news|headlines)\b/i,
    url: q => `https://news.google.com/search?q=${enc(q)}` },
  { key: 'wiki', name: 'Wikipedia', match: /\b(wikipedia|wiki|who (is|was)|what (is|are|was)|history of)\b/i,
    url: q => `https://en.wikipedia.org/w/index.php?search=${enc(q)}` },
  { key: 'shop', name: 'Amazon', match: /\b(buy|cheapest|price of|shop for)\b/i,
    url: q => `https://www.amazon.co.uk/s?k=${enc(q)}` }
];
const GOOGLE = { key: 'google', name: 'Google', url: q => `https://www.google.com/search?q=${enc(q)}` };

// Questions that are about a project rather than the web go to the project's agent.
const AGENT_INTENT = /\b(why|decid|decision|status|where are we|where is|progress|phase|what'?s next|next step)\b/i;

function route(text) {
  for (const r of ROUTES) {
    const m = text.match(r.match);
    if (m) return { r, kw: m[0] };
  }
  return { r: GOOGLE, kw: null };
}

// "give me youtube videos for learning python" -> "learning python"
function cleanQuery(text, r) {
  let q = ' ' + text + ' ';
  q = q.replace(/\b(please|can you|could you|give me|show me|find me|find|search for|search|look up|look for|open|i want|i need|get me|some|a few|any)\b/gi, ' ');
  if (!r.keep && r.match) q = q.replace(new RegExp(r.match.source, 'gi'), ' ');
  q = q.replace(/[?!.]+/g, ' ').replace(/\s+/g, ' ').trim();
  q = q.replace(/^((for|on|about|of|to|from|in|a|an|the)\s+)+/i, '').replace(/\s+(on|from|in|for)$/i, '');
  return q || text.trim();
}

// A prompt belongs to a project only if it names one of the project's keywords.
function detectProject(text, projects) {
  const low = text.toLowerCase();
  for (const p of projects)
    for (const k of (p.keywords || []))
      if (k && low.includes(k.toLowerCase())) return { pid: p.id, why: `the prompt mentions "${k}"` };
  return null;
}

function looksLikeUrl(s) {
  s = s.trim();
  if (/^(https?|file):\/\//i.test(s)) return true;
  if (LOCAL_HOST.test(s)) return true;   // localhost:8000, 127.0.0.1:5000/path
  return !/\s/.test(s) && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(s);
}
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/\S*)?$/i;
// local dev servers speak plain http
const toUrl = s => {
  s = s.trim();
  if (/^(https?|file):\/\//i.test(s)) return s;
  return (LOCAL_HOST.test(s) ? 'http://' : 'https://') + s;
};
// pages on your own computer are never filed as sources
const isLocal = url => {
  try { const u = new URL(url); return u.protocol === 'file:' || /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i.test(u.hostname); }
  catch (e) { return false; }
};

// Data files and well-known dataset hosts
const DATA_FILE = /\.(csv|tsv|zip|gz|tgz|parquet|jsonl|xlsx?|arff|feather|npz|h5)(\?|$)/i;
function isDataUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (DATA_FILE.test(u.pathname)) return true;
    if ((host === 'huggingface.co' || host === 'kaggle.com') && u.pathname.startsWith('/datasets')) return true;
    if (/(^|\.)data\.gov(\.uk)?$/.test(host) || host === 'archive.ics.uci.edu' || host === 'data.world') return true;
    if (host === 'openml.org' && /^\/(d|search)/.test(u.pathname)) return true;
    if (host === 'zenodo.org' && u.pathname.startsWith('/record')) return true;
    if (host === 'paperswithcode.com' && u.pathname.startsWith('/dataset')) return true;
    if (host === 'tensorflow.org' && u.pathname.includes('/datasets/catalog')) return true;
    if (host === 'github.com' && /\/datasets?\b/i.test(u.pathname)) return true;
    return false;
  } catch (e) { return false; }
}
// github.com/<owner>/<repo>, but not GitHub's own pages (search, topics, settings…)
const GH_RESERVED = new Set(['search', 'topics', 'explore', 'settings', 'marketplace', 'features', 'orgs', 'about', 'pricing', 'login', 'sponsors', 'collections', 'trending']);
function isRepoUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname.replace(/^www\./, '') !== 'github.com') return false;
    const parts = u.pathname.split('/').filter(Boolean);
    return parts.length >= 2 && !GH_RESERVED.has(parts[0]);
  } catch (e) { return false; }
}
// A page title that names a dataset ("SMS Spam Collection Dataset", "… Data Set", "… corpus")
const looksLikeDataset = title => /\b(data ?sets?|corpus|corpora)\b/i.test(String(title || ''));

// Which folder a visited page is filed under.
function classify(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (isDataUrl(url)) return 'dataset';
    if (isRepoUrl(url)) return 'repo';
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be') return 'video';
  } catch (e) { /* not a URL */ }
  return 'research';
}

module.exports = { ROUTES, GOOGLE, AGENT_INTENT, route, cleanQuery, detectProject, looksLikeUrl, toUrl, isLocal, classify, isDataUrl, isRepoUrl, looksLikeDataset };
