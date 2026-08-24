// api/contact-retry.js
//
// Re-sends contact form messages whose email failed the first time.
//
// WHY THIS EXISTS:
// api/contact.js deliberately saves first and emails second, so a mail
// failure never loses a message. But nothing ever tried again — the row
// sat with email_sent = false until a person noticed. Most SMTP failures
// are transient (a timeout, a brief outage, a rate limit), and a fault
// that fixes itself in ten minutes should never reach a human at all.
//
// Called every 15 minutes by a scheduled job, and only when there is
// something to send. The database selects what to retry and posts it
// here; this endpoint holds no database credentials for reading, exactly
// as api/health-alert.js does. Marking a message sent goes back through
// the same mark_contact_email RPC api/contact.js already uses, which
// only ever sets flags on an id it is given.
//
// The retry window is 24 hours, enforced in pending_contact_emails().
// After that the health check reports it instead — a message still
// failing after a day is not transient, and a job that retries forever
// hides that behind the appearance of activity.
//
// REQUIRED environment variables in Vercel:
//   HEALTH_ALERT_SECRET   shared with the scheduled job (same one the
//                         health alert uses — one secret, one rotation)
//   SMTP_USER, SMTP_PASS, CONTACT_TO_EMAIL   already set for the form

const nodemailer = require('nodemailer');

const SUPABASE_URL = 'https://goughfxpcwxwsfthlmii.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvdWdoZnhwY3d4d3NmdGhsbWlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NDA5MjEsImV4cCI6MjA5ODExNjkyMX0.g4UiWuOJQrr4mPwe8xLrntna_xcCl7gOgFH2jlJn1AI';

function esc(s = '') {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function markSent(id, sent, error) {
  await fetch(`${SUPABASE_URL}/rest/v1/rpc/mark_contact_email`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_id: id, p_sent: sent, p_error: error }),
  }).catch(() => {});
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const expected = process.env.HEALTH_ALERT_SECRET;
  if (!expected) return res.status(500).json({ ok: false, error: 'Not configured' });
  if (req.headers['x-health-secret'] !== expected) return res.status(401).json({ ok: false });

  let pending;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    pending = Array.isArray(body) ? body : body.pending;
  } catch {
    return res.status(400).json({ ok: false, error: 'Bad body' });
  }
  if (!Array.isArray(pending) || pending.length === 0) {
    return res.status(200).json({ ok: true, retried: 0 });
  }

  const SMTP_USER = process.env.SMTP_USER;
  const SMTP_PASS = process.env.SMTP_PASS;
  const TO = process.env.CONTACT_TO_EMAIL || SMTP_USER;
  const HOST = process.env.SMTP_HOST || 'mail.privateemail.com';
  const PORT = Number(process.env.SMTP_PORT || 465);

  if (!SMTP_USER || !SMTP_PASS || !TO) {
    console.error('contact-retry: SMTP not configured');
    return res.status(500).json({ ok: false, error: 'SMTP not configured' });
  }

  // One connection reused for the whole batch rather than one per message.
  // A retry batch exists because the mail server was already unhappy;
  // opening twenty connections at it is not the way to be welcomed back.
  const transport = nodemailer.createTransport({
    host: HOST, port: PORT, secure: PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    pool: true, maxConnections: 1,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
  });

  let ok = 0;
  let failed = 0;

  for (const m of pending) {
    const html = `
      <div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.6">
        <h2 style="margin:0 0 4px">New enquiry from imbizohub.com</h2>
        <p style="margin:0 0 6px;color:#666">${esc(m.topic)}</p>
        <p style="margin:0 0 18px;color:#B8860B;font-size:13px">
          Delivered on retry — the first attempt failed.
        </p>
        <table cellpadding="0" cellspacing="0" style="border-collapse:collapse">
          <tr><td style="padding:4px 16px 4px 0;color:#666">Name</td><td><strong>${esc(m.name)}</strong></td></tr>
          <tr><td style="padding:4px 16px 4px 0;color:#666">Email</td><td><a href="mailto:${esc(m.email)}">${esc(m.email)}</a></td></tr>
          ${m.phone ? `<tr><td style="padding:4px 16px 4px 0;color:#666">Phone</td><td>${esc(m.phone)}</td></tr>` : ''}
        </table>
        <div style="margin:20px 0;padding:16px;background:#f6f6f4;border-radius:8px;white-space:pre-wrap">${esc(m.message)}</div>
        <p style="color:#999;font-size:12px">Saved as ${esc(m.id)}</p>
      </div>`;

    try {
      await transport.sendMail({
        from: `"ImbizoHub" <${SMTP_USER}>`,
        to: TO,
        replyTo: `"${m.name}" <${m.email}>`,
        subject: `[ImbizoHub] ${m.topic} — ${m.name}`,
        html,
        text:
          'New enquiry from imbizohub.com (delivered on retry)\n\n' +
          `Topic: ${m.topic}\nName:  ${m.name}\nEmail: ${m.email}\n` +
          (m.phone ? `Phone: ${m.phone}\n` : '') + `\n${m.message}\n`,
      });
      await markSent(m.id, true, null);
      ok += 1;
    } catch (e) {
      // Record the latest error and leave email_sent false, so the next
      // run picks it up again — until the 24-hour window closes.
      const msg = `retry: ${(e && e.message ? e.message : String(e)).slice(0, 300)}`;
      await markSent(m.id, false, msg);
      failed += 1;
      // If the very first one fails, the mail server is still down.
      // Stop rather than hammering it with the rest of the batch.
      if (ok === 0) break;
    }
  }

  transport.close();
  console.log(`contact-retry: ${ok} sent, ${failed} failed of ${pending.length}`);
  return res.status(200).json({ ok: true, retried: ok, failed });
};
