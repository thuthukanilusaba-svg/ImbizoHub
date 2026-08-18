// app/post-wanted.tsx
// "Wanted" tab — buyer posts what they're looking for. Free to post, no
// fee, no gate — mirrors hirevan.tsx's trip-request posting exactly.
// Sellers browse open wants in browse-wanted.tsx and respond with a
// price; the buyer can now chat with any responder immediately (see
// chat.tsx's item-request handling), and pays a small commission to
// accept one, unlocking contact info and fulfillment options. See the
// ImbizoHub_Wanted_Tab_Spec.md document for the full design.
//
// FIX (real bug): category defaulted to 'Phones' with nothing requiring
// an active selection before submitting — three real posts all landed
// under "Phones" simply because the default was never changed. Category
// now starts unselected and is required, same validation tier as title
// and location.
//
// FIX: link text simplified to just "Have something to sell?" — the
// longer version ("...instead? Browse wants →") wasn't what was wanted.
//
// FIX (real bug, found while making the above changes): the "View
// responses" button on the success screen linked to /wanted-responses
// with NO request_id param at all — that screen requires one
// (useLocalSearchParams<{ request_id: string }>()) and, combined with
// today's new ownership check there, would have shown "This isn't your
// wanted post" immediately after someone's own post succeeded. Now
// captures the real id from the insert and passes it through correctly.
//
// FIX: wrapped the whole screen in KeyboardAvoidingView — the keyboard
// was covering whichever field was focused, on this screen and every
// other screen with text inputs app-wide.
//
// FIX (product decision, chat.tsx updated to match): the info note
// below used to describe a chat model that no longer exists — chat used
// to be entirely unreachable until AFTER accepting a response, so
// "sellers who respond won't see your contact details" was really
// describing "you can't talk to them at all yet," not a genuine
// contact-info protection. Now chat opens immediately with any
// responder — buyer and seller can discuss details, ask questions,
// before any money changes hands. Contact info specifically (phone
// numbers, emails) is what stays protected in that chat until a
// response is accepted and the 5% commission is paid, exactly mirroring
// how a regular listing's unlock fee protects contact info the same
// way. The note now describes that accurately.

import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
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

