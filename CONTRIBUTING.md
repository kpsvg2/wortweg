# Contributing

Thanks for helping! Wortweg has no build step and no runtime dependencies, so getting started is just:

```bash
git clone https://github.com/kpsvg2/wortweg.git
cd wortweg
npm start
npm test
```

Please run `npm test` before opening a pull request; CI runs the same checks.

## Adding words

Words live in [`app/data/vocabulary.js`](app/data/vocabulary.js). Each entry is split into the pieces the sentence engine needs; the format is described in [docs/VOCABULARY.md](docs/VOCABULARY.md). The quickest way is to copy a similar word from the same theme and adapt it.

`npm test` then checks the entry (conjugation matches the subject, the word appears in its own sentence, separable prefixes and auxiliaries are consistent …) and builds thousands of lessons with it. If a check fails, the message names the word and the problem.

## Adding a theme

Add an object with `id`, an English `name`, `pres` and `past` opening lines (`[German, English]`) and at least 8 words. The AI will tag Goethe list words and generate new words for it automatically.

## Adding an AI provider

Most providers speak the OpenAI API: add a preset to `PROVIDERS` in [`server/providers.mjs`](server/providers.mjs) with its base URL and key variable, and add a row to the tables in the README and [docs/CONFIGURATION.md](docs/CONFIGURATION.md). A provider with its own API needs a call function next to `callGemini` / `callAnthropic` that returns `{ text, usage }` and throws `AiError` (retryable for 429/5xx).

## Code style

Plain modern JavaScript, two-space indentation, single quotes. Keep comments short and only where the code doesn't explain itself. UI text and docs are in English.

## Reporting bugs

Open an issue with what you did, what you expected and what happened. For AI problems, the server log line (`[ai] … ERROR: …`) helps a lot; please remove any API keys before pasting.
