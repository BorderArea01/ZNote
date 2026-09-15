#!/usr/bin/env bash
set -euo pipefail
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
export ANDROID_AVD_HOME="$RUNNER_TEMP/znote-avd"
mkdir -p "$ANDROID_AVD_HOME" artifacts/android-emulator
echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' | sudo tee /etc/udev/rules.d/99-kvm4all.rules >/dev/null
sudo udevadm control --reload-rules
sudo udevadm trigger --name-match=kvm
sdkmanager 'platform-tools' 'emulator' 'system-images;android-35;google_apis;x86_64' >/dev/null
echo no | avdmanager create avd --name znote-test --package 'system-images;android-35;google_apis;x86_64' --device pixel_2 --force >/dev/null
"$ANDROID_HOME/emulator/emulator" -avd znote-test -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect -memory 2048 > artifacts/android-emulator/emulator.log 2>&1 &
EMULATOR_PID=$!
DATA_DIR="$RUNNER_TEMP/znote-android-data" PORT=3742 HOST=0.0.0.0 node server/index.js > artifacts/android-emulator/server.log 2>&1 &
SERVER_PID=$!
trap 'kill "$EMULATOR_PID" "$SERVER_PID" 2>/dev/null || true' EXIT
export ANDROID_SERIAL=emulator-5554
timeout 240 bash -c 'until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d "\r")" = "1" ]; do sleep 2; done'
adb shell input keyevent 82
adb install clients/android/app/build/outputs/apk/debug/app-debug.apk
adb install clients/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
for fixture in clients/android/capturefixture/build/outputs/apk/*/debug/*.apk; do adb install "$fixture"; done
timeout 240 adb shell am instrument -w io.github.borderarea01.znote.test/io.github.borderarea01.znote.SmokeRunner | tee artifacts/android-emulator/result.txt
adb pull /sdcard/Android/data/io.github.borderarea01.znote/files/client-smoke.png artifacts/android-emulator/ || true
adb pull /sdcard/Android/data/io.github.borderarea01.znote/files/capture-overlay.png artifacts/android-emulator/ || true
adb pull /sdcard/Android/data/io.github.borderarea01.znote/files/capture-panel.png artifacts/android-emulator/ || true
adb pull /sdcard/Android/data/io.github.borderarea01.znote/files/capture-settings.png artifacts/android-emulator/ || true
adb logcat -d -v threadtime -s ZNoteCapture:I AndroidRuntime:E > artifacts/android-emulator/capture-log.txt
grep -q ZNOTE_ANDROID_SMOKE_PASS artifacts/android-emulator/result.txt

# Exercise a real in-app self update after the normal client smoke test. The
# debug-signed next-version fixture remains local to this disposable emulator.
(cd clients/android && bash gradlew --no-daemon -I ../../tests/android-update-fixture.gradle :app:assembleDebug)
cp clients/android/app/build/outputs/apk/debug/app-debug.apk artifacts/update-fixture.apk
AAPT=$(find "$ANDROID_HOME/build-tools" -name aapt -type f | sort -V | tail -n 1)
"$AAPT" dump badging artifacts/update-fixture.apk > artifacts/update-fixture-badging.txt
EXPECTED_UPDATE_CODE=$(sed -n "s/.*versionCode='\([0-9]*\)'.*/\1/p" artifacts/update-fixture-badging.txt | head -n 1)
node tests/android-update-fixture.mjs > artifacts/android-emulator/update-server.log 2>&1 &
UPDATE_PID=$!
trap 'kill "$EMULATOR_PID" "$SERVER_PID" "$UPDATE_PID" 2>/dev/null || true' EXIT
# A successful self-update terminates instrumentation as Android replaces the app.
timeout 100 adb shell am instrument -w -e update_upgrade true io.github.borderarea01.znote.test/io.github.borderarea01.znote.SmokeRunner > artifacts/android-emulator/update-result.txt 2>&1 || true
adb pull /sdcard/Android/data/io.github.borderarea01.znote/files/update-screen.png artifacts/android-emulator/ || true
adb logcat -d -v threadtime > artifacts/android-emulator/update-log.txt
adb shell uiautomator dump /sdcard/update-ui.xml >/dev/null 2>&1 || true
adb pull /sdcard/update-ui.xml artifacts/android-emulator/ || true
grep -q ZNOTE_UPDATE_INSTALL_CONFIRM artifacts/android-emulator/update-result.txt
for attempt in $(seq 1 20); do
  adb shell dumpsys package io.github.borderarea01.znote > artifacts/android-emulator/updated-package.txt
  grep -q "versionCode=$EXPECTED_UPDATE_CODE" artifacts/android-emulator/updated-package.txt && break
  sleep 1
done
grep -q "versionCode=$EXPECTED_UPDATE_CODE" artifacts/android-emulator/updated-package.txt
adb shell run-as io.github.borderarea01.znote cat shared_prefs/MainActivity.xml > artifacts/android-emulator/updated-preferences.xml
grep -q 'preserved' artifacts/android-emulator/updated-preferences.xml
grep -q '10.0.2.2:3742' artifacts/android-emulator/updated-preferences.xml
echo ZNOTE_ANDROID_UPDATE_PASS >> artifacts/android-emulator/update-result.txt