export default function PostWantedScreen() {
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [budgetMin, setBudgetMin] = useState('');
  const [budgetMax, setBudgetMax] = useState('');
  const [location, setLocation] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [newRequestId, setNewRequestId] = useState<string | null>(null);

  async function handleSubmit() {
    setError('');

    if (!title.trim() || !location.trim()) {
      setError('Please enter at least a title and your location.');
      return;
    }

    if (!category) {
      setError('Please choose a category.');
      return;
    }

    const min = budgetMin ? parseFloat(budgetMin) : null;
    const max = budgetMax ? parseFloat(budgetMax) : null;
    if (min !== null && isNaN(min)) { setError('Enter a valid minimum budget, or leave it blank.'); return; }
    if (max !== null && isNaN(max)) { setError('Enter a valid maximum budget, or leave it blank.'); return; }
    if (min !== null && max !== null && min > max) { setError('Minimum budget can\'t be higher than maximum.'); return; }

    setLoading(true);

    let { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      const { data, error: signInError } = await supabase.auth.signInAnonymously();
      if (signInError) {
        setLoading(false);
        setError('Couldn\'t post — please check your connection and try again.');
        return;
      }
      user = data.user;
    }
    if (!user) {
      setLoading(false);
      setError('Something went wrong. Please try again.');
      return;
    }

    const { data: inserted, error: insertError } = await supabase
      .from('item_requests')
      .insert({
        user_id: user.id,
        title: title.trim(),
        description: description.trim(),
        category,
        budget_min: min,
        budget_max: max,
        location: location.trim(),
        status: 'open',
      })
      .select('id')
      .single();

    setLoading(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setNewRequestId(inserted?.id ?? null);
    setSuccess(true);
  }

  if (success) {
    return (
      <View style={styles.successScreen}>
        <Text style={styles.successEmoji}>🔍</Text>
        <Text style={styles.successTitle}>Your want has been posted!</Text>
        <Text style={styles.successSub}>
          Sellers can now see what you're looking for and respond with a price.
        </Text>
        <TouchableOpacity
          style={styles.successBtn}
          onPress={() => {
            if (newRequestId) {
              router.push(`/wanted-responses?request_id=${newRequestId}`);
            } else {
              router.push('/my-wanted-posts');
            }
          }}
        >
          <Text style={styles.successBtnText}>View responses</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.successBtnOutline}
          onPress={() => router.push('/')}
        >
          <Text style={styles.successBtnOutlineText}>Back to home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}><Text style={styles.backArrow}>‹</Text> Back</Text>
        </TouchableOpacity>

        <Text style={styles.heading}>Post what you're looking for</Text>
        <Text style={styles.subheading}>
          Tell sellers what you want — they'll respond with a price. Posting is always free.
        </Text>

        <TouchableOpacity onPress={() => router.push('/browse-wanted')} style={styles.browseLinkRow}>
          <Text style={styles.browseLinkText}>Have something to sell?</Text>
        </TouchableOpacity>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>⚠️ {error}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.label}>What are you looking for? *</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. iPhone 13, 128GB or bigger"
            placeholderTextColor="#666"
            value={title}
            onChangeText={setTitle}
          />

          <Text style={styles.label}>More details (optional)</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Condition, color, anything specific you need..."
            placeholderTextColor="#666"
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={4}
          />

          <Text style={styles.label}>Category *</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
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
          </ScrollView>
          {!category ? (
            <Text style={styles.categoryHint}>Tap a category above — required before posting.</Text>
          ) : null}

          <Text style={styles.label}>Budget (optional)</Text>
          <View style={styles.budgetRow}>
            <TextInput
              style={[styles.input, styles.budgetInput]}
              placeholder="Min $"
              placeholderTextColor="#666"
              value={budgetMin}
              onChangeText={setBudgetMin}
              keyboardType="decimal-pad"
            />
            <TextInput
              style={[styles.input, styles.budgetInput]}
              placeholder="Max $"
              placeholderTextColor="#666"
              value={budgetMax}
              onChangeText={setBudgetMax}
              keyboardType="decimal-pad"
            />
          </View>

          <Text style={styles.label}>Your location *</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Harare"
            placeholderTextColor="#666"
            value={location}
            onChangeText={setLocation}
          />
        </View>

        <View style={styles.infoBox}>
          {/* FIX: see top-of-file comment. Previous text described a
              chat model that no longer exists. */}
          <Text style={styles.infoText}>
            💬 You can chat with anyone who responds, right away — ask questions, discuss details.
            Contact details stay hidden until you accept a response and pay the small 5% commission.
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator color={BLACK} />
          ) : (
            <Text style={styles.submitText}>Post what I'm looking for</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  content: { padding: 20, paddingTop: Platform.OS === 'ios' ? 56 : 40, paddingBottom: 48 },

  backBtn: { marginBottom: 16 },
  backText: { color: GREY, fontSize: 14 },
  // NEW: bigger than the label text so the '‹' glyph reads clearly — direct product decision ("back symbol too small").
  backArrow: { fontSize: 20 },

  heading: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 6 },
  subheading: { fontSize: 13, color: GREY, marginBottom: 24, lineHeight: 19 },
  browseLinkRow: { marginBottom: 20, marginTop: -8 },
  browseLinkText: { color: GOLD, fontSize: 13, fontWeight: '600' },

  errorBox: { backgroundColor: '#3a1a1a', borderRadius: 10, padding: 12, marginBottom: 16 },
  errorText: { color: '#ff8a8a', fontSize: 13 },

  card: {
    backgroundColor: BLACK,
    borderRadius: 14,
    padding: 18,
    marginBottom: 16,
    borderWidth: 0.5,
    borderColor: '#333',
  },
  label: { fontSize: 13, fontWeight: '700', color: '#fff', marginBottom: 8, marginTop: 14 },
  input: {
    backgroundColor: DARK,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 13 : 10,
    fontSize: 14,
    color: '#fff',
    borderWidth: 0.5,
    borderColor: '#333',
  },
  textArea: { height: 90, textAlignVertical: 'top', paddingTop: 10 },

  categoryChip: { backgroundColor: DARK, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, marginRight: 8, borderWidth: 0.5, borderColor: '#333' },
  categoryChipActive: { backgroundColor: GOLD, borderColor: GOLD },
  categoryChipText: { color: GREY, fontSize: 12 },
  categoryChipTextActive: { color: BLACK, fontWeight: '700' },
  categoryHint: { color: '#ff8a8a', fontSize: 11, marginTop: 2, marginBottom: 4 },

  budgetRow: { flexDirection: 'row', gap: 10 },
  budgetInput: { flex: 1 },

  infoBox: { backgroundColor: '#1a1a2e', borderRadius: 10, padding: 14, marginBottom: 20, borderWidth: 0.5, borderColor: '#3a3a5e' },
  infoText: { color: '#8888ff', fontSize: 12, lineHeight: 18 },

  submitBtn: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  submitBtnDisabled: { opacity: 0.6 },
  submitText: { color: BLACK, fontSize: 16, fontWeight: '800' },

  successScreen: {
    flex: 1,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  successEmoji: { fontSize: 64, marginBottom: 20 },
  successTitle: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 10, textAlign: 'center' },
  successSub: { fontSize: 15, color: GREY, textAlign: 'center', lineHeight: 22, marginBottom: 32 },
  successBtn: {
    backgroundColor: GOLD,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 40,
    marginBottom: 12,
    width: '100%',
    alignItems: 'center',
  },
  successBtnText: { color: BLACK, fontSize: 16, fontWeight: '800' },
  successBtnOutline: {
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 40,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: GOLD,
  },
  successBtnOutlineText: { color: GOLD, fontSize: 16, fontWeight: '700' },
});
