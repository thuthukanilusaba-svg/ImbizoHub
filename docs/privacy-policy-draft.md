# ImbizoHub — Privacy Policy (revised draft)

**Status: draft for review. Not legal advice.**
Every statement below was written against the live database schema and application
code rather than from a template, so it describes what ImbizoHub actually does today.
Items needing a decision from you or your consultants are marked **[TO CONFIRM]**.

*Prepared 24 August 2026. Replaces the version last updated 15 July 2026.*

---

## What changed from the previous version, and why

Read this section first — it is for you, not for users, and should be deleted before publishing.

### Removed: things the previous policy claimed that the app does not do

| Previous claim | Reality |
|---|---|
| "your approximate or precise location" | There is no location permission and no `expo-location` dependency anywhere in the app. No GPS or device location is ever read. The only location data is a town a user types or picks from a list. |
| "device type, operating system, app usage patterns, and crash reports" | No analytics or crash-reporting SDK is installed — no Sentry, Firebase, Amplitude or equivalent. None of this is collected. |
| Sharing with providers for "analytics, crash reporting" | No such providers exist. |

This matters beyond tidiness: Google Play's Data Safety declaration must match both
the policy and actual behaviour. Declaring location collection that does not happen
invites questions with no good answer, and tells users they are tracked more than
they are.

### Added: things the app does that the previous policy never mentioned

Identity documents, private messages between users, photographs, ratings and reviews,
push notification tokens, contact-form submissions, vehicle details including licence
plates, and Google sign-in. Identity documents are the most significant of these — it
is the category that attracts the most scrutiny in any regime, and the previous policy
was silent on it.

### Also changed

- Scope now covers the **website and web app**, not only the mobile application.
- A **retention** section now exists, pointing at the published retention policy.
- The **Test/Beta** clause is removed — it told users their transactions might not be real.
- Placeholders added for the **data controller's** legal identity.

---

# Privacy Policy

**Last updated: [TO CONFIRM — date of publication]**

This policy explains what information ImbizoHub collects, why, who it is shared with, and
what you can do about it. It covers the ImbizoHub mobile app, the website at
imbizohub.com, and the web version of the app.

## 1. Who we are

ImbizoHub is operated by **[TO CONFIRM — registered legal entity name]**, of
**[TO CONFIRM — registered address]**, Zimbabwe. We are the data controller for the
information described here.

For any question about your data, contact **support@imbizohub.com**, or use the
contact form at imbizohub.com/contact.

## 2. What we collect

### Information you give us

**Creating an account.** Your name, phone number and email address. If you sign in with
Google, we receive your name and email address from Google — we never see your Google
password.

**Your profile.** The town or city you enter, and a profile photograph if you upload one.

**Listings and wanted posts.** Titles, descriptions, prices, categories, the town an item
is in, and any photographs you attach.

**Messages.** Messages you send to other users through the app. These are stored so both
of you can read the conversation. We do not read them routinely, but they are not
end-to-end encrypted — we can access them if required for a fraud or abuse investigation,
or by law.

**Ratings and reviews.** The score and any written review you leave for someone.

**Transport and delivery.** For a trip: pickup and destination, the towns, the date, and
the number of passengers. For a delivery: the towns, a description of the parcel, and a
photograph of the parcel at dispatch.

**If you register as an operator.** Vehicle type, passenger capacity, licence plate,
the city you work from, and a referee's details for delivery operators.

**Identity documents.** If you apply to become a verified seller or a verified operator,
we collect a photograph of your national identity document, and for delivery operators an
affidavit. These are used once, to confirm you are who you say you are.

**The contact form.** Your name, email, phone number if you give one, and your message.
We also record your browser's user-agent string and a **one-way salted hash** of your IP
address — not the address itself — to limit automated abuse of the form.

### Information created by using the service

**Transactions.** Amounts, dates, references and status for platform fees and
registrations. Payments are processed by Paynow, including EcoCash. **We never see or
store your mobile money PIN, card number, or payment credentials.**

**Notification tokens.** If you allow notifications, a token that lets us send them to
your device. It identifies the installation, not you personally.

### What we do not collect

We want to be specific, because many apps do collect these and we do not:

- **No device or GPS location.** The app never requests location permission. Any location
  we hold is a town you typed or chose from a list.
- **No analytics or tracking.** There is no analytics SDK, no crash-reporting service, no
  advertising identifier, and no third-party tracking of any kind.
- **No advertising.** We do not serve ads and do not share data with advertisers.

## 3. Why we use it

