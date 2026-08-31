# Maestro UI tests

Automated checks that drive the real ImbizoHub app on a real phone or
emulator, so "does the new build actually work" stops being fifteen
minutes of careful tapping and becomes one command.

Written 31 August 2026, after a day in which three separate bugs were
found by hand that a flow would have caught in seconds.

---

## What this costs

Nothing. The Maestro CLI and Studio are open source and free, running on
your own device. The paid tier ($250 per concurrent device per month) is a
hosted device farm for parallel CI runs — with one app and one developer
you will never need it.

---

## Setup, once

1. **Java 17+.** Check with `java -version`. If missing, install
   Microsoft OpenJDK or Temurin.
2. **Maestro CLI.** Windows does **not** use the `curl | bash` installer
   from the docs' front page — that one is macOS and Linux only, and WSL
   is explicitly not recommended. On Windows it is a zip:

   - Download `maestro.zip` from
     https://github.com/mobile-dev-inc/maestro/releases/latest/download/maestro.zip
   - Extract it somewhere permanent, e.g. `C:\maestro`
   - Add it to PATH, then **restart the terminal**:
     ```powershell
     setx PATH "%PATH%;C:\maestro\bin"
     ```
   - Check with `maestro --help`

   `JAVA_HOME` must be set and pointing at Java 17+, not just `java` being
   on PATH — Maestro reads `JAVA_HOME` directly.
3. **A device.** Either an Android emulator from Android Studio, or your
   phone plugged in with USB debugging on. `adb devices` should list it.
4. **The app installed** — the production build, not Expo Go. The flows
   target `com.imbizohub.app`.

---

## Credentials

Passwords are **never** written into these files. They come from your
shell, and `maestro/` is committed to git, so anything you type into a
flow file is published.

Three accounts are needed. The operator must be a different account from
the customer: the database refuses a quote on your own trip
(`prevent_quoting_own_request`, added after a reputation-gaming hole was
found in August).

PowerShell, in the terminal you will run from:

```powershell
$env:MAESTRO_SELLER_EMAIL    = "you@example.com"
$env:MAESTRO_SELLER_PASSWORD = "..."
$env:MAESTRO_BUYER_EMAIL     = "test2@imbizohub.com"
$env:MAESTRO_BUYER_PASSWORD  = "..."
$env:MAESTRO_OPERATOR_EMAIL  = "operator@example.com"
$env:MAESTRO_OPERATOR_PASSWORD = "..."
```

These last only for that terminal window, which is the point.

---

## Running

One flow:

```powershell
maestro test maestro/flows/01-completed-deal.yaml
```

Everything, with a report:

```powershell
maestro test maestro/flows --format junit --output maestro-report.xml
```

That report is the useful part. It lands in the repo folder, and I can
read it directly through the desktop bridge — so instead of describing
what you saw, you run one command and I read the actual result.

Writing a new flow, or fixing a selector that has drifted:

```powershell
maestro studio
```

It opens your running app in a browser and generates the selector for
whatever you click, which beats guessing.

---

## The flows

| File | What it proves | Needs |
|---|---|---|
| `01-completed-deal.yaml` | A confirmed deal shows a receipt — not a live "Confirm sale" pill, not a Book delivery option, not an invitation to rate twice | An already-confirmed deal. Today: the 27 Aug "iPhone 15" wanted post |
| `02-unread-badge.yaml` | The badge appears for one *conversation* (not two messages) and clears when read | Nothing — it sends its own message first |
| `03a-post-trip.yaml` | A customer can post a van-hire trip | — |
| `03b-operator-quote.yaml` | An operator can bid on it | A registered transport operator account |
| `03c-accept-and-confirm.yaml` | Accept the quote, both sides confirm, rate the driver — and a second rating is refused honestly | 03a and 03b first |

Flow 03 is the one that matters most. As of 31 August the van-hire half of
ImbizoHub had **0 quotes, 0 registered operators, 0 bookings and 0 driver
ratings** — every guard in that path was untested code sitting in
production.

---

## Things that will trip you up

**`clearState` is deliberately not used anywhere.** Clearing app data also
clears the expo-updates cache, so the app falls back to the bundle
compiled into the APK and re-downloads the OTA update in the background.
Every test would then run against the *embedded* build rather than the
update you just published — the exact opposite of what these are for. The
flows sign out through the UI instead. Slower, correct.

**Two cold starts after `eas update`.** No `fallbackToCacheTimeout` is set
in `app.json`, so the app never waits for an update: it launches from
cache and downloads in the background. Launch one always runs the old
code. Force-quit fully, reopen, force-quit again, reopen — *then* run the
tests, or you will be testing yesterday's build and blaming today's code.

**The operator account must be registered by hand, once.** Profile →
"Become a Transport Operator" → pay the $10 yearly fee (free under the
launch promotion) → "Finish setup". Its base city must match the trip's
**pickup** city — `operator-requests.tsx` filters on exactly that, and
when it does not match the operator simply never sees the job, with no
error anywhere. The flows use Harare.

**Promo wording expires 31 January 2027.** `quotes.tsx` branches on
`isPromoActive()`, so "Accept — free (launch promo)" becomes
"Accept — pay $N platform fee" overnight. Flow 03c will fail on that date
and the failure will be the wording, not the app.

**Two selectors are guesses.** The travel-date field opens the platform's
own date picker and the city fields open a modal list — native UI that
could not be inspected when these were written. If `03a` fails at "Select
date" or a city name, open `maestro studio` and correct those steps. Every
other string in this suite was taken verbatim from the source.

**Fragile by design, and worth knowing where.** `login.tsx` renders the
heading and the button as the identical string "Sign in", so the subflow
taps `index: 1`. `rating.tsx` renders five identical `★` glyphs, so the
five-star tap is `index: 4`. Both would be better as testIDs on those
screens; `components/BottomNav.tsx` already got them on 31 August, which is
why every navigation step here uses `id:` rather than a label.

---

## What these tests cannot do

They cannot tell you a screen is *lying*. The rating bug found on
31 August — where the app displayed "Rating submitted!" for a rating the
database had refused, silently discarding what the person typed — passed
every assertion you could write about that screen, because the screen said
success. Catching that class of bug needs a check against the database,
not against the UI.

So treat a green run as "nothing obvious is broken", not as "it works".
