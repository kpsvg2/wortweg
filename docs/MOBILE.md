# Android app

`mobile/` turns Wortweg into an Android app. The phone runs the same code as the computer: the web app from `app/` and the server from `server/`, unchanged. Lessons, reviews, AI-added words, the Goethe lists (if installed), EN/TR and the ⚙ settings all work the same.

## How it works

- [Capacitor](https://capacitorjs.com) wraps `app/` in an Android WebView.
- `build.mjs` bundles `server/server.mjs` with [esbuild](https://esbuild.github.io) into the page. Small stand-ins in `mobile/shims/` replace the Node built-ins it uses: files are read from the bundle and written to the app's localStorage, and the page's `/api/` requests go to the bundled server instead of the network.
- Your `.env` (and `data/goethe/`, if present) is bundled at build time, so the app starts with your AI settings. Changes made in ⚙ on the phone are stored on the phone.
- Android's WebView has no `speechSynthesis`, so `entry.js` provides one backed by the phone's text-to-speech engine. The read-aloud button appears when a German voice is installed (Settings → Text-to-speech on the phone).

## Build

You need Node.js 18+, the Android SDK (platform 36, build-tools, platform-tools) and JDK 21. `build.mjs` expects the JDK in `~/Android/jdk-21*` and the SDK in `~/Android/sdk` (or wherever `ANDROID_HOME` points).

```bash
cd mobile
npm install
npm run build        # only the web bundle in mobile/www/ (open it with any static server to test)
npm run apk          # web bundle + Android project + debug APK -> Desktop/Wortweg.apk
```

The first `npm run apk` downloads Gradle and takes several minutes; later builds take seconds. Installing a new APK over the old one keeps the progress.

## Notes

- **Your keys are inside the APK.** Don't share it. `mobile/www/` and `mobile/android/` are generated and never committed.
- Progress on the phone is separate from the computer's.
- The phone keeps the last 300 lines of `ai-log.jsonl`, since localStorage is limited to about 5 MB.
- Only Android. iPhones can't install apps from a file.
