// lib/cities.ts
//
// The OFFLINE FALLBACK list of Zimbabwean cities, plus the trip-matching
// rule shared by the transport screens.
//
// ------------------------------------------------------------------
// THIS IS NO LONGER THE LIST THE UI READS.
// ------------------------------------------------------------------
// As of the multi-country work, CityPicker and LocationPicker read the
// `cities` table through lib/countries.ts. That table holds Zimbabwe,
// South Africa and Botswana, and which of them a user sees is decided by
// country_config.active — one flag, no app release.
//
// The array below is kept because lib/countries.ts falls back to it when
// the database is unreachable. An empty city picker blocks posting
// outright and is indistinguishable from a broken app; a stale but
// correct Zimbabwean list lets every existing user carry on. Keep it in
// step with the ZW rows in the `cities` table, or an offline user will
// pick a city that no longer exists.
//
// WHY A FIXED LIST RATHER THAN FREE TEXT (unchanged, still true):
// The pickup/destination fields were free text, and the live data showed
// what that produces — 'home', 'town', 'mkambo' next to 'Mkambo',
// 'Egodini', 'Nketha 7'. Inconsistent case, landmarks and suburbs mixed
// with cities, and some entries carrying no location at all. Matching an
// operator to a trip on any of that is guesswork, and the failure mode
// is silent: an operator simply never sees a job.
//
// ORDER: the largest centres first, since they will be the overwhelming
// majority of trips and should need the least scrolling. The remainder
// are alphabetical. 'Other' is deliberately last — see CITY_OTHER.

export const CITIES = [
  'Harare',
  'Bulawayo',
  'Chitungwiza',
  'Mutare',
  'Gweru',
  'Kwekwe',
  'Kadoma',
  'Masvingo',
  'Chinhoyi',
  'Marondera',
  'Victoria Falls',
  'Beitbridge',
  'Bindura',
  'Chegutu',
  'Chipinge',
  'Chiredzi',
  'Gokwe',
  'Gwanda',
  'Hwange',
  'Kariba',
  'Karoi',
  'Norton',
  'Plumtree',
  'Redcliff',
  'Rusape',
  'Shurugwi',
  'Zvishavane',
  'Other',
] as const;

export type City = (typeof CITIES)[number];

// A trip or operator marked 'Other' is not in any of the named cities,
// so it cannot be matched to one. It is treated the same way a missing
// city is: shown to everyone, rather than hidden from everyone. Losing
// a job to a filter you cannot see is far worse than scrolling past one
// trip that turned out not to be yours.
export const CITY_OTHER = 'Other';

// Whether an operator should see a trip.
//
// MATCHES ON PICKUP ONLY. The destination is deliberately ignored.
//
// An earlier version matched either end, on the theory that a Mutare
// operator taking a Harare -> Mutare fare was doing a useful return leg.
// That was wrong, and the reason is physical: the van has to BE at the
// pickup point. A Bulawayo operator cannot serve a Harare pickup
// without driving 440km empty first, so putting that trip in their list
// is noise wearing the costume of an opportunity. Where the passenger
// is going afterwards has no bearing on whether this operator can pick
// them up.
//
// COUNTRY (added with the multi-country work):
// Country is checked BEFORE city, and it is the one filter here that is
// allowed to be strict. The reason is the same physical one, only more
// so: a van registered in Gaborone cannot serve a Harare pickup, and
// unlike an inter-city run it cannot simply drive there — that is a
// border, a passport and a cross-border permit. Showing those trips to
// each other would recreate exactly the failure this rule exists to
// prevent: a request nobody can quote, sitting in a list looking like
// work.
//
// Both country arguments are optional and default to fail-open, so every
// existing call site keeps its current behaviour until it passes them.
//
// Fails OPEN in these cases, all on purpose:
//   - either side has no country recorded (everything posted before
//     multi-country existed)
//   - the operator has not set a base city (every operator registered
//     before city matching existed)
//   - the trip has no pickup city (every request posted before it did)
//   - either city is 'Other'
// Hiding a real job from a driver costs them income they never learn
// about; showing one irrelevant trip costs a scroll.
export function operatorCanSeeTrip(
  operatorCity: string | null | undefined,
  pickupCity: string | null | undefined,
  _destinationCity?: string | null | undefined,
  operatorCountry?: string | null | undefined,
  tripCountry?: string | null | undefined
): boolean {
  // Country first: a mismatch here is decisive, because no amount of
  // city matching makes a cross-border trip servable.
  if (operatorCountry && tripCountry && operatorCountry !== tripCountry) return false;

  if (!operatorCity || operatorCity === CITY_OTHER) return true;
  if (!pickupCity || pickupCity === CITY_OTHER) return true;
  return pickupCity === operatorCity;
}
