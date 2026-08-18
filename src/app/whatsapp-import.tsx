// app/whatsapp-import.tsx
// WhatsApp Import Tool — paste-and-extract, now with BULK support.
//
// NEW (leaning harder into this as the real acquisition wedge it is):
// this used to handle exactly one product per paste. A seller with a
// real WhatsApp catalog — the actual target user for this feature —
// doesn't have one product, they have ten or twenty, usually pasted
// together separated by blank lines between each one (the natural way
// people copy a series of WhatsApp status posts or catalog messages).
// The old version forced them to repeat the single-item flow once per
// product, which meant migrating a real catalog was barely faster than
// just using post.tsx directly — the entire point of this screen.
//
// splitIntoItems() below detects blank-line-separated blocks first
// (the strongest, most common real-world signal), falling back to
// numbered-list markers (1. / 2) / etc.) if no blank-line blocks are
// found. If only one item is detected either way, this renders
// EXACTLY the same single-item review form as before — nothing changes
// for the simple case, this is additive only.
//
// FIX: button label changed from "Parse message" to "Extract details" —
// "parse" is a programming term that doesn't mean anything to most
// sellers using this screen. "Extract details" says exactly what the
// button does in plain language.
//
// FIX: wrapped the whole screen in KeyboardAvoidingView — the keyboard
// was covering whichever field was focused, on this screen and every
// other screen with text inputs app-wide.
//
// FIX (real bug, found during a full-codebase sweep): this screen
// creates real `listings` rows — functionally identical to post.tsx —
// but was missing post.tsx's explicit "requires a REAL (non-anonymous)
// account" check entirely (only checked `!user`, not
// `user.is_anonymous`). post.tsx's own header comment lays out exactly
// why that matters: a listing is persistent inventory an anonymous,
// unrecoverable session could never manage again. That reasoning
// applies at least as strongly here, since this screen can create many
// listings in one bulk import rather than just one. Now requires a real
// account before posting, same as post.tsx.

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
const GREEN = '#4fc96e';
const RED = '#ff8a8a';

const categories = ['Phones', 'Vehicles', 'Furniture', 'Clothing', 'Appliances', 'Building', 'Baby', 'Other'];

// NEW: splits a pasted block of text into separate items, for bulk
// catalog imports. Two heuristics, tried in order:
//   1. Blank-line-separated blocks — the strongest signal, since this
//      is how people naturally paste a series of individual WhatsApp
//      messages/status posts one after another.
//   2. Numbered-list markers at the start of a line ("1.", "2)", "3 -")
//      — the other common way a seller might type out a quick catalog
//      list directly rather than pasting separate messages.
// If neither heuristic finds more than one block, the whole text is
// treated as a single item — identical to the screen's original
// behavior.
function splitIntoItems(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // Heuristic 1: blank-line-separated blocks.
  const blankLineBlocks = trimmed
    .split(/\n\s*\n+/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  if (blankLineBlocks.length > 1) {
    return blankLineBlocks;
  }

  // Heuristic 2: numbered-list markers at the START of a line only
  // (not just anywhere a digit appears, which would wrongly split on
  // model numbers or years inside a single item's own description).
  const numberedMarker = /^\s*\d{1,2}[.)\-]\s+/;
  const lines = trimmed.split('\n');
  const hasMultipleMarkers = lines.filter((l) => numberedMarker.test(l)).length > 1;

  if (hasMultipleMarkers) {
    const blocks: string[] = [];
    let current: string[] = [];
    for (const line of lines) {
      if (numberedMarker.test(line)) {
        if (current.length > 0) blocks.push(current.join('\n').trim());
        current = [line.replace(numberedMarker, '')];
      } else {
        current.push(line);
      }
    }
    if (current.length > 0) blocks.push(current.join('\n').trim());
    return blocks.filter((b) => b.length > 0);
  }

  // Nothing multi-item detected — treat the whole paste as one item,
  // exactly like the original single-item-only version did.
  return [trimmed];
}

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

  const lines = text.split('\n');
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;
    if (/^[R$]?\s?\d[\d,.\s]*$/.test(trimmedLine)) {
      const digitsOnly = trimmedLine.replace(/[^\d.]/g, '');
      if (digitsOnly.length >= 2) return digitsOnly;
    }
  }

  const plainNumberMatch = text.match(/\b\d{2,}(?:[.,]\d+)?\b/);
  if (plainNumberMatch) {
    return plainNumberMatch[0].replace(/,/g, '');
  }

  return '';
}

