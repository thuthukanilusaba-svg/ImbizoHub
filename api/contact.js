// api/contact.js
//
// Receives submissions from https://imbizohub.com/contact
//
// Order of operations is deliberate: SAVE FIRST, THEN EMAIL.
// If the mail server is unreachable or the password has changed, the
// message is already safely in Supabase and can be recovered. An
// email-only form drops it silently and the sender assumes they were
// ignored — the worst possible failure for a contact form on a
// marketplace that is asking strangers to trust it.
//
// Writes go through two SECURITY DEFINER functions, not the table:
//   submit_contact_message(...) -> uuid
//   mark_contact_email(id, sent, error)
//
// The anon role has NO direct privilege on contact_messages at all. That
// is deliberate and was forced by a real constraint: INSERT ... RETURNING
// and UPDATE ... WHERE both require SELECT privilege, and granting anon
// SELECT would expose every submitter's name, email, phone and message to
// anyone holding the public anon key. The functions run as the owner, so
// they can return the new id without any of that being readable.
//
// The anon key is used rather than the service role. It is already public
// in the shipped app, and with only these two grants the worst case if it
// leaked is junk submissions, not a data breach.
//
// Email goes out over SMTP through Namecheap Private Email — the same
// mailbox that receives it. Chosen over a service like Resend because
// the mailbox already exists with working credentials: no second signup,
// no DKIM records to add at Namecheap, and no risk of ending up with two
// SPF records on imbizohub.com, which is invalid and would break the
// existing mail.
//
// REQUIRED environment variables in Vercel (Settings -> Environment
// Variables). The form still works without them — messages are stored
// and readable in Supabase — but nothing will be sent:
//   SMTP_USER          support@imbizohub.com
//   SMTP_PASS          that mailbox's password
//   CONTACT_TO_EMAIL   where queries should land
// Optional, only if Namecheap ever changes their servers:
//   SMTP_HOST          defaults to mail.privateemail.com
//   SMTP_PORT          defaults to 465 (implicit TLS)

const crypto = require('crypto');
const nodemailer = require('nodemailer');

const SUPABASE_URL = 'https://goughfxpcwxwsfthlmii.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvdWdoZnhwY3d4d3NmdGhsbWlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NDA5MjEsImV4cCI6MjA5ODExNjkyMX0.g4UiWuOJQrr4mPwe8xLrntna_xcCl7gOgFH2jlJn1AI';

const MAX = { name: 120, email: 200, phone: 40, topic: 60, message: 5000 };
const TOPICS = ['General question', 'Problem with the app', 'Seller / operator help', 'Payments', 'Report abuse', 'Business enquiry'];

