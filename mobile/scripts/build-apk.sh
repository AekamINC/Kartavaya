#!/usr/bin/env bash
#
# Build an installable Kartavaya APK, from this machine, without EAS.
#
# ── WHY THIS SCRIPT EXISTS ──────────────────────────────────────────────────
#
# Three things about this build are non-obvious, and every one of them cost a
# failed attempt before it was written down:
#
#  1. `android/` is `expo prebuild` OUTPUT and is gitignored, so any fix applied
#     inside it is one `--clean` away from being erased. The memory setting in
#     step 3 is therefore re-applied here every time rather than committed.
#
#  2. A RELEASE build needs far more metaspace than a debug one. The Expo
#     template ships `-Xmx2048m -XX:MaxMetaspaceSize=512m`; a debug build fits
#     and a release build does not, because R8 and the Hermes bundle load far
#     more classes at once. It fails as
#         java.lang.OutOfMemoryError: Metaspace
#         Gradle build daemon disappeared unexpectedly
#     which reads like a crash rather than a limit, and sends you looking in the
#     wrong place.
#
#  3. DEBUG IS NOT THE ONE TO HAND ANYBODY. A debug APK has no JS bundle inside
#     it — it fetches from a Metro server on your laptop — so on someone else's
#     phone it installs and then sits there. It is also 175 MB against 66 MB,
#     because debug keeps all four ABIs including the two only an emulator uses.
#     Release embeds the bundle and runs standalone.
#
# Signing: the Expo template signs RELEASE with the DEBUG keystore. That is fine
# for handing round internally and is what makes this installable at all, but it
# is NOT a store-ready artefact — Play needs a real upload key.
#
# Usage:  bash mobile/scripts/build-apk.sh [debug|release]

set -euo pipefail

VARIANT="${1:-release}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

# Android Studio's bundled JDK, so this does not depend on a system java.
export JAVA_HOME="${JAVA_HOME:-/c/Program Files/Android/Android Studio/jbr}"
export ANDROID_HOME="${ANDROID_HOME:-$LOCALAPPDATA/Android/Sdk}"
export PATH="$JAVA_HOME/bin:$PATH"

echo "==> prebuild (picks up app.json, native deps and assets/*.png)"
# --clean, always. Prebuild over an existing android/ is documented by Expo as
# best-effort layering, and this machine's android/ has been caught holding a
# pre-fix manifest (CHECK_ON_LAUNCH=ALWAYS, versionCode 8) after app.json had
# moved on — an APK built from that ships the exact bug the config change
# removed. The gradle.properties edit below is re-applied every run precisely
# so that wiping android/ costs nothing (see note 1).
npx expo prebuild --platform android --clean

echo "==> raising the Gradle daemon ceiling (see note 2)"
sed -i 's|^org.gradle.jvmargs=.*|org.gradle.jvmargs=-Xmx6144m -XX:MaxMetaspaceSize=2048m -XX:+HeapDumpOnOutOfMemoryError -Dfile.encoding=UTF-8|' android/gradle.properties

# Only the two ABIs a real phone uses. x86/x86_64 are emulator-only and roughly
# double the file.
ARCHS="arm64-v8a,armeabi-v7a"

echo "==> assemble${VARIANT^}"
( cd android && ./gradlew "assemble${VARIANT^}" -PreactNativeArchitectures="$ARCHS" )

APK="android/app/build/outputs/apk/$VARIANT/app-$VARIANT.apk"
OUT="../build/Kartavaya-$(node -p "require('./app.json').expo.version")-$VARIANT.apk"
mkdir -p ../build && cp "$APK" "$OUT"

echo "==> verifying the signature — an unsigned APK will not install"
#
# Two things this got wrong on every build so far, both silent-ish:
#
#   1. `build-tools/*/apksigner.bat` GLOBS. With more than one build-tools
#      version installed it expanded to several paths, so the second became the
#      subcommand and apksigner answered "Unsupported command: <path>". The
#      build looked like it had failed verification when it had never run one.
#      Newest version only, and quoted.
#   2. apksigner.bat is a WINDOWS batch file and cannot read the POSIX
#      `/c/Program Files/...` JAVA_HOME that Git Bash needs. It has to be handed
#      a native path, which is what `cygpath -w` is for.
#
# Both are why the verify line printed an error under a BUILD SUCCESSFUL and was
# ignored. A check nobody can read is not a check.
APKSIGNER="$(ls -d "$ANDROID_HOME"/build-tools/*/apksigner.bat 2>/dev/null | sort -V | tail -1)"
if [ -z "$APKSIGNER" ]; then
  echo "!! no apksigner found under $ANDROID_HOME/build-tools — NOT verified" >&2
  exit 1
fi
JAVA_HOME="$(cygpath -w "$JAVA_HOME")" "$APKSIGNER" verify -v "$OUT" | head -5

ls -la "$OUT"
