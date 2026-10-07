# Optional: Goethe-Institut word lists

By default, when a theme runs low on new words, the AI suggests new ones freely for your level. If you add the official Goethe-Institut word lists, new A1–B1 words are instead **picked from those lists**, so the vocabulary you grow matches the exams (Start Deutsch 1, Goethe-Zertifikat A2, Zertifikat B1).

The lists are published by the Goethe-Institut as PDFs and are not part of this repository. To use them, extract the words yourself into `data/goethe/wordlist.json`:

```json
{
  "source": "Goethe-Institut word lists: Start Deutsch 1 (A1), Goethe-Zertifikat A2, Zertifikat B1",
  "levels": {
    "A1": ["der Abend", "aber", "abfahren", "..."],
    "A2": ["..."],
    "B1": ["..."]
  }
}
```

Each word should appear only at the first level it is listed in. Nouns keep their article (`der Bahnhof`, `der/die Angestellte`).

Then tag the list with themes (the AI decides which of the 20 themes each word belongs to; progress is saved after every batch, so you can stop and resume):

```bash
npm run goethe:tags
```

The server also tags a few batches on every start until the list is done. Tags are stored in `data/goethe/tags.json`.
