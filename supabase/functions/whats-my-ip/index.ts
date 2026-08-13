// supabase/functions/whats-my-ip/index.ts
//
// Diagnostic-only endpoint: reports the IP this Edge Function makes
// OUTBOUND requests from, plus whatever inbound IP headers the
// platform sets on the request itself. Exists because direct calls
// from Supabase's own datacenter IPs get reset by Paynow — payments
// are routed through a VPS proxy instead (see create-payment /
// paynow-webhook). This endpoint is how that was originally
// diagnosed, and stays deployed so the same check can be re-run any
// time the proxy IP needs re-verifying (e.g. after a Supabase infra
// change moves the runtime to a new outbound address).
//
// ⚠️ FIX (real bug, found during a full-codebase sweep): this file was
// still the unmodified `supabase functions new` scaffold template — it
// just echoed back a `name` field from the request body ("Hello
// {name}!") and never reported any IP information at all. It was
// registered in config.toml, deployed, and callable, but functionally
// useless for the one thing its name and header comment promised.
// Replaced with a real implementation below.
//
// Deliberately verify_jwt = false (see config.toml) — this returns no
// user or business data, only network diagnostics, so it's safe to
// leave open for a quick check from a browser or curl without a token.

const OUTBOUND_IP_CHECK_URL = 'https://api.ipify.org?format=json';

Deno.serve(async (req) => {
  const headers = req.headers;

  // Inbound: whatever this platform/proxy hop tells us about the
  // caller. Useful context, but NOT what Paynow's allowlist cares
  // about — that's the outbound address below.
  const inbound = {
    'x-forwarded-for': headers.get('x-forwarded-for'),
    'x-real-ip': headers.get('x-real-ip'),
    'cf-connecting-ip': headers.get('cf-connecting-ip'),
  };

  // Outbound: the IP this function itself is seen FROM when it makes
  // its own requests — the one that actually matters for Paynow/VPS
  // proxy allowlisting, since that's what a downstream server sees
  // when this function calls out (exactly what create-payment /
  // paynow-webhook do against Paynow's API).
  let outboundIp: string | null = null;
  let outboundError: string | null = null;
  try {
    const resp = await fetch(OUTBOUND_IP_CHECK_URL);
    const data = await resp.json();
    outboundIp = data?.ip ?? null;
  } catch (err) {
    outboundError = String(err);
  }

  return new Response(
    JSON.stringify({ inbound, outbound_ip: outboundIp, outbound_error: outboundError }, null, 2),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
});
