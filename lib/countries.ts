// lib/countries.ts
//
// The runtime source of truth for which countries ImbizoHub operates in
// and which cities each one has. Replaces the hardcoded list in
// lib/cities.ts as the thing the UI reads, while keeping that list as an
// offline fallback.
//
// WHY THIS EXISTS:
// country_config and cities have been in the database since 24 August
// 2026, fully populated — South Africa with 42 cities and a complete
// currency/phone/feature configuration. Nothing in the app read either
// table. Flipping South Africa's `active` flag would have changed
// nothing at all, while looking exactly like it had worked. This file is
// what makes that flag mean something.
//
// ------------------------------------------------------------------
// THE RLS DETAIL THAT SHAPES THIS WHOLE FILE — read before editing.
// ------------------------------------------------------------------
// The two tables are protected differently:
//
//   country_config   SELECT ... USING (active)   <- the country's flag
//   cities           SELECT ... USING (active)   <- the CITY ROW's flag
//
// So country_config returns only live countries, but `cities` returns
// every active city row for EVERY country, live or not. A naive
// `select * from cities` today would hand the picker 42 South African
// and 22 Botswana cities while both countries are switched off.
//
// Therefore: the country list gates the city list. We fetch the
// countries first and keep only cities whose country came back. That
// makes country_config.active the single switch that opens a country,
// which is what the schema was clearly designed for.
//
// Do not "optimise" this into one query against cities alone.
//
// ------------------------------------------------------------------
// FAILURE BEHAVIOUR
// ------------------------------------------------------------------
// If the fetch fails — offline, RLS change, table renamed — we fall back
// to Zimbabwe and the hardcoded CITIES list rather than returning
// nothing. An empty picker is indistinguishable from a broken app and
// blocks posting entirely; a stale-but-correct Zimbabwean list lets
// every existing user carry on exactly as before. This matches the
// fail-open reasoning already written into operatorCanSeeTrip().

import { useEffect, useState } from 'react';
import { CITIES, CITY_OTHER } from './cities';
import { supabase } from './supabase';

export const DEFAULT_COUNTRY = 'ZW';

export type CountryConfig = {
  country: string;
  name: string;
  currency: string;
  currency_symbol: string;
  phone_prefix: string;
  match_level: 'city' | 'province';
  features: {
    wanted: boolean;
    delivery: boolean;
    listings: boolean;
    transport: boolean;
    verification: boolean;
    contact_unlock: boolean;
  };
  payment_provider: string | null;
  fees_enabled: boolean;
};

export type CityRow = {
  country: string;
  name: string;
  sort: number;
  is_other: boolean;
  province: string | null;
};

// The shape returned when the database is unreachable. Zimbabwe only,
// built from the hardcoded list, so the app behaves exactly as it did
// before this file existed.
const FALLBACK_COUNTRIES: CountryConfig[] = [
  {
    country: 'ZW',
    name: 'Zimbabwe',
    currency: 'USD',
    currency_symbol: '$',
    phone_prefix: '+263',
    match_level: 'city',
    features: {
      wanted: true,
      delivery: false,
      listings: true,
      transport: true,
      verification: true,
      contact_unlock: true,
    },
    payment_provider: 'paynow',
    fees_enabled: false,
  },
];

const FALLBACK_CITIES: CityRow[] = CITIES.map((name, i) => ({
  country: 'ZW',
  name,
  // Preserves the hand-tuned ordering of lib/cities.ts: the largest
  // centres first, 'Other' last.
  sort: name === CITY_OTHER ? 999 : i * 10,
  is_other: name === CITY_OTHER,
  province: null,
}));

type Snapshot = { countries: CountryConfig[]; cities: CityRow[]; fromFallback: boolean };

// Module-level cache. The city list changes about once a year; refetching
// it on every mount of every picker would be three round trips to open a
// form. The promise itself is cached so simultaneous mounts share one
// request rather than racing.
let cache: Snapshot | null = null;
let inFlight: Promise<Snapshot> | null = null;

