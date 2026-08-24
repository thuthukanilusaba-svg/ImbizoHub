# ImbizoHub — Closing the Monitoring Gap

**Draft plan. Nothing here is built yet.**
*Prepared 24 August 2026 · companion to the Technical & Systems Overview, section 8.3*

---

## The gap, stated precisely

Nothing watches ImbizoHub on your behalf. Faults are discovered when a person
complains, and only the faults a person can *see*.

On 20 August three things were failing and had been for some time:

| What was broken | What it returned | Who would ever have noticed |
|---|---|---|
| "Mark as sold" never delivered its notice to buyers who had paid to unlock that chat | HTTP 500 | Nobody — it was called by a database trigger with no one watching |
| Meet & Pay push notifications not sending | **HTTP 200** | Nobody — you cannot report a message you never knew was coming |
| Rating notifications not sending | **HTTP 200** | Nobody, same reason |

Two of the three reported success while doing nothing. Only one had a symptom a user
could see, and that is the only one that got reported.

**The lesson is in the 200s.** Monitoring is not mainly about crashes and outages —
those get reported quickly because people notice. It is about the failures that are
silent, and those are the ones that quietly erode trust in a marketplace.

---

## The important thing first: most of this needs no third party

The instinct is to reach for Sentry, accept the privacy cost, and move on. That is not
necessary. **Every one of the three failures above was server-side and already fully
recorded in Supabase's own logs.** Nothing needed to be sent to anyone.

The plan below is in four tiers. Three of them cost nothing in privacy, add no supplier
to the processor register, and require no change to the privacy policy. Only tier 4
does, and it is last for that reason.

---

## Tier 1 — Android vitals (already yours, just unused)

**Effort: none. Cost: none. Privacy cost: none.**

Google Play Console already collects crash and ANR reports for your Android app.
No SDK, no code, no additional processor — Google is already your distributor, and this
is data they gather as part of that.

- Play Console → Quality → Android vitals
- Crash rate, ANR rate, and stack traces per version

**Action:** look at it after each release. That is the whole task. It closes most of the
"app crashed on someone's phone" blindness for free.

---

## Tier 2 — A log watcher you own

**Effort: roughly half a day. Cost: none. Privacy cost: none.**

This is the tier that would have caught all three of August's failures.

Supabase already records every edge function error and every failed request. The gap is
that nothing reads those logs unless a person goes looking. A scheduled job can do the
looking.

**Shape of it:**

- A new edge function, `check-health`, on a `pg_cron` schedule — hourly is plenty
- It queries the logs for the previous hour: any function returning 5xx, and any log line
  at `error` level
- It also runs a small number of sanity checks that catch *silent* failure — the class the
  HTTP 200s belong to. For example:
  - any `meetpay_sessions` row confirmed by both sides in the last hour where no
    notification was logged
  - any `contact_messages` row with `email_sent = false` older than fifteen minutes
  - any `payment_intents` row stuck at `pending` for over an hour
- If anything is found, it emails **support@imbizohub.com** through the SMTP setup the
  contact form already uses
- If nothing is found, it sends nothing — a quiet inbox means a working system

**Why this is the highest-value tier.** It uses infrastructure you already run, sends no
user data anywhere, and the sanity checks catch the failures that report success — which
is exactly what nothing else on this list does.

The one design rule that matters: **alert on things a user would care about, not on every
error line.** An alert that fires constantly is one you learn to ignore, and then it is
worse than no alert.

---

## Tier 3 — Uptime checks

**Effort: about an hour. Cost: free tier is sufficient. Privacy cost: none.**

An outside service that requests a few URLs every few minutes and emails you if one stops
answering. It sends no user data — it is not a user, it is a robot fetching a page.

Worth watching:

- `https://imbizohub.com` — the landing site
- `https://imbizohub.com/app` — the web application
- `https://imbizohub.com/contact` — proves the serverless functions are alive
- One Supabase edge function — proves the backend is reachable

UptimeRobot, Better Stack and similar all have free tiers that cover this. **No processor
agreement is needed, because no personal data is involved.**

This catches the loud failures — the site being down — which the log watcher, running
inside the thing that is down, cannot report.

---

