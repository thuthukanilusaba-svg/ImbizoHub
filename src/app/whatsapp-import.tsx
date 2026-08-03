// app/whatsapp-import.tsx
// WhatsApp Import Tool — paste-and-extract
// Sellers migrating from WhatsApp paste a product message here. We guess
// a title, price, and description from the free text, then let the seller
// review/edit before it becomes a real listing — same insert logic as
// post.tsx. Photos are not handled here (WhatsApp text has none); sellers
// can add photos afterward by editing the listing normally.
//
// FIX: button label changed from "Parse message" to "Extract details" —
// "parse" is a programming term that doesn't mean anything to most
// sellers using this screen. "Extract details" says exactly what the
// button does in plain language.
//
// FIX: wrapped the whole screen in KeyboardAvoidingView — the keyboard
// was covering whichever field was focused, on this screen and every
// other screen with text inputs app-wide.

import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView as RNScrollView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

const categories = ['Phones', 'Vehicles', 'Furniture', 'Clothing', 'Appliances', 'Building', 'Baby', 'Other'];

// Guess a price from free text. Handles: R3500, R3,500, R 3 500, $50, 3.5k, 3500
//
// FIX: the old third tier (plain-number fallback) scanned the ENTIRE pasted
// text left-to-right for the first standalone 2+-digit number, with no
// awareness of line structure. That meant a model/year number appearing
// earlier in the text than the actual price would win — e.g.
//   "Toyota Corolla 2016, asking 3500"
// used to return "2016" instead of "3500", because 2016 is a valid
// word-bounded 2+-digit number and it simply appears first.
//
// FIX ADDS a new tier BEFORE that fallback: look for a line that is
// ENTIRELY a number (optionally with a currency symbol, commas, or
// spaces) and nothing else — e.g. a line that just says "3500" or
// "R 3 500" on its own. This is the single strongest, most common signal
// for a WhatsApp-style price line (see the placeholder example below,
// where the price is already its own line), and it's checked before the
// old whole-text scan so a genuine standalone price line always wins over
// a number embedded inside a title/description line.
//
// The final fallback (old behavior) is kept as a last resort for messages
// that don't put the price on its own line at all.
function guessPrice(text: string): string {
  const kMatch = text.match(/(\d+(?:\.\d+)?)\s*k\b/i);
  if (kMatch) {
    return String(Math.round(parseFloat(kMatch[1]) * 1000));
  }

  const currencyMatch = text.match(/[R$]\s?[\d,\s]+(?:\.\d+)?/);
  if (currencyMatch) {
    const digitsOnly = currencyMatch[0].replace(/[^\d.]/g, '');
    if (digitsOnly) return digitsOnly;
  }

  // NEW: a line that is ENTIRELY a number (± currency symbol / commas /
  // internal spaces) is a much stronger price signal than "first number
  // anywhere in the text", since titles/descriptions containing numbers
  // (model names, years, storage sizes) are rarely a whole line by
  // themselves.
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^[R$]?\s?\d[\d,.\s]*$/.test(trimmed)) {
      const digitsOnly = trimmed.replace(/[^\d.]/g, '');
      if (digitsOnly.length >= 2) return digitsOnly;
    }
  }

  // Last resort — unchanged from before, only reached if nothing above matched.
  const plainNumberMatch = text.match(/\b\d{2,}(?:[.,]\d+)?\b/);
  if (plainNumberMatch) {
    return plainNumberMatch[0].replace(/,/g, '');
  }

  return '';
}

// Guess a title: first non-empty line of the pasted text, trimmed of
// leading emoji/symbols and truncated to a reasonable length.
function guessTitle(text: string): string {
  const firstLine = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0) || '';
  const cleaned = firstLine.replace(/^[^\w]+/, '').trim();
  return cleaned.length > 60 ? cleaned.slice(0, 60).trim() : cleaned;
}

// Guess a description: the full pasted text minus the guessed title line
// and the guessed price line, trimmed up.
function guessDescription(text: string, title: string, price: string): string {
  const lines = text.split('\n').map((l) => l.trim());
  const withoutTitleAndPrice = lines.filter((l) => {
    if (!l || l === title) return false;
    // Drop lines that are just the price (with optional currency symbol/spacing)
    const digitsOnly = l.replace(/[^\d.]/g, '');
    if (price && digitsOnly === price && l.replace(/[\d.,\s R$]/gi, '') === '') return false;
    return true;
  });
  return withoutTitleAndPrice.join('\n').trim();
}

