// components/LocationPicker.tsx
//
// The location field for listings (post.tsx) and Wanted posts
// (post-wanted.tsx). Wraps CityPicker and adds the one thing a
// marketplace needs that trip-matching does not: a real town name behind
// 'Other'.
//
// WHY: both screens were free text with placeholder "e.g. Harare", and
// the live data shows exactly what free text produces —
//
//     Bulawayo   4      bulawayo   1      <- same city, two rows
//     Harare     2      ghdxed     1      <- junk
//     Gweru      1      Burbank    2      <- a browser autofilled a US city
//
// Nothing in the app can group 'Bulawayo' with 'bulawayo', so a buyer
// filtering for one silently misses the other.
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
//
// MULTI-COUNTRY:
// A listing belongs to one place, so this picker is scoped to the
// poster's own country rather than showing every live country. A seller
// in Gaborone picking "Harare" from a global list would be describing
// where their fridge is not.
//
// The 'Other' test now asks the loaded city list rather than the
// hardcoded constant, so a Botswana seller typing "Gumare" is correctly
// treated as a custom town instead of being silently compared against
// Zimbabwe's list.

import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { CITY_OTHER } from '../lib/cities';
import { citiesFor, useCountryData } from '../lib/countries';
import CityPicker from './CityPicker';

const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

export default function LocationPicker({
  value,
  onChange,
  placeholder = 'Select your city',
  country,
}: {
  value: string;
  onChange: (location: string) => void;
  placeholder?: string;
  // The poster's country. Undefined falls back to the default country
  // inside citiesFor(), which keeps every existing caller working
  // unchanged until it starts passing this.
  country?: string | null;
}) {
  const snap = useCountryData();
  const named = citiesFor(snap, country);

  function isNamedCity(v: string): boolean {
    return v !== CITY_OTHER && named.some((c) => !c.is_other && c.name === v);
  }

  // Held as state rather than derived from `value` on every render.
  // Derived would work until someone typed a town whose name happens to
  // be on the list — the field would flip back to a chip mid-word and
  // take the keyboard with it. Editing an older post whose location is
  // free text opens straight into Other, which is correct: that IS a
  // custom value.
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
        country={country}
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
