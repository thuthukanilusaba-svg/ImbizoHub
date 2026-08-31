// lib/featureFlags.ts
//
// Simple in-code feature flags for pausing/resuming a feature without a
// full remote-config system — flip the constant here and ship an OTA
// update to change behavior app-wide.
//
// PAUSED (product decision, 2026-08-18): Book & Deliver has no real
// payment protection for the item price itself. delivery_bookings now
// carries item_price/payment_status (see
// delivery_item_price_and_payment_status migration and
// delivery-booking.tsx/seller-deliveries.tsx/delivery-track.tsx), but
// that's a lightweight, non-blocking acknowledgment step, not escrow —
// no money for the item moves through the app. Buyers and sellers,
// especially in different cities who never meet in person, currently
// have no real recourse if either side doesn't hold up their end.
//
// New bookings and new delivery-operator registrations are paused until
// a real escrow flow is built (buyer pays the item price into Paynow at
// booking time, funds held, released to the seller only once the buyer
// confirms delivery). Existing in-flight bookings, already-registered
// operators, and reassigning a driver on an already-booked delivery are
// all UNAFFECTED — this only blocks the entry points for brand new
// bookings and brand new operator signups. See the three call sites:
// chat.tsx's "Book delivery" option, profile.tsx's
// handleBecomeDeliveryOperator(), and delivery-booking.tsx's own
// checkAuth() (defense-in-depth, in case this screen is ever reached
// directly without going through chat.tsx).
export const DELIVERY_BOOKING_ENABLED = false;

// CHANGED (product decision, 31 Aug 2026): the dialogs say "Coming soon"
// and nothing else. The previous copy explained the reason — that there is
// no payment protection yet and escrow is being built — which told every
// person tapping the button about a gap in the product they had not asked
// about. "Coming soon" is the whole message.
//
// The reasoning is kept here in the comments, where it belongs: it is for
// whoever maintains this, not for the customer.
export const DELIVERY_PAUSED_TITLE = 'Coming soon';
export const DELIVERY_PAUSED_MESSAGE = '';

// NOTE: existing delivery-operator accounts will be cleaned up before this
// relaunches, so nothing here must promise already-registered accounts are
// unaffected — that is no longer true.
export const DELIVERY_OPERATOR_SIGNUP_PAUSED_MESSAGE = '';
