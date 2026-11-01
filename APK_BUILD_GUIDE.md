# Android APK Build Guide — OneNote Clone (PWA + Capacitor)

This project is a Vite + React + TypeScript PWA. It can be installed directly
from the browser, or wrapped into a native **Android APK** with
[Capacitor](https://capacitorjs.com/). The web bundle in `dist/` becomes the
assets folder of an Android Studio project that you compile locally or in CI.

---

## 1. Prerequisites

| Tool     | Version          | Check with        |
| -------- | ---------------- | ----------------- |
| Node.js  | ≥ 18             | `node --version`  |
| JDK      | 17               | `java -version`   |
| Android SDK (via Android Studio) | latest | `sdkmanager --list` |
| Gradle   | bundled by Capacitor's Android project | — |

Install Android Studio from <https://developer.android.com/studio> and let it
download the default SDK + emulator images.

---

## 2. Verify the PWA shell

The PWA metadata already ships with this repo:

- `public/manifest.json` — app name, icons (`/icons/icon-192.png`,
  `/icons/icon-512.png`), `theme_color: #681498`, `background_color: #f3f2f1`,
  `display: standalone`, shortcuts.
- `index.html` — links the manifest, sets `<meta name="theme-color">`,
  favicons, and iOS/Android standalone meta tags.

Build and serve the production bundle to confirm installability:

```bash
npm ci
npm run build       # type-checks (tsc -b) and bundles to dist/
npm run preview     # http://localhost:4173 — Chrome DevTools > Application > Manifest
```

In Chrome on Android you should now see **“Install app”** in the address bar.
That covers pure PWA installation without any native packaging.

---

## 3. Wrap the app with Capacitor

From the repository root:

```bash
# 1. Add Capacitor to the project
npm install @capacitor/core @capacitor/cli
npm install @capacitor/android

# 2. Initialize — answer the prompts with:
#    App name:      OneNote Clone
#    App ID:        com.example.onenoteclone
#    Web asset dir: dist
npx cap init

# 3. Produce the web bundle (Capacitor copies dist/ into the native project)
npm run build

# 4. Add the Android platform
npx cap add android

# 5. Sync web assets + plugin state into the generated Android project
npx cap sync android

# 6. Open the project in Android Studio
npx cap open android
```

### Handy follow-ups

```bash
npx cap run android        # build + deploy to a connected device/emulator
npx cap copy android       # re-copy dist/ after changes
npx cap live-reload        # dev-time hot reload against vite dev server
```

---

## 4. Build the APK in Android Studio

1. Wait for Gradle sync to finish.
2. **Build ▸ Build Bundle(s) / APK(s) ▸ Build APK(s)**.
   Output: `android/app/build/outputs/apk/debug/app-debug.apk`.
3. For a Play-Store artifact use **Build ▸ Generate Signed Bundle / APK**,
   create/upload a keystore, and choose **APK → release**.

Or skip the IDE entirely:

```bash
cd android
./gradlew assembleDebug                    # debug APK
./gradlew assembleRelease                  # release APK (needs signing config)
./gradlew bundleRelease                    # .aab for Google Play
```

---

## 5. Install on a device

```bash
adb devices
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

The app launches full-screen (standalone), uses the purple `#681498` theme
bar color from `manifest.json`, and stores notebooks in the WebView's local
storage exactly like the browser PWA.

---

## 6. Troubleshooting

- **`Web assembly folder (dist) does not exist`** → run `npm run build`
  before `npx cap sync`.
- **Blank white screen on launch** → ensure `webDir` in
  `capacitor.config.ts` points at `dist` (not `./dist/` subpaths) and rerun
  `npx cap sync android`.
- **Gradle JDK errors** → set Android Studio’s JDK to 17
  (**File ▸ Settings ▸ Build Tools ▸ Gradle**).
- **Manifest not applied inside the APK** → Capacitor reads icon/theme data
  from `android/app/src/main/res`; regenerate with
  `@capacitor/assets`: `npm i -D @capacitor/assets && npx capacitor-assets generate --android`.

---

## 7. CI note

The GitHub Actions workflow (`.github/workflows/main.yml`) validates the web
bundle (`tsc -b` + `vite build`). APK compilation requires the Android SDK,
which is done locally or in a self-hosted runner with the SDK preinstalled —
the same `dist/` artifact verified in CI is what Capacitor packages.
