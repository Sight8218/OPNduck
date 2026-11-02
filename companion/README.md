# OPNduck companion app (Android)

A remote control for OPNduck on your computer or on an OPNduck Server. It sends links (also from Android's share menu),
shows the queue, and downloads finished files to the phone. All work happens on the computer. Why Capacitor: see
`docs/plans/companion-framework.md`.

```sh
npm install
npm run dev          # the screens in a browser (secrets go to localStorage there)
npm run sync         # build the web part and copy it into android/
```

Building the APK needs the Android SDK and JDK 21 (Gradle 8 does not run on newer JDKs):

```sh
export ANDROID_HOME=/path/to/android-sdk JAVA_HOME=/path/to/jdk-21
echo "sdk.dir=$ANDROID_HOME" > android/local.properties
npm run apk          # android/app/build/outputs/apk/debug/app-debug.apk
```

Pairing links: a QR from OPNduck Settings (Servers, Share this PC's engine) or `opnduck-server pair`. Plain http is only
accepted for this phone itself and Tailscale addresses; anything else must be https.

The only native code is `android/app/src/main/java/dev/opnduck/companion/OpnduckNative.java`: secrets under an Android
Keystore key, the share-menu text, and downloads through the system DownloadManager. No Google services anywhere.
