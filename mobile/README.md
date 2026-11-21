# Raven na telefonu

The phone version is for pupils; teachers keep the computer layout (on a phone they
get the desktop page, zoomed out). Everything runs from the same website,
https://raven-kristators-projects.vercel.app – the apps only open it.

| Platform | What it is | How pupils get it |
|---|---|---|
| Web (`.html`) | The site itself, with a phone layout and installable as a web app (PWA: `web/manifest.webmanifest`, `web/sw.js`) | open the address; download page: `/stahnout.html` |
| Android (`.apk`) | `mobile/android` – a small full-screen app around the site | `/download/Raven.apk` (linked from `/stahnout.html`) |
| iPhone | The web app added to the home screen (Safari → Sdílet → Přidat na plochu) | instructions on `/stahnout.html` |

## Signing in from the apps

Google does not allow its sign-in inside apps, so the Android app and the iPhone
home-screen app sign in through the phone's browser: the app shows a 4-letter code,
the browser opens Raven, the pupil signs in with Google there and types the code, and
the app logs itself in (`appauth.go`, `AppLogin` / `AppApprovePage` in `web/js/app.js`).

## Building the Android app

Needs Java 17+, Go 1.24+ and curl – no Android SDK (Google's download servers are not
reachable from every build machine). `mobile/android/build.sh` downloads the Android
API stubs and `dx` from Maven Central, compiles `app/src`, and `apkbuild` packs and
signs the APK (manifest encoding from golang.org/x/mobile, APK Signature Scheme v1 + v2,
target Android 14, minimum Android 5).

```bash
mobile/android/build.sh
```

```bash
cp mobile/android/build/Raven.apk web/download/Raven.apk
```

**Signing key:** updates must be signed with the same key as the first release, or
phones refuse to update (pupils would have to uninstall first). The key is not in git;
the build reads it from `mobile/android/signing/raven-android.pem` (or the path in
`RAVEN_ANDROID_KEY`). Keep a safe copy.

Raise `android:versionCode` in `mobile/android/app/AndroidManifest.xml` for every
release. The web address is in `MainActivity.java` (`BASE`).

## A native iPhone app

An App Store app needs a Mac with Xcode and an Apple Developer account (99 USD a year).
Until then the home-screen web app is the iPhone version.