- To create and run your account
- To show your listings, wanted posts and quotes to other users
- To let you and another user reach each other once a transaction is under way
- To process platform fees and registrations, and to calculate commission
- To confirm identity where verification is requested
- To send you messages about your account, your transactions and your bookings
- To investigate fraud, abuse and safety reports, and to enforce our terms
- To keep the service working and to fix faults

**[TO CONFIRM]** Your consultants should map each of these to a lawful basis under
Zimbabwe's Cyber and Data Protection Act. Most fall under performance of a contract or
legitimate interest; identity documents are likely to need their own treatment.

## 4. Who we share it with

**We do not sell your personal information, and we never have.**

**Other users, when a transaction requires it.** This is the main sharing that happens,
and it is deliberate:

- When a buyer unlocks a chat, the seller learns someone is interested
- When you accept a transport quote, you see that operator's name and phone number, and
  they see yours
- When you book a delivery, the operator sees the pickup and drop-off towns and the parcel
  description
- Your name, town, rating and reviews are visible on your public profile

**Service providers who operate the platform for us:**

| Provider | What they handle |
|---|---|
| Supabase | Database, accounts and file storage |
| Vercel | Website and web app hosting |
| Paynow (including EcoCash) | Payment processing |
| Expo | Delivering push notifications |
| Namecheap Private Email | Delivering contact form messages to our inbox |
| Google | Sign-in, only if you choose it |

**[TO CONFIRM]** Some of these providers store data outside Zimbabwe. Your consultants
should confirm what the Cyber and Data Protection Act requires for cross-border transfers,
and whether a transfer clause is needed here.

**Authorities**, where the law requires it, or where we need to establish or defend a
legal claim. This includes reporting a data breach to POTRAZ where we are obliged to.

## 5. How long we keep it

Each type of information has its own retention period, tied to why it exists, and each one
is enforced by an automated job rather than left to memory. Identity documents are deleted
a year after approval, or ninety days after rejection. Payment records are kept for five
years because financial regulation requires it.

The full schedule is published at **imbizohub.com/data-retention**.

## 6. Your rights

You may ask us to:

- Give you a copy of the information we hold about you
- Correct anything that is wrong
- Delete your account and your personal information
- Explain how your information is being used

**Deleting your account.** You can do this yourself in the app, under your profile. Your
details are anonymised immediately and fully removed within thirty days. Two things
survive, both deliberately: reviews you left for other people stay visible with your name
removed, so the people who relied on them are not misled; and payment records are kept for
the period financial regulation requires.

To make any other request, email **support@imbizohub.com**.

**[TO CONFIRM]** Whether the Act sets a statutory response deadline, and whether a
complaint route to POTRAZ should be stated here.

## 7. Security

Access to your information is restricted at the database level, so one user cannot read
another's messages, contact details or documents. Contact form submissions cannot be read
using the app's public key at all. IP addresses are stored only as a salted one-way hash.
Payment credentials never reach our systems.

No electronic system is completely secure and we cannot promise absolute safety. We
maintain a record of security incidents, including whether each was reported to POTRAZ and
whether affected users were notified.

## 8. Children

ImbizoHub is not for use by anyone under 18, and we do not knowingly collect information
from children. If you believe a child has given us information, contact us and we will
remove it.

## 9. Changes

We may update this policy. If a change is significant we will say so in the app as well as
updating the date at the top.

## 10. Contact

**Email:** support@imbizohub.com
**Web:** imbizohub.com/contact

---

## Notes for your consultants

Points that need a decision rather than a description:

1. **Legal entity and address** — sections 1 and 4 need the registered name and address.
2. **Lawful basis** for each purpose in section 3, in the Act's terms.
3. **Cross-border transfer** — Supabase, Vercel, Expo and Paynow are the providers to
   assess.
4. **POTRAZ controller registration** — whether it applies at this stage.
5. **Identity documents** — whether they need a distinct basis, a separate consent, or
   additional safeguards beyond the one-year deletion already in force.
6. **Response deadline and complaint route** for section 6.
7. **Territory** — whether ImbizoHub will be offered to users in the EU/EEA. If Play
   distribution is limited to Zimbabwe and the region, GDPR is unlikely to apply and no
   GDPR-specific wording is needed. If distribution is worldwide, that changes.

Two things worth knowing when reviewing:

- Sharing contact details between users (section 4) is the most consequential disclosure
  the platform makes, and it is the core of how the product works.
- Identity documents are the highest-risk category held. They are already deleted a year
  after approval and ninety days after rejection, automatically.
