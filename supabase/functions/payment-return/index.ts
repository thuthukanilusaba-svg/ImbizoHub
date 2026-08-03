// supabase/functions/payment-return/index.ts
//
// This is where Paynow's `returnurl` sends the buyer's browser after they
// finish (or cancel) paying. It's just a simple confirmation page — the
// app itself never reads anything from this redirect; unlock.tsx and
// delivery-operator-register-pay.tsx confirm payment by polling
// payment_intents directly (which the paynow-webhook function updates).
// This page exists purely so the buyer has somewhere sensible to land,
// and so Paynow has a valid public URL to redirect to — this matters
// especially while the app itself is still only running locally and has
// no public URL of its own yet.
//
// FIX (found during a full-app review pass): this used to show the
// exact same generic "Thanks!" message regardless of what actually
// happened — including if the buyer explicitly cancelled on Paynow's
// own page. "If you completed your payment..." reads as a success
// message even to someone who just tapped Cancel, which is a real
// clarity/trust issue even though nothing in the app actually acts on
// it.
//
// Now reads whatever status Paynow appended to the returnurl query
// string and shows an appropriately different message. IMPORTANT: this
// is DISPLAY-ONLY — unlike paynow-webhook's resulturl payload, there's
// no hash verification on the returnurl (this is just a browser
// redirect, not a server-to-server call), so this status is NOT trusted
// for anything that actually grants access or marks something paid.
// That real confirmation still only ever happens in paynow-webhook. This
// page is purely about showing the buyer an honest-sounding message
// while they wait for the app to poll and confirm for real.

Deno.serve((req) => {
  const url = new URL(req.url);
  // Paynow's exact param name/casing on returnurl can vary by
  // integration — check a couple of reasonable variants defensively
  // rather than assuming one exact key, and fall back gracefully to the
  // original generic copy if nothing is present at all.
  const status = (url.searchParams.get('status') || url.searchParams.get('Status') || '').toLowerCase();

  let heading = 'Thanks!';
  let message = 'If you completed your payment, you can close this window and ' +
    'return to the ImbizoHub app — it will confirm automatically within a few seconds.';

  if (status === 'cancelled' || status === 'cancel') {
    heading = 'Payment cancelled';
    message = 'You cancelled the payment — nothing was charged. You can close this window ' +
      'and go back to the app whenever you\'re ready to try again.';
  } else if (status === 'paid' || status === 'awaiting delivery') {
    heading = 'Payment received!';
    message = 'You can close this window and return to the ImbizoHub app — ' +
      'it will confirm automatically within a few seconds.';
  } else if (status && status !== 'created' && status !== 'sent') {
    // Any other unrecognized-but-present status (e.g. a failure state) —
    // stay cautious rather than implying success.
    heading = 'Payment not completed';
    message = 'Something went wrong with this payment and it wasn\'t completed. ' +
      'You can close this window and try again from the app — you have not been charged.';
  }
  // If status is empty, 'created', or 'sent' (still in progress), the
  // original neutral "Thanks!" copy above is used as-is — accurate for
  // an in-progress or unknown state, without falsely implying success or failure.

  const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ImbizoHub — Payment</title>
    <style>
      body {
        background: #111111;
        color: #ffffff;
        font-family: -apple-system, system-ui, sans-serif;
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100vh;
        margin: 0;
        text-align: center;
        padding: 24px;
      }
      .card {
        max-width: 360px;
      }
      h1 {
        color: #B8860B;
        font-size: 22px;
        margin-bottom: 12px;
      }
      p {
        color: #AAAAAA;
        font-size: 14px;
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${heading}</h1>
      <p>${message}</p>
    </div>
  </body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  });
});