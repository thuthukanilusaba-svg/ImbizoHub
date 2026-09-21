// components/CountryPicker.tsx
//
// Chooses which country a person is in. Used by register.tsx, and
// available to any screen that needs the same choice later.
//
// RENDERS NOTHING WHEN ONLY ONE COUNTRY IS LIVE.
// That is the point of the component rather than an oversight. Today
// Zimbabwe is the only active country, so asking every new user to pick
// it from a list of one is a question with no information in it — and
// registration is the worst place in the app to add a pointless field.
// The moment country_config.active is set on a second country this
// appears on its own, with no app release.
//
// Callers must therefore treat the value as already-correct when the
// component renders null: the default is the only live country, which is
// exactly what the user would have chosen.

import { useState } from 'react';
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity,
} from 'react-native';
import { isMultiCountry, useCountryData } from '../lib/countries';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

export default function CountryPicker({
  value,
  onChange,
  placeholder = 'Select your country',
}: {
  value: string;
  onChange: (country: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const snap = useCountryData();

  if (!isMultiCountry(snap)) return null;

  const selected = snap.countries.find((c) => c.country === value);

  return (
    <>
      <TouchableOpacity style={styles.field} onPress={() => setOpen(true)}>
        <Text style={selected ? styles.fieldValue : styles.fieldPlaceholder}>
          {selected ? selected.name : placeholder}
        </Text>
        <Text style={styles.chevron}>▾</Text>
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.title}>Select country</Text>
            <ScrollView style={styles.list}>
              {snap.countries.map((c) => {
                const active = c.country === value;
                return (
                  <TouchableOpacity
                    key={c.country}
                    style={[styles.row, active && styles.rowActive]}
                    onPress={() => { onChange(c.country); setOpen(false); }}
                  >
                    <Text style={[styles.rowText, active && styles.rowTextActive]}>
                      {c.name}
                    </Text>
                    {active ? <Text style={styles.tick}>✓</Text> : null}
                  </TouchableOpacity>
                );
              })}
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
