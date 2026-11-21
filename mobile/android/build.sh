#!/usr/bin/env bash
# Builds mobile/android/build/Raven.apk without the Android SDK.
# Needs: Java 17+ (javac), Go 1.24+, curl. Downloads two jars from Maven Central once.
# The signing key lives in mobile/android/signing/ (kept out of git). Keep a copy
# somewhere safe: every update of the app must be signed with the same key.
set -euo pipefail
cd "$(dirname "$0")"
CACHE="${RAVEN_ANDROID_CACHE:-$HOME/.cache/raven-android}"
KEY="${RAVEN_ANDROID_KEY:-signing/raven-android.pem}"
mkdir -p "$CACHE" build signing

fetch() { # url file
  [ -s "$CACHE/$2" ] || curl -fsSL "$1" -o "$CACHE/$2"
}
# Android 4.1 API stubs to compile against (newer calls are made by reflection)
fetch https://repo1.maven.org/maven2/com/google/android/android/4.1.1.4/android-4.1.1.4.jar android.jar
# dx, the Java-to-Dalvik compiler (AOSP, repackaged on Maven Central)
fetch https://repo1.maven.org/maven2/com/jakewharton/android/repackaged/dalvik-dx/14.0.0_r21/dalvik-dx-14.0.0_r21.jar dx.jar

rm -rf build/classes && mkdir -p build/classes
javac -nowarn -Xlint:-options -source 8 -target 8 -encoding UTF-8 \
  -bootclasspath "$CACHE/android.jar" -d build/classes $(find app/src -name '*.java')
java -cp "$CACHE/dx.jar" com.android.dx.command.Main --dex --min-sdk-version=21 \
  --output=build/classes.dex build/classes
KEYABS="$(realpath -m "$KEY")"
(cd apkbuild && go run . -manifest ../app/AndroidManifest.xml -dex ../build/classes.dex \
  -icon ../app/icon.png -key "$KEYABS" -out ../build/Raven.apk)
