# Wortweg

**Learn German vocabulary in context.** Each session gives you 5 words in a quiz, then a short story that uses all of them, which you translate. An AI writes a fresh story every time and reviews your translation; without an AI key the app still works fully offline using built-in sentence templates.

- **5 words → 1 story → your translation → feedback.** Words are picked by a small spaced-repetition scheduler: unknown words come back after a few sessions, known ones rarely.
- **Four levels (A1–B2).** Grammar in the story grows with the level: present tense at A1, Perfekt at A2, subordinate clauses and zu-infinitives at B1, Konjunktiv II at B2.
- **Both directions.** The translation step alternates between German → English and English → German.
- **Learns your weak spots.** The AI tags your mistakes (verb position, cases, separable verbs …) and the next stories practise exactly those.
- **Articles mode.** Every noun you know is drilled for der/die/das; nouns you miss come back more often.
- **Guess mode.** Guess the article from the noun's ending and learn the rule behind it (‑ung → die, ‑chen → das …).
- **Read-aloud** with your system's German voice, adjustable speed.
- **Grows by itself.** When a theme runs low on new words, the AI adds more; every generated word passes the same validator as the built-in ones.
- **Private by design.** Runs on your computer. Your API key never reaches the browser and progress is stored in a local folder.

446 built-in words across 20 everyday themes (daily routine, shopping, work, health, travel …), each with a level, an example sentence and an English translation.

## Quick start

You need [Node.js](https://nodejs.org) 18 or newer. There are no dependencies to install.

```bash
git clone https://github.com/<you>/wortweg.git
cd wortweg
npm start            # then open http://localhost:4173
```

On Windows you can also double-click **`Wortweg.cmd`**: it starts the server in the background and opens your browser. The server stops by itself 15 minutes after you close the page.

### Turn on the AI (optional, free)

1. Get a free Gemini API key at <https://aistudio.google.com/apikey>.
2. Copy `.env.example` to `.env` and set `GEMINI_API_KEY=...`.
3. Restart. The pill in the top-right corner shows the active model.

Any OpenAI-compatible API (OpenAI, OpenRouter, Groq, a local Ollama or LM Studio …) works too; see [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## How a session works

1. **Pick a level.** The next session is prepared in the background, so starting is instant.
2. **Quiz.** Five German words, four English options each (or "I don't know").
3. **Translate.** A 5–7 sentence story that uses all five words, in German or English.
4. **Review.** A score, corrections, a natural reference translation and the grammar topics to watch. Progress is saved, and the next story focuses on what went wrong.

## Project structure

```
app/                 the web app (plain HTML/CSS/JS, installable as a PWA)
  data/vocabulary.js   built-in words and themes
  js/                  engine (sentences), session (word selection), validate,
                       mistakes, articles, app (UI)
server/              Node server: static files, profile storage, AI proxy
  ai.mjs               providers, prompts, fallback models and key rotation
  vocab-expand.mjs     AI-generated vocabulary
  goethe.mjs           optional Goethe-Institut word lists
tests/               offline checks (npm test) and live AI checks
windows/             one-file Windows installer (IExpress)
data/                your local data, never committed: progress, AI log
```

## Tests

```bash
npm test               # offline: vocabulary, 3,200 generated lessons, scheduler simulation, levels, articles
npm run test:ai        # live: lesson variety and review quality (uses your API quota)
npm run test:vocab-ai  # live: AI-generated words pass validation
npm run history        # analyse your own usage log
```

## Your data

Progress lives in `data/profiles/env-<id>/` (one folder per computer and install path): `progress.json`, `vocab-extra.json` (words the AI added) and `ai-log.jsonl`. Delete the folder to start over. When the app is served without the Node server (e.g. static hosting), progress is kept in the browser's localStorage instead.

## License

[MIT](LICENSE)
