// lib/money.ts
//
// One way to write a price.
//
// Every price in the app was rendered as a bare `${listing.price}` — no
// grouping, no decimal handling — in fourteen separate places. At $20 or
// $350 nobody notices. At six or seven digits it stops being readable:
//
//   $1250000     what it showed
//   $1,250,000   what a person can actually parse at a glance
//
// That matters more now than it used to. Listings are capped at
// $10,000,000 (listings_price_sane), which is deliberately high enough to
// carry a house, a haulage truck or mining equipment — and a marketplace
// where an expensive item's price is hard to read looks unserious to
// exactly the seller you would most want to keep.
//
// TWO THINGS THIS DELIBERATELY DOES NOT DO:
//
// It does not use toLocaleString. Number grouping through Intl depends on
// the JS engine shipping a full ICU build, which is not something to rely
// on across every Android device this app runs on — and passing no locale
// is worse, because then a phone set to German would render $1.250.000
// for a price quoted in US dollars. Manual grouping always produces the
// same output everywhere, which for a single-currency marketplace is the
// correct answer rather than a limitation.
//
// It does not prepend a currency symbol. Every call site already writes
// its own `$`, often inside a longer sentence, and moving that in here
// would mean touching all of them twice for no gain.

/**
 * Group a price with thousands separators.
 *
 *   formatPrice(1250000)   -> '1,250,000'
 *   formatPrice('350')     -> '350'
 *   formatPrice(1250000.5) -> '1,250,000.50'
 *   formatPrice(null)      -> '—'
 *
 * Accepts a string because that is what actually arrives: supabase-js
 * returns Postgres `numeric` columns as strings to avoid the precision
 * loss of a float, so `listing.price` is '1250000', not 1250000.
 */
export function formatPrice(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';

  const n = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return '—';

  // Whole amounts show no decimals — "$350.00" reads like a form, not a
  // price. Anything with real cents shows exactly two, so 1250000.5 is
  // never displayed as the ambiguous "1,250,000.5".
  const hasCents = Math.abs(n % 1) > 0.0001;
  const fixed = n.toFixed(hasCents ? 2 : 0);

  const [whole, fraction] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  return fraction ? `${grouped}.${fraction}` : grouped;
}
