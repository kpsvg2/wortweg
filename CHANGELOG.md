# Changelog

## 1.0.0 — 2026-10-07

First public release.

- Study sessions: 5-word quiz, a short story using all five words, translation in alternating directions (German ↔ English) and a review with corrections.
- Offline sentence engine with level templates for A1–B2; works without any AI.
- AI stories and reviews with mistake tracking: the next stories focus on the grammar topics you got wrong.
- Spaced word selection: unknown words return within a few sessions, at most 3 reviews per session, no clustering of words missed together.
- 446 built-in words in 20 everyday themes, each with a CEFR level; the AI can extend every theme.
- Articles mode (der/die/das for the nouns you know) and Guess mode (article rules by noun ending).
- AI providers: Google Gemini, Anthropic Claude, OpenAI, OpenRouter, Groq, Mistral, DeepSeek, Ollama, LM Studio and any OpenAI-compatible API, with fallback models and key rotation; in-app settings screen with connection test.
- Read-aloud with the system's German voice and adjustable speed, dark mode, mobile layout, installable PWA.
- Local Node server with per-machine progress, idle shutdown and protection against cross-site requests; one-file Windows installer.
- Offline test suite (vocabulary, 3,200 generated lessons, scheduler simulation, server API) and CI.
