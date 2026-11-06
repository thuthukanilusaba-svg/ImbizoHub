// lib/featureFlags.ts
//
// Simple in-code feature flags for pausing/resuming a feature without a
// full remote-config system — flip the constant here and ship an OTA
// update to change behavior app-wide.
//
// REOPENED (product decision, 6 Nov 2026). Book & Deliver and new
// delivery-operator signups are both live again. One flag governs both,
// and every call site reads it: register.tsx (the 'delivery' account
// type), become-operator.tsx, profile.tsx's
// handleBecomeDeliveryOperator(), chat.tsx's "Book delivery" option, and
// delivery-booking.tsx's own checkAuth() as defence in depth.
//
// WHAT HAS NOT CHANGED, AND IS WRITTEN DOWN RATHER THAN FORGOTTEN:
// the reason this was paused on 18 Aug 2026 still stands in full. There
// is no escrow. delivery_bookings carries item_price and payment_status
// (see the delivery_item_price_and_payment_status migration, and
// delivery-booking.tsx / seller-deliveries.tsx / delivery-track.tsx),
// but that is a lightweight, non-blocking acknowledgment — no money for
// the item moves through the app and none is held.
//
// Book & Deliver is the one flow where the two people NEVER MEET. Meet &
// Pay works because a buyer and a seller stand in front of each other
// with a PIN; this has no equivalent. A buyer in Harare paying a seller
// in Bulawayo for goods carried by a third party has no recourse inside
// the app if they never arrive or arrive broken.
//
// That risk was accepted deliberately on reopening, not overlooked. It
// was reopened from a standing start: zero rows in delivery_operators
// and zero bookings ever recorded, so nobody was mid-flight.
//
// THE FIRST DISPUTE IS THE TEST. If one happens before escrow exists,
// set this back to false and ship an OTA, rather than arguing it
// through case by case. The escrow design that would let it stay open:
// buyer pays the item price into Paynow at booking time, funds held,
// released to the seller only once the buyer confirms delivery.
//
// Terms of Service section 7 was rewritten the same day. It previously
// said Book & Deliver was "not currently offered", which stopped being
// true the moment this line changed. If this ever goes back to false,
// that section moves with it.
export const DELIVERY_BOOKING_ENABLED = true;

// Kept, not deleted. These are what the gates show whenever the flag
// above is false, and they are still imported by chat.tsx, profile.tsx
// and become-operator.tsx. Removing them would turn "pause delivery in a
// hurry" into a four-file change — which is exactly the moment you do
// not want a four-file change.
//
// The copy stays as "Coming soon" with no explanation. The reasoning
// belongs here in the comments, for whoever maintains this, not in a
// dialog telling a customer about a gap in the product they had not
// asked about.
export const DELIVERY_PAUSED_TITLE = 'Coming soon';
export const DELIVERY_PAUSED_MESSAGE = '';
export const DELIVERY_OPERATOR_SIGNUP_PAUSED_MESSAGE = '';
