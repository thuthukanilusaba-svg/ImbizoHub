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

export const DELIVERY_PAUSED_TITLE = 'Delivery coming soon';
export const DELIVERY_PAUSED_MESSAGE =
  "We're building a safer way to protect your payment for Book & Deliver orders. It's paused for new bookings in the meantime — check back soon. Meet & Pay is still available for same-city deals.";

// NOTE: existing delivery-operator accounts will be cleaned up before this
// relaunches, so this message must not promise already-registered accounts
// are unaffected — that's no longer true.
export const DELIVERY_OPERATOR_SIGNUP_PAUSED_MESSAGE =
  'New delivery-operator registration is paused while we build a safer payment system for Book & Deliver. Check back soon.';
