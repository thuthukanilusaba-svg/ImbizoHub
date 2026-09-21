// components/CityPicker.tsx
//
// A single shared city selector, used by hirevan.tsx (both ends of a
// trip), become-operator.tsx (an operator's base city) and, through
// LocationPicker, by post.tsx and post-wanted.tsx.
//
// Shared rather than duplicated because these values are compared to
// each other for exact equality — see lib/cities.ts. Separate
// implementations would eventually drift, and the way they would fail is
// silent: a trip that simply never appears in an operator's list, with
// nothing anywhere reporting an error.
//
// ------------------------------------------------------------------
// NOW READS THE DATABASE, NOT A CONSTANT
// ------------------------------------------------------------------
// The list comes from lib/countries.ts, which reads the `cities` table
// gated by which countries are active. Adding a city, or opening a whole
// country, is a database change with no app release. See that file for
// why the country list has to gate the city list rather than querying
// cities directly.
//
// While a single country is active this renders exactly as before: one
// flat list, no headers, no country chooser. The grouping below only
// appears once a second country is switched on, so today's Zimbabwean
// users see no change whatsoever.

import { useMemo, useState } from 'react';
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { citiesFor, isMultiCountry, useCountryData, type CityRow } from '../lib/countries';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

export default function CityPicker({
  value,
  onChange,
  placeholder = 'Select a city',
  country,
}: {
  value: string;
  onChange: (city: string) => void;
  placeholder?: string;
  // When set, the sheet shows only this country's cities and no headers.
  // Callers that represent one physical place — an operator's base, a
  // seller's location — should pass the user's own country. Leaving it
  // undefined shows every live country, which is what a trip pickup
  // wants once more than one country is running.
  country?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const snap = useCountryData();

  // Grouped by country, preserving the `sort` order the database
  // returned. A flat list is used whenever there is only one group,
  // which keeps the single-country case byte-identical to the old UI.
  const groups = useMemo(() => {
    const rows: CityRow[] = country ? citiesFor(snap, country) : snap.cities;
    const byCountry = new Map<string, CityRow[]>();
    for (const row of rows) {
      const list = byCountry.get(row.country);
      if (list) list.push(row);
      else byCountry.set(row.country, [row]);
    }
    return [...byCountry.entries()].map(([code, cities]) => ({
      code,
      name: snap.countries.find((c) => c.country === code)?.name ?? code,
      cities,
    }));
  }, [snap, country]);

  const showHeaders = groups.length > 1 && isMultiCountry(snap);

  return (
    <>
      <TouchableOpacity style={styles.field} onPress={() => setOpen(true)}>
        <Text style={value ? styles.fieldValue : styles.fieldPlaceholder}>
          {value || placeholder}
        </Text>
        <Text style={styles.chevron}>▾</Text>
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        {/* Tapping the dimmed area closes — expected of a sheet, and the
            only way out on web, where there is no hardware back button
            for onRequestClose to fire. */}
        <Pressable style={styles.overlay} onPress={() => setOpen(false)}>
          {/* Swallows taps so choosing a city inside the sheet does not
              also trigger the overlay's dismiss. */}
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.title}>Select city</Text>
            <ScrollView style={styles.list}>
              {groups.map((group) => (
                <View key={group.code}>
                  {showHeaders ? (
                    <Text style={styles.groupHeader}>{group.name}</Text>
                  ) : null}
                  {group.cities.map((city) => {
                    // Keyed on country+name because the primary key is
                    // the pair: every country has its own 'Other' row,
                    // and Middelburg exists in more than one place.
                    const selected = value === city.name;
                    return (
                      <TouchableOpacity
                        key={`${city.country}:${city.name}`}
                        style={[styles.row, selected && styles.rowActive]}
                        onPress={() => { onChange(city.name); setOpen(false); }}
                      >
                        <Text style={[styles.rowText, selected && styles.rowTextActive]}>
                          {city.name}
                        </Text>
                        {selected ? <Text style={styles.tick}>✓</Text> : null}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.cancel} onPress={() => setOpen(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    backgroundColor: DARK, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 14,
    borderWidth: 1, borderColor: '#444', flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
  },
  fieldValue: { color: '#fff', fontSize: 16 },
  fieldPlaceholder: { color: '#666', fontSize: 16 },
  chevron: { color: GREY, fontSize: 14 },

  // maxWidth/alignItems match the bottom sheets elsewhere in the app —
  // without them the sheet spans a full desktop browser window.
  overlay: {
    flex: 1, width: '100%', backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end', alignItems: 'center',
  },
  sheet: {
    width: '100%', maxWidth: 640, alignSelf: 'center', backgroundColor: BLACK,
    borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, maxHeight: '75%',
  },
  title: { color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 12 },
  list: { flexGrow: 0 },

  // Quiet and small: a label for the group below it, not a row someone
  // might try to tap.
  groupHeader: {
    color: GREY, fontSize: 12, fontWeight: '800', letterSpacing: 0.6,
    textTransform: 'uppercase', paddingHorizontal: 12, paddingTop: 16, paddingBottom: 6,
  },

  row: {
    paddingVertical: 14, paddingHorizontal: 12, borderRadius: 8,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  rowActive: { backgroundColor: DARK },
  rowText: { color: '#ddd', fontSize: 16 },
  rowTextActive: { color: GOLD, fontWeight: '700' },
  tick: { color: GOLD, fontSize: 16, fontWeight: '700' },
  cancel: { paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  cancelText: { color: GREY, fontSize: 15 },
});
