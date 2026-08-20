// api/contact.js
//
// Receives submissions from https://imbizohub.com/contact
//
// Order of operations is deliberate: SAVE FIRST, THEN EMAIL.
// If Resend is down, out of quota, or the API key has expired, the
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
// REQUIRED environment variables in Vercel (Settings -> Environment
// Variables). The form still works without the email ones — messages
// are stored and can be read in Supabase — but nothing will be sent:
//   RESEND_API_KEY    from resend.com
//   CONTACT_TO_EMAIL  where queries should land
//   CONTACT_FROM_EMAIL  e.g. "ImbizoHub <hello@imbizohub.com>"
//                       must be on a domain verified in Resend

const crypto = require('crypto');

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
  const salt = process.env.RESEND_API_KEY || 'imbizohub-contact';
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
    const TO = process.env.CONTACT_TO_EMAIL;
    const FROM = process.env.CONTACT_FROM_EMAIL;
    const KEY = process.env.RESEND_API_KEY;

    if (!KEY || !TO || !FROM) {
      console.warn('contact: email not configured — message saved only', {
        hasKey: !!KEY, hasTo: !!TO, hasFrom: !!FROM,
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

      const sent = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM,
          to: [TO],
          // So you can hit Reply and answer the person directly, rather
          // than replying to your own sending address.
          reply_to: clean.email,
          subject: `[ImbizoHub] ${clean.topic} — ${clean.name}`,
          html,
        }),
      });

      // Record the delivery outcome so that after an outage you can find
      // exactly which messages never reached you:
      //   select * from contact_messages where email_sent = false;
      const errText = sent.ok ? null : `resend ${sent.status}: ${(await sent.text()).slice(0, 300)}`;
      if (errText) console.error('contact: resend failed', errText);

      await fetch(`${SUPABASE_URL}/rest/v1/rpc/mark_contact_email`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ p_id: messageId, p_sent: sent.ok, p_error: errText }),
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
