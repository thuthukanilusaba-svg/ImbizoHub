// components/CityPicker.tsx
//
// A single shared city selector, used by hirevan.tsx (both ends of a
// trip) and become-operator.tsx (an operator's base city).
//
// Shared rather than duplicated three times because these three values
// are compared to each other for exact equality — see lib/cities.ts.
// Three separate implementations would eventually drift, and the way
// they would fail is silent: a trip that simply never appears in an
// operator's list, with nothing anywhere reporting an error.

import { useState } from 'react';
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { CITIES } from '../lib/cities';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

export default function CityPicker({
  value,
  onChange,
  placeholder = 'Select a city',
}: {
  value: string;
  onChange: (city: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);

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
              {CITIES.map((city) => (
                <TouchableOpacity
                  key={city}
                  style={[styles.row, value === city && styles.rowActive]}
                  onPress={() => { onChange(city); setOpen(false); }}
                >
                  <Text style={[styles.rowText, value === city && styles.rowTextActive]}>
                    {city}
                  </Text>
                  {value === city ? <Text style={styles.tick}>✓</Text> : null}
                </TouchableOpacity>
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
