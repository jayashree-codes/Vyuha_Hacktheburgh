// Two sample projects written to disk the first time Vyuha starts.
module.exports = [
  {
    id: 'hello-world-site',
    keywords: ['hello-world', 'hello world site', 'hello world website'],
    summary: 'A one-page Hello World website, hosted free on GitHub Pages.',
    phases: ['1-planning', '2-build', '3-deploy'], phase: '3-deploy',
    phaseNotes: {
      '1-planning': 'Agreed the scope: one static page, no framework, free hosting.',
      '2-build': 'Wrote index.html and style.css, and pulled hello-world snippets from Rosetta Code.',
      '3-deploy': 'Validated the markup and published from the main branch with GitHub Pages.'
    },
    events: [
      { id: 'h1', type: 'research', title: 'MDN: Your first website', url: 'https://developer.mozilla.org/en-US/docs/Learn_web_development/Getting_started/Your_first_website', phase: '1-planning', tool: 'browser', query: 'how to build a first website', time: '2026-10-27 10:04', why: 'Outline for the whole build.', usedIn: ['index.html', 'style.css'], status: 'kept' },
      { id: 'h2', type: 'dataset', title: 'Rosetta Code: Hello world/Text', url: 'https://rosettacode.org/wiki/Hello_world/Text', phase: '2-build', tool: 'browser', query: 'hello world in many languages', time: '2026-10-28 14:12', why: 'Source of the hello-world snippets on the page.', usedIn: ['index.html'], status: 'kept' },
      { id: 'h3', type: 'video', title: 'YouTube: CSS flexbox tutorial', url: 'https://www.youtube.com/results?search_query=css%20flexbox%20tutorial', phase: '2-build', tool: 'browser', query: 'css flexbox tutorial', time: '2026-10-28 15:20', why: 'Watched to learn how to centre the card.', usedIn: ['style.css'], status: 'kept' },
      { id: 'h4', type: 'research', title: 'GitHub Docs: Creating a GitHub Pages site', url: 'https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site', phase: '3-deploy', tool: 'browser', query: 'host static site free github', time: '2026-11-04 09:55', why: 'Followed to publish the site.', usedIn: ['README.md'], status: 'kept' }
    ],
    decisions: [
      { title: 'Plain HTML and CSS, no framework', detail: 'It is one static page; a framework adds a build step and nothing else.', phase: '1-planning', time: '2026-10-27 10:30', sources: ['h1'] },
      { title: 'Host on GitHub Pages', detail: 'Free, and the repository is already on GitHub.', phase: '3-deploy', time: '2026-11-04 10:02', sources: ['h4'] }
    ],
    files: {
      'index.html': '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <title>Hello, World</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <main class="card">\n    <h1>Hello, World!</h1>\n    <p>My first website.</p>\n  </main>\n</body>\n</html>\n',
      'style.css': '/* centre the card with flexbox */\nbody {\n  min-height: 100vh;\n  margin: 0;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-family: system-ui, sans-serif;\n}\n',
      'README.md': '# hello-world-site\n\nOpen index.html in a browser.\nDeployed with GitHub Pages from main.\n'
    }
  },
  {
    id: 'sentiment-classifier',
    keywords: ['sentiment', 'classifier', 'imdb', 'sst-2'],
    summary: 'Classify reviews as positive or negative. TF-IDF baseline first, then a fine-tuned transformer.',
    phases: ['1-planning', '2-data', '3-modelling', '4-evaluation'], phase: '3-modelling',
    phaseNotes: {
      '1-planning': 'Framed as binary classification; baseline before anything deep.',
      '2-data': 'Compared public review datasets. Kept two, rejected one.',
      '3-modelling': 'Baseline written. Next: fine-tune DistilBERT.'
    },
    events: [
      { id: 's1', type: 'dataset', title: 'IMDb Large Movie Review Dataset', url: 'https://ai.stanford.edu/~amaas/data/sentiment/', phase: '2-data', tool: 'browser', query: 'labelled movie review sentiment dataset', time: '2026-10-31 09:48', why: 'Main training set: balanced, with a ready train/test split.', usedIn: ['train.py'], status: 'kept' },
      { id: 's2', type: 'dataset', title: 'SST-2 on Hugging Face', url: 'https://huggingface.co/datasets/stanfordnlp/sst2', phase: '2-data', tool: 'browser', query: 'sentence level sentiment benchmark', time: '2026-10-31 10:20', why: 'Second test set to check transfer to short text.', usedIn: [], status: 'kept' },
      { id: 's3', type: 'dataset', title: 'Yelp Review Full on Hugging Face', url: 'https://huggingface.co/datasets/Yelp/yelp_review_full', phase: '2-data', tool: 'browser', query: 'large review dataset', time: '2026-10-31 10:41', why: 'Rejected: five-star labels would need relabelling.', usedIn: [], status: 'rejected' },
      { id: 's4', type: 'research', title: 'Hugging Face: Text classification guide', url: 'https://huggingface.co/docs/transformers/tasks/sequence_classification', phase: '3-modelling', tool: 'browser', query: 'fine tune distilbert sentiment', time: '2026-11-06 12:30', why: 'Being followed for the fine-tuning step.', usedIn: ['train.py'], status: 'kept' }
    ],
    decisions: [
      { title: 'Baseline before a transformer', detail: 'A TF-IDF model trains in minutes and gives a number to beat.', phase: '1-planning', time: '2026-10-30 11:30', sources: [] },
      { title: 'Train on IMDb, test transfer on SST-2', detail: 'IMDb is large and balanced; SST-2 checks shorter text.', phase: '2-data', time: '2026-10-31 10:30', sources: ['s1', 's2'] }
    ],
    files: {
      'train.py': '# Baseline: TF-IDF features + logistic regression\nfrom sklearn.feature_extraction.text import TfidfVectorizer\nfrom sklearn.linear_model import LogisticRegression\n\nvec = TfidfVectorizer(ngram_range=(1, 2), min_df=2)\nclf = LogisticRegression(max_iter=1000)\n',
      'requirements.txt': 'scikit-learn\npandas\ntransformers\ndatasets\n'
    }
  }
];
