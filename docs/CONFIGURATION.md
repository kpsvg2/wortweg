# Configuration

All settings are environment variables. The server also reads a `.env` file in the project root (real environment variables take precedence). Start from [`.env.example`](../.env.example).

## AI provider

Without any AI settings Wortweg runs in **offline mode**: stories come from built-in templates and translations are checked by looking for the target words.

### Google Gemini (default)

| Variable | Default | Description |
|---|---|---|
| `GEMINI_API_KEY` | — | Key from <https://aistudio.google.com/apikey> |
| `GEMINI_API_KEYS` | — | Extra comma-separated keys. Free-tier quota is per Google Cloud project, so each key should come from a different project. The main model is tried with every key before falling back. |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Main model |
| `GEMINI_FALLBACK_MODELS` | `gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash` | Tried in order when a model is rate-limited (429) or overloaded (5xx) |
| `GEMINI_THINKING` | `low` | Thinking level; `default` uses the model's own setting |

The free tier allows only a few requests per minute per model, which is why the fallback chain exists. A rate-limited model/key pair cools down for the delay Gemini reports; an overloaded model cools down for two minutes. `npm run test:ai -- --models` lists the models your key can use.

### OpenAI-compatible APIs

| Variable | Example |
|---|---|
| `AI_PROVIDER` | `openai` |
| `AI_BASE_URL` | `https://api.openai.com/v1`, `https://openrouter.ai/api/v1`, `http://localhost:11434/v1` (Ollama) |
| `AI_API_KEY` | your key (any non-empty value for local servers) |
| `AI_MODEL` | the model name |

The model must support JSON output (`response_format: json_object`).

## Server

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4173` | |
| `HOST` | `127.0.0.1` | `0.0.0.0` makes the app reachable from other devices on your network |
| `IDLE_MINUTES` | `15` | Stop after this many minutes without requests; `0` keeps it running |

## Using it on your phone

Start the server with `HOST=0.0.0.0` and open `http://<your-computer's-IP>:4173` on a phone in the same Wi-Fi. The app can be installed to the home screen (PWA). Note that anyone on your network can then generate lessons with your key.

## Windows installer

`windows/build.ps1` packs the project into `windows/dist/Wortweg-Setup.exe`. The installer copies Wortweg to `%LOCALAPPDATA%\Programs\Wortweg`, downloads a portable Node.js if none is installed (verified by SHA-256), keeps existing progress on update and creates a desktop shortcut.

Your `.env` is **not** included unless you pass `-IncludeKeys`. A build made with `-IncludeKeys` contains your API key: only give it to people you trust and never publish it.
