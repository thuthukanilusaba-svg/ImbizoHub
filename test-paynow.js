// test-paynow.js
// Standalone diagnostic — run this directly with Node (not through Supabase)
// to check whether the "Connection reset by peer" error also happens when
// the request comes from your own machine, rather than from Supabase's
// Edge Function (which runs in Ireland — eu-west-1). If this script
// succeeds but the Edge Function doesn't, that strongly points to Paynow
// rejecting/resetting connections based on origin (IP, region, or some
// other network-level fingerprint) rather than anything wrong with the
// request itself.
//
// Usage:
//   node test-paynow.js
//
// Fill in your real Integration ID and Key below before running — this
// is just a local diagnostic script on your own machine, not something
// that gets committed or deployed anywhere.

const crypto = require('crypto');

const PAYNOW_INTEGRATION_ID = '25524';
const PAYNOW_INTEGRATION_KEY = '168c8ac5-f50f-4b66-bf89-88eaee540ebb';

function paynowHash(orderedValues, integrationKey) {
  const raw = orderedValues.join('') + integrationKey;
  return crypto.createHash('sha512').update(raw, 'utf8').digest('hex').toUpperCase();
}

async function main() {
  const reference = `test-${Date.now()}`;
  const amountStr = '10.00';
  const additionalInfo = 'ImbizoHub test payment';
  const returnUrl = 'https://example.com/return';
  const resultUrl = 'https://example.com/result';

  const fields = [
    ['id', PAYNOW_INTEGRATION_ID],
    ['reference', reference],
    ['amount', amountStr],
    ['additionalinfo', additionalInfo],
    ['returnurl', returnUrl],
    ['resulturl', resultUrl],
    ['status', 'Message'],
  ];

  const hash = paynowHash(fields.map(([, v]) => v), PAYNOW_INTEGRATION_KEY);

  const form = new URLSearchParams();
  for (const [k, v] of fields) form.append(k, v);
  form.append('hash', hash);

  console.log('Sending request to Paynow from THIS machine...');
  console.log('Reference:', reference);

  try {
    const resp = await fetch('https://www.paynow.co.zw/interface/initiatetransaction', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      body: form.toString(),
    });

    const text = await resp.text();
    console.log('\n✅ SUCCESS — got a response back!');
    console.log('Status:', resp.status);
    console.log('Body:', text);
  } catch (err) {
    console.log('\n❌ FAILED — same kind of error as the Edge Function?');
    console.error(err);
  }
}

main();