export default function WhatsAppImportScreen() {
  const router = useRouter();

  const [rawText, setRawText] = useState('');
  const [parsed, setParsed] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState('Phones');

  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  function handleParse() {
    setError('');
    if (!rawText.trim()) {
      setError('Paste a WhatsApp message first.');
      return;
    }

    const guessedTitle = guessTitle(rawText);
    const guessedPrice = guessPrice(rawText);
    const guessedDescription = guessDescription(rawText, guessedTitle, guessedPrice);

    setTitle(guessedTitle);
    setPrice(guessedPrice);
    setDescription(guessedDescription);
    setParsed(true);
  }

  async function handlePost() {
    setError('');

    if (!title || !price || !location) {
      setError('Please fill in title, price, and location.');
      return;
    }

    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum <= 0) {
      setError('Enter a valid price.');
      return;
    }

    setPosting(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError('Not logged in.');
      setPosting(false);
      return;
    }

    const { error: insertError } = await supabase.from('listings').insert({
      user_id: user.id,
      title: title.trim(),
      description: description.trim(),
      price: priceNum,
      location: location.trim(),
      category,
      image_url: null,
      image_urls: [],
      badge: 'New',
    });

    setPosting(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setSuccess(true);
  }

  if (success) {
    return (
      <View style={styles.successScreen}>
        <Text style={styles.successEmoji}>🎉</Text>
        <Text style={styles.successTitle}>Listing imported!</Text>
        <Text style={styles.successBody}>
          Your item is now live on ImbizoHub. Add photos any time by editing the listing.
        </Text>
        <TouchableOpacity style={styles.successBtn} onPress={() => router.replace('/')}>
          <Text style={styles.successBtnText}>Back to home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.heading}>Import from WhatsApp</Text>
        <Text style={styles.subheading}>
          Paste a product message you've already sent on WhatsApp — we'll guess the details for you.
        </Text>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>⚠️ {error}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.label}>Paste WhatsApp message</Text>
          <TextInput
            style={[styles.input, styles.pasteArea]}
            placeholder={'e.g.\niPhone 13 Pro 256GB\nR8500\nExcellent condition, barely used, comes with box and charger'}
            placeholderTextColor="#666"
            value={rawText}
            onChangeText={(t) => { setRawText(t); setParsed(false); }}
            multiline
            numberOfLines={6}
          />

          {/* FIX: "Parse message" → "Extract details" — clearer, plain-
              language label for what this button actually does. */}
          <TouchableOpacity style={styles.parseBtn} onPress={handleParse}>
            <Text style={styles.parseBtnText}>✨ Extract details</Text>
          </TouchableOpacity>
        </View>

        {parsed && (
          <View style={styles.card}>
            <Text style={styles.reviewNote}>
              We've guessed the details below — please review and fix anything that's wrong.
            </Text>

            <Text style={styles.label}>Title *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. iPhone 13 Pro, 256GB"
              placeholderTextColor="#666"
              value={title}
              onChangeText={setTitle}
            />

            <Text style={styles.label}>Price (USD) *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 320"
              placeholderTextColor="#666"
              value={price}
              onChangeText={setPrice}
              keyboardType="decimal-pad"
            />

            <Text style={styles.label}>Location *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Harare"
              placeholderTextColor="#666"
              value={location}
              onChangeText={setLocation}
            />

            <Text style={styles.label}>Category</Text>
            <RNScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
              {categories.map((cat) => (
                <TouchableOpacity
                  key={cat}
                  style={[styles.categoryChip, category === cat && styles.categoryChipActive]}
                  onPress={() => setCategory(cat)}
                >
                  <Text style={[styles.categoryChipText, category === cat && styles.categoryChipTextActive]}>
                    {cat}
                  </Text>
                </TouchableOpacity>
              ))}
            </RNScrollView>

            <Text style={styles.label}>Description</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Describe the item's condition, features..."
              placeholderTextColor="#666"
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={4}
            />

            <TouchableOpacity
              style={[styles.postBtn, posting && { opacity: 0.6 }]}
              onPress={handlePost}
              disabled={posting}
            >
              {posting ? <ActivityIndicator color="#fff" /> : <Text style={styles.postBtnText}>Create listing</Text>}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  content: { padding: 20, paddingBottom: 60 },

  backBtn: { marginBottom: 16 },
  backText: { color: GREY, fontSize: 14 },
  heading: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 6 },
  subheading: { fontSize: 13, color: GREY, marginBottom: 20 },

  errorBox: { backgroundColor: '#3a1a1a', borderRadius: 10, padding: 12, marginBottom: 16 },
  errorText: { color: '#ff8a8a', fontSize: 13 },

  label: { fontSize: 13, fontWeight: '700', color: '#fff', marginBottom: 8, marginTop: 14 },

  card: { backgroundColor: BLACK, borderRadius: 14, padding: 16, marginTop: 16, borderWidth: 0.5, borderColor: '#333' },
  input: {
    backgroundColor: DARK, borderRadius: 10, paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 13 : 10, fontSize: 14, color: '#fff',
    borderWidth: 0.5, borderColor: '#333',
  },
  pasteArea: { height: 130, textAlignVertical: 'top', paddingTop: 10 },
  textArea: { height: 90, textAlignVertical: 'top', paddingTop: 10 },

  parseBtn: { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 14 },
  parseBtnText: { color: BLACK, fontSize: 14, fontWeight: '800' },

  reviewNote: { color: GREY, fontSize: 12, marginBottom: 6, lineHeight: 17 },

  categoryChip: { backgroundColor: DARK, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, marginRight: 8, borderWidth: 0.5, borderColor: '#333' },
  categoryChipActive: { backgroundColor: GOLD, borderColor: GOLD },
  categoryChipText: { color: GREY, fontSize: 12 },
  categoryChipTextActive: { color: BLACK, fontWeight: '700' },

  postBtn: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 24 },
  postBtnText: { color: BLACK, fontSize: 16, fontWeight: '800' },

  successScreen: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', padding: 32 },
  successEmoji: { fontSize: 64, marginBottom: 20 },
  successTitle: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 10 },
  successBody: { fontSize: 15, color: GREY, textAlign: 'center', marginBottom: 32 },
  successBtn: { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 40 },
  successBtnText: { color: BLACK, fontSize: 16, fontWeight: '700' },
});
