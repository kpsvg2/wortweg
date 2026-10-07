# Configuration

The easiest way to set up the AI is the **⚙ settings screen** in the app. It writes the same variables described here to the `.env` file in the project root, and the change takes effect immediately. You can also edit `.env` by hand (start from [`.env.example`](../.env.example)) and restart; real environment variables take precedence over `.env`.

Without any AI settings Wortweg runs in **offline mode**: stories come from built-in templates and translations are checked by looking for the target words.

## AI provider

| Variable | Description |
|---|---|
| `AI_PROVIDER` | `gemini`, `anthropic`, `openai`, `openrouter`, `groq`, `mistral`, `deepseek`, `ollama`, `lmstudio`, `custom`, or `none` (offline). If unset, the first provider with a key is used. |
| `AI_MODEL` | Main model. Gemini and Claude have defaults; the others need a model name (the settings screen's **Load list** button shows what your key can use). |
| `AI_FALLBACK_MODELS` | Comma-separated models tried in order when the main one is rate-limited (429) or overloaded (5xx). Set it to an empty value for none. |
| `AI_BASE_URL` | API address for `custom` (any OpenAI-compatible API), or to override a preset's address. |
| `AI_THINKING` | Gemini thinking level: `low` (default), `medium`, `high`, or `default` for the model's own setting. |

API keys are stored per provider, so switching providers never sends a key to the wrong service. Each variable may hold several comma-separated keys; they are rotated when one hits its rate limit.

| Provider | Key variable | Default model | Base URL |
|---|---|---|---|
| `gemini` | `GEMINI_API_KEY` | `gemini-3.8-flash` (+ 3 fallbacks) | — |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-5-5` (+ `claude-haiku-4-5-20251001`) | — |
| `openai` | `OPENAI_API_KEY` | — | `https://api.openai.com/v1` |
| `openrouter` | `OPENROUTER_API_KEY` | — | `https://openrouter.ai/api/v1` |
| `groq` | `GROQ_API_KEY` | — | `https://api.groq.com/openai/v1` |
| `mistral` | `MISTRAL_API_KEY` | — | `https://api.mistral.ai/v1` |
| `deepseek` | `DEEPSEEK_API_KEY` | — | `https://api.deepseek.com/v1` |
| `ollama` | none | — | `http://localhost:11434/v1` |
| `lmstudio` | none | — | `http://localhost:1234/v1` |
| `custom` | `CUSTOM_API_KEY` | — | `AI_BASE_URL` |

Older variable names still work: `GEMINI_API_KEYS`, `GOOGLE_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS`, `GEMINI_THINKING`, and `AI_API_KEY` for OpenAI-compatible APIs.

**How the answers are kept structured:** Gemini gets a JSON response schema, Claude a forced tool call with the same schema, and OpenAI-compatible APIs JSON mode (or plain JSON instructions for servers that don't support it). Every answer is validated anyway and retried on another model if it doesn't fit.

**Gemini free tier:** only a few requests per minute per model, which is why the fallback chain exists. Quota is per Google Cloud project, so extra keys only help if each comes from a different project. A rate-limited model/key pair cools down for the delay Gemini reports; an overloaded model for two minutes.

## Server

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4173` | |
| `HOST` | `127.0.0.1` | `0.0.0.0` makes the app reachable from other devices on your network |
| `IDLE_MINUTES` | `15` | Stop after this many minutes without requests; `0` keeps it running |
| `DATA_DIR` | `data` | Where profiles and logs are stored |
| `ENV_FILE` | `.env` | Settings file to read and write |

The settings screen only works from the computer running Wortweg (requests from other devices are refused), and the server rejects write requests from other websites.

## Using it on your phone

Start the server with `HOST=0.0.0.0` and open `http://<your-computer's-IP>:4173` on a phone in the same Wi-Fi. The app can be installed to the home screen (PWA). Anyone on your network can then generate lessons with your key.

## Windows installer

`windows/build.ps1` packs the project into `windows/dist/Wortweg-Setup.exe`. The installer copies Wortweg to `%LOCALAPPDATA%\Programs\Wortweg`, downloads a portable Node.js if none is installed (verified by SHA-256), keeps existing progress on update and creates a desktop shortcut. After installing, set up the AI with the ⚙ button.

Your `.env` is **not** included unless you pass `-IncludeKeys`. A build made with `-IncludeKeys` contains your API key: only give it to people you trust and never publish it.