## Tier 4 — Application error tracking (the one with a cost)

**Effort: a day. Cost: free tier likely sufficient at first. Privacy cost: real.**

Everything above watches the server. None of it sees a JavaScript error inside the app on
someone's phone — a screen that fails to render, a button that throws. For that you need
something running inside the app, reporting outward. Sentry is the usual choice.

**What it would change, honestly:**

- A new processor on the supplier list, holding device and session data
- The privacy policy's "no analytics, no crash reporting, no third-party tracking" line
  would have to change. That line is currently true and unusual, and it is worth something.
- Play Data Safety would need updating to declare crash data collection

**Recommendation: do not do this yet.** Tiers 1–3 cover the failures you have actually
experienced, at no privacy cost. Revisit tier 4 when there are enough real users that
silent client-side breakage is costing you more than the privacy position is worth.
If you do adopt it, turn off session replay and personally identifiable context — most of
the privacy objection comes from those, not from the stack traces.

---

## Suggested order

| Step | Tier | Effort | Privacy cost | Why this order |
|---|---|---|---|---|
| 1 | Android vitals | None | None | Already collected; just start looking |
| 2 | Uptime checks | ~1 hour | None | Fastest real coverage per hour spent |
| 3 | Log watcher | ~half a day | None | Highest value; catches the silent failures |
| 4 | Error tracking | ~1 day | Real | Only when user numbers justify it |

Tiers 1–3 together would have caught every fault found on 20 August, and would have caught
them weeks earlier.

---

## What "done" looks like

Not a dashboard someone has to remember to check. The test is simpler:

> If something breaks tonight, does anyone find out before a user complains?

Today the answer is no. After tiers 1–3 it is yes for anything server-side, which is where
every fault so far has been.

---

## Decisions taken

- **Alerts go to `support@imbizohub.com`** for now, moving to a dedicated address later.
  Worth revisiting once alert volume is known — the risk of the shared inbox is not
  clutter but the reverse: an alert scrolling past between customer enquiries.
- **Hourly checks, email only on failure.** No "all clear" digest to begin with. If the
  silence feels uncomfortable in the first weeks, a daily digest can be added — it is a
  few lines, and easier to justify once there is a sense of how often anything fires.
- **Programmers act on alerts.** With a caveat that shapes the design — see below.

---

## Designing for "the programmers are not there"

This was raised as a concern and it is the right one. An alerting system that assumes
someone technical is always reachable will fail on the evening nobody is. Three
consequences for how this gets built:

**1. Write alerts for whoever opens the inbox, not for a developer.**

The email should lead with what a user is experiencing, in plain language, and put the
technical detail underneath. Something like:

> **Contact form messages are not being emailed.**
> 3 messages since 14:00 are saved but undelivered. Nothing is lost — they are in the
> database and will send once this is fixed.
> *Technical: SMTP auth failure, `mark_contact_email` recording error 535.*

Someone non-technical can act on that: they know it is not lost, and they can tell an
enquirer "we have your message". A stack trace tells them nothing and they will wait for
help that may be hours away.

**2. Say how urgent it is, because most alerts are not.**

Of the three faults on 20 August, none needed action within the hour — notifications not
sending is bad over days, harmless over an evening. Something like payments stuck pending
is genuinely urgent. If every alert reads the same, an unavailable programmer means every
alert waits equally, including the one that should not have.

Two levels is enough:

- **Act now** — money is affected, or the platform is unreachable
- **Act soon** — something is silently not working, but nothing is lost and nobody is
  charged incorrectly

**3. Reduce the number of alerts that need a human at all.**

The best answer to "nobody is available" is fewer alerts that require availability.
Anything transient — a mail server having a bad minute, a push notification service
briefly unreachable — should be retried automatically before it ever becomes an email.
Alert only when the retries have failed, because that is when a person is genuinely
needed.

This is worth building in from the start. Retrofitting retries onto an alerting system
that has trained people to ignore it is much harder than getting it right first.

---

## Remaining open question

- **Escalation.** If an "act now" alert is not acknowledged within some window, does
  anything happen? Today the answer is no, and that may be acceptable at current scale.
  Worth deciding deliberately rather than discovering it during the first real incident.
