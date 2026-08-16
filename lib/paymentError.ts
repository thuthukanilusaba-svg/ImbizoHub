// lib/paymentError.ts
//
// Shared by every screen that calls the `create-payment` edge function
// (unlock.tsx, operator-register-pay.tsx, delivery-operator-register-pay.tsx,
// delivery-booking.tsx, quotes.tsx, wanted-responses.tsx, dealer-pro-pay.tsx,
// feature-listing-pay.tsx, verified-seller-pay.tsx).
//
// FOUND WHILE DEBUGGING (2026-08-16): every one of those screens showed the
// same useless "Edge Function returned a non-2xx status code" message on
// screen no matter what actually went wrong (a Paynow rejection, a server
// validation error, anything). Root cause: supabase-js's functions.invoke()
// does NOT put the edge function's JSON error body into `data` when the
// response is non-2xx — `data` comes back null and `error` is a
// FunctionsHttpError whose own .message is always that same generic string.
// The real reason is sitting unread in `error.context`, the raw Response
// object returned by fetch — this reads it back out so the actual message
// (e.g. "Incorrect amount for delivery booking fee", a specific Paynow
// error, etc.) reaches the user and future debugging.
export async function extractFunctionError(
  fnError: any,
  data: any,
  fallback: string
): Promise<string> {
  if (data?.error) return data.error;
  if (fnError?.context?.json) {
    try {
      const body = await fnError.context.json();
      if (body?.error) return body.error;
    } catch {
      // context body wasn't JSON, or was already consumed — fall through
      // to the generic message below rather than throwing.
    }
  }
  return fnError?.message || fallback;
}
