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
timeout 120 adb shell am instrument -w io.github.borderarea01.znote.test/io.github.borderarea01.znote.SmokeRunner | tee artifacts/android-emulator/result.txt
adb pull /sdcard/Android/data/io.github.borderarea01.znote/files/client-smoke.png artifacts/android-emulator/ || true
grep -q ZNOTE_ANDROID_SMOKE_PASS artifacts/android-emulator/result.txt
