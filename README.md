# Vyuha

A project-aware browser built with Electron.

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

2. Install the dependencies (Electron, Monaco editor, Google Gen AI SDK):

   ```bash
   npm install
   ```

3. Start the app:

   ```bash
   npm start
   ```

   The first launch downloads the Electron binary (~100 MB), so it can take a minute. After that the Vyuha window opens.

### Optional: Gemini API key

To use the Gemini assistant, get a key from [Google AI Studio](https://aistudio.google.com), then in the app open **Settings → Preferences**, paste the key and click **Save and test**. You can also set the `GEMINI_API_KEY` environment variable. The rest of the app works without a key.

### Optional: run the tests

```bash
npm test
```