function esc(s = '') {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Intentionally permissive. Over-strict email regexes reject real
// addresses; the point here is to catch obvious rubbish, not to
// adjudicate RFC 5322.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function hashIp(ip) {
  if (!ip) return null;
  // Salted so the stored value cannot be reversed to an IP by rainbow
  // table. Rotates if the key changes, which is acceptable — it only
  // exists for short-window rate limiting.
  const salt = process.env.SMTP_PASS || 'imbizohub-contact';
  return crypto.createHash('sha256').update(String(ip) + salt).digest('hex').slice(0, 32);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { name, email, phone, topic, message, website, started } = body;

    // ── Spam checks, in increasing order of cost ──
    //
    // 1. Honeypot. `website` is hidden from real users by CSS; bots that
    //    fill every field give themselves away. Respond 200 so the bot
    //    believes it succeeded and does not retry with a variation.
    if (website) return res.status(200).json({ ok: true });

    // 2. Time-to-complete. A human cannot read the form and type a real
    //    message in under three seconds.
    const elapsed = Number(started) ? Date.now() - Number(started) : null;
    if (elapsed !== null && elapsed < 3000) {
      return res.status(200).json({ ok: true });
    }

    // ── Validation ──
    const clean = {
      name: String(name || '').trim().slice(0, MAX.name),
      email: String(email || '').trim().toLowerCase().slice(0, MAX.email),
      phone: String(phone || '').trim().slice(0, MAX.phone) || null,
      topic: TOPICS.includes(topic) ? topic : 'General question',
      message: String(message || '').trim().slice(0, MAX.message),
    };

    if (!clean.name) return res.status(400).json({ ok: false, error: 'Please enter your name.' });
    if (!EMAIL_RE.test(clean.email)) return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
    if (clean.message.length < 10) return res.status(400).json({ ok: false, error: 'Please write a little more so we can help properly.' });

    const ip =
      (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      req.headers['x-real-ip'] || null;

    // ── 1. Save. This must succeed. ──
    const insert = await fetch(`${SUPABASE_URL}/rest/v1/rpc/submit_contact_message`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_name: clean.name,
        p_email: clean.email,
        p_phone: clean.phone,
        p_topic: clean.topic,
        p_message: clean.message,
        p_ip_hash: hashIp(ip),
        p_user_agent: String(req.headers['user-agent'] || '').slice(0, 400),
      }),
    });

    if (!insert.ok) {
      const detail = await insert.text();
      console.error('contact: submit_contact_message failed', insert.status, detail);
      return res.status(500).json({
        ok: false,
        error: 'We could not save your message. Please try again, or email us directly.',
      });
    }

    // The RPC returns the new row's uuid as a bare JSON string.
    const messageId = await insert.json();

    // ── 2. Email. Best effort — a failure here must not lose the message. ──
    const SMTP_USER = process.env.SMTP_USER;
    const SMTP_PASS = process.env.SMTP_PASS;
    const TO = process.env.CONTACT_TO_EMAIL || SMTP_USER;
    const HOST = process.env.SMTP_HOST || 'mail.privateemail.com';
    const PORT = Number(process.env.SMTP_PORT || 465);

    if (!SMTP_USER || !SMTP_PASS || !TO) {
      console.warn('contact: SMTP not configured — message saved only', {
        hasUser: !!SMTP_USER, hasPass: !!SMTP_PASS, hasTo: !!TO,
      });
      return res.status(200).json({ ok: true });
    }

    try {
      const html = `
        <div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.6">
          <h2 style="margin:0 0 4px">New enquiry from imbizohub.com</h2>
          <p style="margin:0 0 18px;color:#666">${esc(clean.topic)}</p>
          <table cellpadding="0" cellspacing="0" style="border-collapse:collapse">
            <tr><td style="padding:4px 16px 4px 0;color:#666">Name</td><td><strong>${esc(clean.name)}</strong></td></tr>
            <tr><td style="padding:4px 16px 4px 0;color:#666">Email</td><td><a href="mailto:${esc(clean.email)}">${esc(clean.email)}</a></td></tr>
            ${clean.phone ? `<tr><td style="padding:4px 16px 4px 0;color:#666">Phone</td><td>${esc(clean.phone)}</td></tr>` : ''}
          </table>
          <div style="margin:20px 0;padding:16px;background:#f6f6f4;border-radius:8px;white-space:pre-wrap">${esc(clean.message)}</div>
          <p style="color:#999;font-size:12px">Saved as ${esc(messageId)}</p>
        </div>`;

      const transport = nodemailer.createTransport({
        host: HOST,
        port: PORT,
        // 465 is implicit TLS; 587 upgrades via STARTTLS.
        secure: PORT === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
        // Serverless functions are short-lived, so fail fast rather than
        // holding the request open while someone waits on a spinner.
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
      });

      let smtpError = null;
      try {
        await transport.sendMail({
          // MUST be the authenticated mailbox — Private Email rejects a
          // From address it does not own. The enquirer's address goes in
          // replyTo, so hitting Reply answers them rather than yourself.
          from: `"ImbizoHub" <${SMTP_USER}>`,
          to: TO,
          replyTo: `"${clean.name}" <${clean.email}>`,
          subject: `[ImbizoHub] ${clean.topic} — ${clean.name}`,
          html,
          // Plain-text alternative: some clients prefer it, and it keeps
          // the message readable if HTML is stripped.
          text:
            'New enquiry from imbizohub.com\n\n' +
            `Topic: ${clean.topic}\n` +
            `Name:  ${clean.name}\n` +
            `Email: ${clean.email}\n` +
            (clean.phone ? `Phone: ${clean.phone}\n` : '') +
            `\n${clean.message}\n`,
        });
      } catch (e) {
        smtpError = `smtp: ${(e && e.message ? e.message : String(e)).slice(0, 300)}`;
      }

      // Record the delivery outcome so that after an outage you can find
      // exactly which messages never reached you:
      //   select * from contact_messages where email_sent = false;
      const errText = smtpError;
      if (errText) console.error('contact: smtp send failed', errText);

      await fetch(`${SUPABASE_URL}/rest/v1/rpc/mark_contact_email`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ p_id: messageId, p_sent: errText === null, p_error: errText }),
      }).catch(() => {});
    } catch (mailErr) {
      // Swallowed on purpose. The message is saved; the sender should
      // not see an error because our mail provider had a bad minute.
      console.error('contact: email threw', mailErr && mailErr.message);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('contact: unhandled', err);
    return res.status(500).json({ ok: false, error: 'Something went wrong. Please try again.' });
  }
};