function guessTitle(text: string): string {
  const firstLine = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0) || '';
  const cleaned = firstLine.replace(/^[^\w]+/, '').trim();
  return cleaned.length > 60 ? cleaned.slice(0, 60).trim() : cleaned;
}

function guessDescription(text: string, title: string, price: string): string {
  const lines = text.split('\n').map((l) => l.trim());
  const withoutTitleAndPrice = lines.filter((l) => {
    if (!l || l === title) return false;
    const digitsOnly = l.replace(/[^\d.]/g, '');
    if (price && digitsOnly === price && l.replace(/[\d.,\s R$]/gi, '') === '') return false;
    return true;
  });
  return withoutTitleAndPrice.join('\n').trim();
}

type ParsedItem = {
  key: string;
  title: string;
  price: string;
  description: string;
  location: string;
  category: string;
  include: boolean;
};

export default function WhatsAppImportScreen() {
  const router = useRouter();

  const [rawText, setRawText] = useState('');
  const [parsed, setParsed] = useState(false);

  // NEW: single shared location, applied to every item at once —
  // sellers doing a bulk catalog import are overwhelmingly selling
  // from one place, so asking for it once instead of per-item removes
  // real repetitive friction from exactly the workflow this feature
  // is meant to speed up.
  const [sharedLocation, setSharedLocation] = useState('');

  // NEW: an array now, instead of individual title/price/description/
  // category fields — holds one or many parsed items depending on
  // what splitIntoItems() found. The single-item case is just this
  // array with length 1, rendered as the same review form as before.
  const [items, setItems] = useState<ParsedItem[]>([]);

  const [posting, setPosting] = useState(false);
  const [postProgress, setPostProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [successCount, setSuccessCount] = useState(0);

  function handleParse() {
    setError('');
    if (!rawText.trim()) {
      setError('Paste one or more WhatsApp messages first.');
      return;
    }

    const blocks = splitIntoItems(rawText);
    if (blocks.length === 0) {
      setError('Couldn\'t find anything to import in that text.');
      return;
    }

    const parsedItems: ParsedItem[] = blocks.map((block, i) => {
      const guessedTitle = guessTitle(block);
      const guessedPrice = guessPrice(block);
      const guessedDescription = guessDescription(block, guessedTitle, guessedPrice);
      return {
        key: `${Date.now()}-${i}`,
        title: guessedTitle,
        price: guessedPrice,
        description: guessedDescription,
        location: '',
        category: 'Phones',
        include: true,
      };
    });

    setItems(parsedItems);
    setParsed(true);
  }

  function updateItem(key: string, field: keyof ParsedItem, value: string | boolean) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, [field]: value } : it)));
  }

  function removeItem(key: string) {
    setItems((prev) => prev.filter((it) => it.key !== key));
  }

  async function handlePostAll() {
    setError('');

    const toPost = items.filter((it) => it.include);
    if (toPost.length === 0) {
      setError('Nothing selected to import.');
      return;
    }

    // Validate every item before posting any of them — a bulk import
    // failing halfway through, with some listings created and others
    // silently skipped, would be a confusing, hard-to-diagnose result
    // for someone importing a real catalog. All-or-nothing is the
    // safer behavior here.
    for (const it of toPost) {
      const loc = it.location.trim() || sharedLocation.trim();
      if (!it.title.trim() || !it.price.trim() || !loc) {
        setError(`"${it.title || 'One item'}" is missing a title, price, or location — fix it before importing.`);
        return;
      }
      if (isNaN(parseFloat(it.price)) || parseFloat(it.price) <= 0) {
        setError(`"${it.title}" has an invalid price.`);
        return;
      }
    }

    setPosting(true);
    setPostProgress({ done: 0, total: toPost.length });

    const { data: { user } } = await supabase.auth.getUser();
    // FIX: was `if (!user)`, missing user.is_anonymous — see top-of-file
    // comment. Matches post.tsx's requirement of a real account before
    // creating listings.
    if (!user || user.is_anonymous) {
      setPosting(false);
      router.push('/register');
      return;
    }

    let completed = 0;
    for (const it of toPost) {
      const loc = it.location.trim() || sharedLocation.trim();
      const { error: insertError } = await supabase.from('listings').insert({
        user_id: user.id,
        title: it.title.trim(),
        description: it.description.trim(),
        price: parseFloat(it.price),
        location: loc,
        category: it.category,
        image_url: null,
        image_urls: [],
        badge: 'New',
      });

      if (insertError) {
        setPosting(false);
        setError(`Failed on "${it.title}": ${insertError.message}. ${completed} of ${toPost.length} were already imported successfully.`);
        return;
      }

      completed++;
      setPostProgress({ done: completed, total: toPost.length });
    }

    setPosting(false);
    setSuccessCount(completed);
    setSuccess(true);
  }

  if (success) {
    return (
      <View style={styles.successScreen}>
        <Text style={styles.successEmoji}>🎉</Text>
        <Text style={styles.successTitle}>
          {successCount === 1 ? 'Listing imported!' : `${successCount} listings imported!`}
        </Text>
        <Text style={styles.successBody}>
          {successCount === 1
            ? 'Your item is now live on ImbizoHub. Add photos any time by editing the listing.'
            : 'Your catalog is now live on ImbizoHub. Add photos to each listing any time by editing it.'}
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
          <Text style={styles.backText}><Text style={styles.backArrow}>‹</Text> Back</Text>
        </TouchableOpacity>

        <Text style={styles.heading}>Import from WhatsApp</Text>
        <Text style={styles.subheading}>
          Paste your whole WhatsApp catalog at once — one item or twenty. Separate each product with a
          blank line and we'll split them out automatically.
        </Text>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>⚠️ {error}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.label}>Paste WhatsApp message(s)</Text>
          <TextInput
            style={[styles.input, styles.pasteArea]}
            placeholder={'e.g.\niPhone 13 Pro 256GB\nR8500\nExcellent condition, barely used\n\nSamsung Galaxy S21\nR6000\nGood condition, small crack on back'}
            placeholderTextColor="#666"
            value={rawText}
            onChangeText={(t) => { setRawText(t); setParsed(false); }}
            multiline
            numberOfLines={8}
          />

          <TouchableOpacity style={styles.parseBtn} onPress={handleParse}>
            <Text style={styles.parseBtnText}>✨ Extract details</Text>
          </TouchableOpacity>
        </View>

        {parsed && items.length > 1 && (
          <View style={styles.card}>
            <Text style={styles.reviewNote}>
              Found {items.length} items — review each one below, uncheck any you don't want to import.
            </Text>
            <Text style={styles.label}>Location (applies to all, unless overridden below)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Harare"
              placeholderTextColor="#666"
              value={sharedLocation}
              onChangeText={setSharedLocation}
            />
          </View>
        )}

        {parsed && items.map((item, idx) => (
          <View key={item.key} style={styles.card}>
            {items.length > 1 && (
              <View style={styles.itemHeader}>
                <TouchableOpacity
                  style={styles.includeToggle}
                  onPress={() => updateItem(item.key, 'include', !item.include)}
                >
                  <View style={[styles.checkbox, item.include && styles.checkboxChecked]}>
                    {item.include && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                  <Text style={styles.itemHeaderText}>Item {idx + 1} of {items.length}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => removeItem(item.key)}>
                  <Text style={styles.removeText}>Remove</Text>
                </TouchableOpacity>
              </View>
            )}

            {items.length === 1 && (
              <Text style={styles.reviewNote}>
                We've guessed the details below — please review and fix anything that's wrong.
              </Text>
            )}

            <Text style={styles.label}>Title *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. iPhone 13 Pro, 256GB"
              placeholderTextColor="#666"
              value={item.title}
              onChangeText={(v) => updateItem(item.key, 'title', v)}
            />

            <Text style={styles.label}>Price (USD) *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 320"
              placeholderTextColor="#666"
              value={item.price}
              onChangeText={(v) => updateItem(item.key, 'price', v)}
              keyboardType="decimal-pad"
            />

            {items.length === 1 && (
              <>
                <Text style={styles.label}>Location *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Harare"
                  placeholderTextColor="#666"
                  value={item.location}
                  onChangeText={(v) => updateItem(item.key, 'location', v)}
                />
              </>
            )}
            {items.length > 1 && (
              <>
                <Text style={styles.label}>Location override (optional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder={sharedLocation || 'Uses the shared location above'}
                  placeholderTextColor="#666"
                  value={item.location}
                  onChangeText={(v) => updateItem(item.key, 'location', v)}
                />
              </>
            )}

            <Text style={styles.label}>Category</Text>
            <RNScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
              {categories.map((cat) => (
                <TouchableOpacity
                  key={cat}
                  style={[styles.categoryChip, item.category === cat && styles.categoryChipActive]}
                  onPress={() => updateItem(item.key, 'category', cat)}
                >
                  <Text style={[styles.categoryChipText, item.category === cat && styles.categoryChipTextActive]}>
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
              value={item.description}
              onChangeText={(v) => updateItem(item.key, 'description', v)}
              multiline
              numberOfLines={4}
            />
          </View>
        ))}

        {parsed && items.length > 0 && (
          <TouchableOpacity
            style={[styles.postBtn, posting && { opacity: 0.6 }]}
            onPress={handlePostAll}
            disabled={posting}
          >
            {posting ? (
              <>
                <ActivityIndicator color="#fff" />
                <Text style={styles.postBtnSub}>{postProgress.done} of {postProgress.total} imported…</Text>
              </>
            ) : (
              <Text style={styles.postBtnText}>
                {items.filter((i) => i.include).length === 1
                  ? 'Create listing'
                  : `Create ${items.filter((i) => i.include).length} listings`}
              </Text>
            )}
          </TouchableOpacity>
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
  // NEW: bigger than the label text so the '‹' glyph reads clearly — direct product decision ("back symbol too small").
  backArrow: { fontSize: 20 },
  heading: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 6 },
  subheading: { fontSize: 13, color: GREY, marginBottom: 20, lineHeight: 19 },

  errorBox: { backgroundColor: '#3a1a1a', borderRadius: 10, padding: 12, marginBottom: 16 },
  errorText: { color: RED, fontSize: 13 },

  label: { fontSize: 13, fontWeight: '700', color: '#fff', marginBottom: 8, marginTop: 14 },

  card: { backgroundColor: BLACK, borderRadius: 14, padding: 16, marginTop: 16, borderWidth: 0.5, borderColor: '#333' },
  input: {
    backgroundColor: DARK, borderRadius: 10, paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 13 : 10, fontSize: 14, color: '#fff',
    borderWidth: 0.5, borderColor: '#333',
  },
  pasteArea: { height: 160, textAlignVertical: 'top', paddingTop: 10 },
  textArea: { height: 90, textAlignVertical: 'top', paddingTop: 10 },

  parseBtn: { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 14 },
  parseBtnText: { color: BLACK, fontSize: 14, fontWeight: '800' },

  reviewNote: { color: GREY, fontSize: 12, marginBottom: 6, lineHeight: 17 },

  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  includeToggle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: '#555', alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: GOLD, borderColor: GOLD },
  checkmark: { color: BLACK, fontSize: 12, fontWeight: '800' },
  itemHeaderText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  removeText: { color: RED, fontSize: 12, fontWeight: '600' },

  categoryChip: { backgroundColor: DARK, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, marginRight: 8, borderWidth: 0.5, borderColor: '#333' },
  categoryChipActive: { backgroundColor: GOLD, borderColor: GOLD },
  categoryChipText: { color: GREY, fontSize: 12 },
  categoryChipTextActive: { color: BLACK, fontWeight: '700' },

  postBtn: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 24, flexDirection: 'row', justifyContent: 'center', gap: 10 },
  postBtnText: { color: BLACK, fontSize: 16, fontWeight: '800' },
  postBtnSub: { color: BLACK, fontSize: 13, fontWeight: '700' },

  successScreen: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', padding: 32 },
  successEmoji: { fontSize: 64, marginBottom: 20 },
  successTitle: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 10, textAlign: 'center' },
  successBody: { fontSize: 15, color: GREY, textAlign: 'center', marginBottom: 32 },
  successBtn: { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 40 },
  successBtnText: { color: BLACK, fontSize: 16, fontWeight: '700' },
});