async function load(): Promise<Snapshot> {
  try {
    const [countryRes, cityRes] = await Promise.all([
      supabase
        .from('country_config')
        .select('country, name, currency, currency_symbol, phone_prefix, match_level, features, payment_provider, fees_enabled')
        .order('country'),
      supabase
        .from('cities')
        .select('country, name, sort, is_other, province')
        .order('sort')
        .order('name'),
    ]);

    if (countryRes.error) throw countryRes.error;
    if (cityRes.error) throw cityRes.error;

    const countries = (countryRes.data ?? []) as CountryConfig[];

    // An empty country list means RLS returned nothing — every country
    // switched off, or the policy changed. Treat it as a failure rather
    // than as "ImbizoHub operates nowhere", which would empty every
    // picker in the app.
    if (countries.length === 0) throw new Error('country_config returned no active rows');

    const live = new Set(countries.map((c) => c.country));

    // The gate described at the top of this file.
    const cities = ((cityRes.data ?? []) as CityRow[]).filter((c) => live.has(c.country));

    return { countries, cities, fromFallback: false };
  } catch {
    // Deliberately swallowed. The caller gets a working Zimbabwean app;
    // reportHandledError is not used here because this runs on every
    // cold start and a flaky connection would flood crash_reports.
    return { countries: FALLBACK_COUNTRIES, cities: FALLBACK_CITIES, fromFallback: true };
  }
}

export function getCountriesSnapshot(): Snapshot | null {
  return cache;
}

export async function loadCountries(): Promise<Snapshot> {
  if (cache) return cache;
  if (!inFlight) {
    inFlight = load().then((snap) => {
      // A fallback result is NOT cached: the next screen should try the
      // network again rather than run on stale defaults for the whole
      // session because one request failed at launch.
      if (!snap.fromFallback) cache = snap;
      inFlight = null;
      return snap;
    });
  }
  return inFlight;
}

// Hook form for components. Returns the fallback immediately on first
// render so a picker is never empty while the request is in flight.
export function useCountryData() {
  const [snap, setSnap] = useState<Snapshot>(
    () => cache ?? { countries: FALLBACK_COUNTRIES, cities: FALLBACK_CITIES, fromFallback: true }
  );
  const [loading, setLoading] = useState(!cache);

  useEffect(() => {
    let alive = true;
    if (cache) {
      setSnap(cache);
      setLoading(false);
      return;
    }
    loadCountries().then((s) => {
      if (!alive) return;
      setSnap(s);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  return { ...snap, loading };
}

// Cities for one country, already ordered. Falls back to every city we
// hold if the country is unknown — an unrecognised country code should
// not produce an empty picker.
export function citiesFor(snap: Snapshot, country: string | null | undefined): CityRow[] {
  const wanted = country || DEFAULT_COUNTRY;
  const forCountry = snap.cities.filter((c) => c.country === wanted);
  return forCountry.length > 0 ? forCountry : snap.cities;
}

export function configFor(
  snap: Snapshot,
  country: string | null | undefined
): CountryConfig | undefined {
  const wanted = country || DEFAULT_COUNTRY;
  return snap.countries.find((c) => c.country === wanted);
}

// The signed-in user's own country, read from their profile.
//
// WHY A HOOK RATHER THAN READING profiles INLINE IN EACH SCREEN:
// four screens need this (post, post-wanted, hirevan, become-operator)
// and each one would otherwise add its own round trip and its own
// spelling of the fallback. One place to be wrong is better than four.
//
// Returns DEFAULT_COUNTRY while loading and for signed-out users. That
// is deliberately the same value profiles.country already defaults to,
// so a slow profile fetch can never cause a post to be filed under the
// wrong country — the worst case is the value it would have had anyway.
let myCountryCache: string | null = null;

export function useMyCountry(): string {
  const [country, setCountry] = useState<string>(myCountryCache ?? DEFAULT_COUNTRY);

  useEffect(() => {
    let alive = true;
    if (myCountryCache) return;

    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        if (!auth?.user) return;
        const { data, error } = await supabase
          .from('profiles')
          .select('country')
          .eq('id', auth.user.id)
          .maybeSingle();
        if (error || !data?.country) return;
        myCountryCache = data.country;
        if (alive) setCountry(data.country);
      } catch {
        // Fall through to DEFAULT_COUNTRY. See the note above.
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  return country;
}

// Clears the cached profile country. Must be called on sign-out, or the
// next person to sign in on a shared handset inherits the previous
// user's country.
export function clearMyCountry() {
  myCountryCache = null;
}

// True when more than one country is live. The UI uses this to decide
// whether to show country choosers at all — with a single country they
// are noise, and today there IS a single country.
export function isMultiCountry(snap: Snapshot): boolean {
  return snap.countries.length > 1;
}
