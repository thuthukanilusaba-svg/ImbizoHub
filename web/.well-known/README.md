# Domain verification — Android now, iOS later

These files let the OS open the ImbizoHub app directly when someone taps an
`https://imbizohub.com/seller...` link, instead of bouncing them to a browser.

**Current state: Android only.** There is no Apple Developer account yet, so
there is no iOS app and no `apple-app-site-association` file here. That is
deliberate — see the bottom of this file for exactly what to add when you do
get one.

The file must be served over HTTPS, with no redirect, from
`https://imbizohub.com/.well-known/assetlinks.json`. `vercel.json` already
handles the content type.

---

## `assetlinks.json` → replace `REPLACE_SHA256_FINGERPRINT`

The SHA-256 fingerprint of the certificate your Android app is **signed
with**. Colon-separated uppercase hex, roughly 95 characters (`AB:CD:EF:...`).

Get it with:

```bash
eas credentials --platform android
```

**The common trap:** if you use Google Play App Signing (the default for new
apps), Google re-signs your app with *their* key after you upload. The
fingerprint that matters is then the one in **Play Console → Your app → Setup
→ App signing → App signing key certificate**, NOT your local upload key.
Using the upload key is the single most common reason App Links silently fail.

If you are not sure which applies, list both. This is explicitly supported and
sidesteps the problem:

```json
"sha256_cert_fingerprints": [
  "<upload key SHA-256>",
  "<Play app signing key SHA-256>"
]
```

### Verifying after deploy

Google's official checker — paste this in a browser:

```
https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://imbizohub.com&relation=delegate_permission/common.handle_all_urls
```

A good response lists `com.imbizohub.app` with no `error_code`.

On a device with the app installed:

```bash
adb shell pm get-app-links com.imbizohub.app
```

should report `verified` for imbizohub.com.

---

## When you get an Apple Developer account

Two steps, in this order.

**1.** Create a file in this folder named exactly `apple-app-site-association`
— no file extension — containing:

```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "YOUR_TEAM_ID.com.imbizohub.app",
        "paths": [
          "/seller",
          "/seller/*"
        ]
      }
    ]
  }
}
```

Replace `YOUR_TEAM_ID` with your 10-character Apple Team ID (find it at
<https://developer.apple.com/account> under Membership). The bundle
identifier is already correct — it matches `ios.bundleIdentifier` in
`app.json`.

`vercel.json` already contains a header rule serving this exact path as
`application/json`. That rule matters: the file has no extension, so without
it the file is sent as a binary download and iOS rejects it silently.

**2.** In `supabase/functions/seller-preview/index.ts`, set `IOS_APP_LIVE` to
`true` and replace the placeholder in `APP_STORE_URL` with the real numeric
App Store id, then redeploy. Until then the preview page deliberately hides
the "Download for iPhone" button, because it would point at a URL that 404s.

`app.json` already declares `applinks:imbizohub.com` under
`ios.associatedDomains`, so no native config change is needed later — but
adding the AASA file does require a fresh iOS build to be verified.
