# Play Store Release

This app is packaged for Android with Capacitor.

## App Identity

- App name: `VaronEnglish`
- Package name: `com.varoonenglish.app`
- Release artifact: `android/app/build/outputs/bundle/release/app-release.aab`

## One-Time Upload Key Setup

Create a Play upload key. Keep the `.jks` file and passwords private.

```bash
keytool -genkeypair \
  -v \
  -keystore android/app/varonenglish-upload-key.jks \
  -alias varonenglish-upload \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

Then copy the template and fill in the real passwords:

```bash
cp android/app/keystore.properties.example android/app/keystore.properties
```

`android/app/keystore.properties` and keystore files are ignored by git.

You can also sign via environment variables instead of a properties file:

```bash
export ANDROID_KEYSTORE_PATH=android/app/varonenglish-upload-key.jks
export ANDROID_KEYSTORE_PASSWORD='your-password'
export ANDROID_KEY_ALIAS=varonenglish-upload
export ANDROID_KEY_PASSWORD='your-password'
```

## Build The Play Store Bundle

```bash
npm run mobile:aab
```

Verify signing:

```bash
jarsigner -verify -verbose -certs android/app/build/outputs/bundle/release/app-release.aab
```

## Play Console Checklist

1. Create the app in Google Play Console.
2. Use package name `com.varoonenglish.app`.
3. Enable Play App Signing when prompted.
4. Upload `android/app/build/outputs/bundle/release/app-release.aab`.
5. Complete store listing: app name, short/long description, screenshots, feature graphic, category, contact email, privacy policy URL.
6. Complete app content forms: data safety, ads, content rating, target audience, financial/payment declarations if applicable.
7. Release first to internal testing, then closed/open testing, then production.

For every future release, increase `versionCode` in `android/app/build.gradle`.
