// components/LocationPicker.tsx
//
// The location field for listings (post.tsx) and Wanted posts
// (post-wanted.tsx). Wraps the existing CityPicker and adds the one
// thing a marketplace needs that trip-matching does not: a real town
// name behind 'Other'.
//
// WHY: both screens were free text with placeholder "e.g. Harare", and
// the live data shows exactly what free text produces —
//
//     Bulawayo   4      bulawayo   1      <- same city, two rows
//     Harare     2      ghdxed     1      <- junk
//     Gweru      1      Burbank    2      <- a browser autofilled a US city
//
// Nothing in the app can group 'Bulawayo' with 'bulawayo', so a buyer
// filtering for one silently misses the other. lib/cities.ts made this
// argument for the transport side back in August and CityPicker has
// existed since; these two screens were simply never wired to it.
//
// WHY 'OTHER' IS HANDLED HERE AND NOT IN CityPicker:
// For trip matching, storing the literal string 'Other' is correct and
// meaningful — operatorCanSeeTrip() reads it and deliberately fails
// open. For a listing it is useless: the card would render "📍 Other",
// which tells a buyer less than nothing. So when someone picks Other
// here, they type their town and THAT is what gets stored. The fixed
// list stays clean for the overwhelming majority, and nobody in a town
// the list forgot is locked out of posting.
//
// NOT A HORIZONTAL SCROLL, on purpose. post.tsx's own category row was
// exactly that and had to be rebuilt: on desktop web there is no swipe,
// the scroll indicator was hidden, and a mouse wheel scrolls the page
// instead — so the cities past the right-hand edge were unreachable.
// CityPicker's tap-to-open sheet with a vertical list has none of that
// problem on either platform.

import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { CITIES, CITY_OTHER } from '../lib/cities';
import CityPicker from './CityPicker';

const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

function isNamedCity(v: string): boolean {
  return v !== CITY_OTHER && (CITIES as readonly string[]).includes(v);
}

export default function LocationPicker({
  value,
  onChange,
  placeholder = 'Select your city',
}: {
  value: string;
  onChange: (location: string) => void;
  placeholder?: string;
}) {
  // Held as state rather than derived from `value` on every render.
  // Derived would work until someone typed a town whose name happens to
  // be on the list — the field would flip back to a chip mid-word and
  // take the keyboard with it. Editing an older post whose location is
  // free text (everything created before today) opens straight into
  // Other, which is correct: that IS a custom value.
  const [otherMode, setOtherMode] = useState(() => !!value && !isNamedCity(value));

  function handlePick(city: string) {
    if (city === CITY_OTHER) {
      setOtherMode(true);
      // Cleared rather than left as 'Other'. Both callers validate on
      // location.trim(), so an empty value makes "Post" refuse until a
      // town is actually typed — where keeping 'Other' would sail
      // through validation and store a useless location.
      onChange('');
      return;
    }
    setOtherMode(false);
    onChange(city);
  }

  return (
    <View>
      <CityPicker
        value={otherMode ? CITY_OTHER : value}
        onChange={handlePick}
        placeholder={placeholder}
      />

      {otherMode ? (
        <>
          <TextInput
            style={styles.otherInput}
            placeholder="Which town or city?"
            placeholderTextColor="#666"
            value={value}
            onChangeText={onChange}
            maxLength={40}
            autoFocus
          />
          <Text style={styles.otherHint}>
            Type the town name — buyers search by it, so spell it as people would.
          </Text>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  otherInput: {
    backgroundColor: DARK, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 14,
    borderWidth: 1, borderColor: '#444', color: '#fff', fontSize: 16, marginTop: 10,
  },
  otherHint: { color: GREY, fontSize: 12, marginTop: 6, lineHeight: 17 },
});
