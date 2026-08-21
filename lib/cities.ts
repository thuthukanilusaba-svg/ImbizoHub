// lib/cities.ts
//
// The single list of Zimbabwean cities and towns used for van-hire trip
// matching. Shared by hirevan.tsx (posting a trip), become-operator.tsx
// (an operator's base) and operator-requests.tsx (the filter), so all
// three are guaranteed to agree on spelling.
//
// WHY A FIXED LIST RATHER THAN FREE TEXT:
// The existing pickup/destination fields are free text, and the live
// data shows what that produces — 'home', 'town', 'mkambo' next to
// 'Mkambo', 'Egodini', 'Nketha 7'. Inconsistent case, landmarks and
// suburbs mixed with cities, and some entries carrying no location at
// all. Matching an operator to a trip on any of that is guesswork, and
// the failure mode is silent: an operator simply never sees a job.
//
// A picked value can be compared exactly. The free-text fields keep
// doing what they are good at — 'Mbare Musika', 'Egodini rank' is the
// detail a driver actually needs — while the city does the matching.
//
// ORDER: the largest centres first, since they will be the overwhelming
// majority of trips and should need the least scrolling. The remainder
// are alphabetical.
//
// 'Other' is deliberately last and deliberately present. Zimbabwe has
// far more towns than any list should try to hold, and a customer whose
// town is missing must still be able to post a trip. See CITY_OTHER
// below for how it is treated.

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

// Whether an operator based in `operatorCity` should see a trip.
//
// MATCHES ON PICKUP ONLY. The destination is deliberately ignored.
//
// An earlier version matched either end, on the theory that a Mutare
// operator taking a Harare → Mutare fare was doing a useful return leg.
// That was wrong, and the reason is physical: the van has to BE at the
// pickup point. A Bulawayo operator cannot serve a Harare pickup
// without driving 440km empty first, so putting that trip in their list
// is noise wearing the costume of an opportunity. Where the passenger
// is going afterwards has no bearing on whether this operator can pick
// them up.
//
// An operator who genuinely wants work in a second city is really based
// in two places, and the honest way to express that is a second city on
// their profile — not a matching rule that quietly guesses for them.
//
// Fails OPEN in three cases, all on purpose:
//   - the operator has not set a base city (every operator registered
//     before this feature existed)
//   - the trip has no pickup city (every request posted before it did)
//   - either side is 'Other'
// Hiding a real job from a driver costs them income they never learn
// about; showing one irrelevant trip costs a scroll.
export function operatorCanSeeTrip(
  operatorCity: string | null | undefined,
  pickupCity: string | null | undefined,
  _destinationCity?: string | null | undefined
): boolean {
  if (!operatorCity || operatorCity === CITY_OTHER) return true;
  if (!pickupCity || pickupCity === CITY_OTHER) return true;
  return pickupCity === operatorCity;
}
