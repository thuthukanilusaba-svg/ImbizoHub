// api/health-alert.js
//
// Receives health findings from the hourly scheduled check and emails
// them to support@imbizohub.com.
//
// WHY THIS SITS ON VERCEL RATHER THAN IN AN EDGE FUNCTION:
// the SMTP credentials and a working nodemailer setup already exist here
// for the contact form. Sending mail from Postgres is not possible, and
// duplicating SMTP into a Deno edge function would mean a second copy of
// the same credentials in a second place — two things to rotate instead
// of one. The database does the checking, this does the sending.
//
// Nothing here queries anything. The findings arrive already computed by
// public.health_check(), which means this endpoint needs no database
// access at all — no service key, no anon key, nothing to leak.
//
// REQUIRED environment variable in Vercel:
//   HEALTH_ALERT_SECRET   shared with the scheduled job that calls this
// Reuses, already set for the contact form:
//   SMTP_USER, SMTP_PASS, CONTACT_TO_EMAIL, SMTP_HOST, SMTP_PORT

const nodemailer = require('nodemailer');

function esc(s = '') {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const expected = process.env.HEALTH_ALERT_SECRET;
  if (!expected) {
    console.error('health-alert: HEALTH_ALERT_SECRET is not set');
    return res.status(500).json({ ok: false, error: 'Not configured' });
  }
  if (req.headers['x-health-secret'] !== expected) {
    // Deliberately terse. Anyone probing this endpoint learns nothing
    // about whether the secret exists or what shape it takes.
    return res.status(401).json({ ok: false });
  }

  let findings;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    findings = Array.isArray(body) ? body : body.findings;
  } catch {
    return res.status(400).json({ ok: false, error: 'Bad body' });
  }

  if (!Array.isArray(findings) || findings.length === 0) {
    // The scheduled job should not call us at all when healthy, but if it
    // does, stay silent rather than sending an empty email. A quiet inbox
    // is the signal that things are working.
    return res.status(200).json({ ok: true, sent: false });
  }

  const urgent = findings.filter((f) => f.severity === 'now');
  // Subject leads with urgency, because the subject line is all anyone
  // sees on a phone at nine in the evening.
  const subject = urgent.length
    ? `[ImbizoHub] ACT NOW — ${urgent[0].title}`
    : `[ImbizoHub] Needs attention — ${findings[0].title}`;

  const block = (f) => `
    <div style="border-left:4px solid ${f.severity === 'now' ? '#c0392b' : '#B8860B'};
                padding:2px 0 2px 16px;margin:0 0 22px">
      <div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;
                  color:${f.severity === 'now' ? '#c0392b' : '#8a6a10'};font-weight:700">
        ${f.severity === 'now' ? 'Act now' : 'Act soon'}
      </div>
      <div style="font-size:17px;font-weight:700;margin:4px 0 8px">${esc(f.title)}</div>
      <div style="font-size:15px;line-height:1.6;color:#333">${esc(f.impact)}</div>
      <div style="font-size:13px;color:#888;margin-top:10px;font-family:ui-monospace,Menlo,monospace">
        ${esc(f.detail)}
      </div>
    </div>`;

  // Plain language first, technical detail underneath — written so that
  // whoever opens this inbox can act, or at least answer a customer,
  // without waiting for a developer to be reachable.
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:640px">
      <h2 style="margin:0 0 6px">ImbizoHub health check</h2>
      <p style="margin:0 0 24px;color:#666;font-size:14px">
        ${findings.length} thing${findings.length === 1 ? '' : 's'} need${findings.length === 1 ? 's' : ''} attention.
        This check runs hourly and only emails when something is wrong.
      </p>
      ${findings.map(block).join('')}
      <p style="color:#999;font-size:12px;border-top:1px solid #eee;padding-top:14px">
        Sent automatically by the hourly health check. If this is wrong or too noisy,
        the checks live in the <code>health_check()</code> database function.
      </p>
    </div>`;

  const text =
    `ImbizoHub health check — ${findings.length} item(s)\n\n` +
    findings.map((f) =>
      `[${f.severity === 'now' ? 'ACT NOW' : 'ACT SOON'}] ${f.title}\n${f.impact}\n(${f.detail})\n`
    ).join('\n');

  const SMTP_USER = process.env.SMTP_USER;
  const SMTP_PASS = process.env.SMTP_PASS;
  const TO = process.env.CONTACT_TO_EMAIL || SMTP_USER;
  const HOST = process.env.SMTP_HOST || 'mail.privateemail.com';
  const PORT = Number(process.env.SMTP_PORT || 465);

  if (!SMTP_USER || !SMTP_PASS || !TO) {
    console.error('health-alert: SMTP not configured', findings);
    return res.status(500).json({ ok: false, error: 'SMTP not configured' });
  }

  try {
    const transport = nodemailer.createTransport({
      host: HOST, port: PORT, secure: PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    });
    await transport.sendMail({
      from: `"ImbizoHub Monitoring" <${SMTP_USER}>`,
      to: TO,
      subject,
      html,
      text,
    });
    return res.status(200).json({ ok: true, sent: true, count: findings.length });
  } catch (err) {
    // Logged rather than swallowed: if the alerting itself is broken we
    // want it visible in Vercel's function logs, which is the one place
    // still worth checking by hand.
    console.error('health-alert: send failed', err && err.message, findings);
    return res.status(500).json({ ok: false, error: 'Send failed' });
  }
};
