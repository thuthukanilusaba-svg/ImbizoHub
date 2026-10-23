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
// response is accepted and the 5% commission (capped at $15, floored
// at $1.50 — see wanted-responses.tsx's COMMISSION_CAP/MIN) is paid,
// exactly mirroring how a regular listing's unlock fee protects
// contact info the same way. The note now describes that accurately.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
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
import { reportHandledError } from '../../lib/crashReporter';
import { checkListingContent } from '../../lib/contentSafety';
import LocationPicker from '../../components/LocationPicker';
import { CATEGORY_LABELS } from '../../lib/categories';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

// Labels only — these chips carry no icon. Shared so a category added
// here cannot go missing from the browse filters, which would leave
// posts that nobody can filter their way to.
const categories = CATEGORY_LABELS;

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

  // WhatsApp number for the success screen — see the block that renders
  // it below for why this is asked on web only, and asked after the post
  // rather than during it.
  const [contactPhone, setContactPhone] = useState('');
  const [savingPhone, setSavingPhone] = useState(false);
  const [phoneSaved, setPhoneSaved] = useState(false);
  const [phoneError, setPhoneError] = useState('');

  // ---- EDIT MODE -------------------------------------------------------
  //
  // Same screen, same form, reached as /post-wanted?edit=<id> from
  // my-wanted-posts.tsx. A second screen would have meant a second copy
  // of the validation, the content-safety check and the budget parsing,
  // and those are exactly the things that drift apart and then disagree
  // about what a valid post is.
  //
  // Editing is only OFFERED while a post has no responses — see the note
  // in my-wanted-posts.tsx. This screen does not re-check that: RLS
  // allows the owner to update their own row at any time, so a
  // hand-typed URL could edit a post that has been replied to. That is
  // an accepted limit, not an oversight: the row is still the owner's,
  // and the worst case is a buyer amending their own ask.
  const { edit: editId } = useLocalSearchParams<{ edit?: string }>();
  const isEditing = !!editId;
  const [loadingExisting, setLoadingExisting] = useState(!!editId);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (!editId) return;
    let alive = true;
    (async () => {
      const { data, error: fetchError } = await supabase
        .from('item_requests')
        .select('title, description, category, budget_min, budget_max, location')
        .eq('id', editId)
        .maybeSingle();
      if (!alive) return;
      if (fetchError || !data) {
        setLoadError('Could not load that post. It may have been deleted.');
        setLoadingExisting(false);
        return;
      }
      setTitle(data.title ?? '');
      setDescription(data.description ?? '');
      setCategory(data.category ?? '');
      // Numbers back to the strings the inputs hold. String(null) is
      // the literal 'null', which would show up in the field.
      setBudgetMin(data.budget_min == null ? '' : String(data.budget_min));
      setBudgetMax(data.budget_max == null ? '' : String(data.budget_max));
      setLocation(data.location ?? '');
      setLoadingExisting(false);
    })();
    return () => { alive = false; };
  }, [editId]);

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

    // Wanted posts go through the same trigger as listings, so they get
    // the same check here. See lib/contentSafety.ts.
    const unsafe = checkListingContent(title, description);
    if (unsafe) { setError(unsafe); return; }

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

    // Shared by both paths so the two can never disagree about what a
    // valid post looks like. status is NOT included on update: closing a
    // post is my-wanted-posts.tsx's job, and sending 'open' here would
    // quietly reopen a post the owner had closed.
    const fields = {
      title: title.trim(),
      description: description.trim(),
      category,
      budget_min: min,
      budget_max: max,
      location: location.trim(),
    };

    if (isEditing) {
      const { error: updateError } = await supabase
        .from('item_requests')
        .update(fields)
        .eq('id', editId);

      setLoading(false);

      if (updateError) {
        reportHandledError('post-wanted.edit', updateError, { id: editId });
        setError(updateError.message);
        return;
      }

      // Straight back to the list rather than the success screen, which
      // congratulates you on posting something you did not just post.
      router.back();
      return;
    }

    const { data: inserted, error: insertError } = await supabase
      .from('item_requests')
      .insert({ user_id: user.id, ...fields, status: 'open' })
      .select('id')
      .single();

    setLoading(false);

    if (insertError) {
      reportHandledError('post-wanted', insertError);
      setError(insertError.message);
      return;
    }

    setNewRequestId(inserted?.id ?? null);
    setSuccess(true);
  }

  // Saves the asker's WhatsApp number against their own want, into
  // item_request_contacts — a separate table, not a column on
  // item_requests, because item_requests is readable by the entire
  // internet (its policy is `using (true)` for anon and authenticated
  // alike). See the wanted_post_private_contact migration.
  //
  // Only the person who posted the want and an admin can read it back.
  // No seller ever sees it.
  async function saveContactPhone() {
    const raw = contactPhone.replace(/[\s()-]/g, '');

    // Mirrors item_request_contacts_phone_format exactly. Checked here
    // too so a typo comes back as a sentence rather than as a Postgres
    // constraint-violation string.
    if (!/^\+?[0-9]{9,15}$/.test(raw)) {
      setPhoneError('That doesn\'t look like a phone number. Try 0771234567 or +263771234567.');
      return;
    }
    if (!newRequestId) {
      setPhoneError('Something went wrong saving your number. Your post is still live.');
      return;
    }

    setPhoneError('');
    setSavingPhone(true);

    const { error: contactError } = await supabase
      .from('item_request_contacts')
      .insert({ item_request_id: newRequestId, phone: raw });

    setSavingPhone(false);

    if (contactError) {
      // Checked, not discarded. A write that matters and reports
      // nothing is how savePushToken hid a total failure for months.
      reportHandledError('post-wanted.contact', contactError, { id: newRequestId });
      setPhoneError('Could not save your number: ' + contactError.message);
      return;
    }

    setPhoneSaved(true);
  }

  // Editing opens on an empty form for as long as the fetch takes, and
  // an empty form is indistinguishable from "this post had no title".
  // Show a spinner instead of letting someone start typing over values
  // that are about to overwrite them.
  if (loadingExisting) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color={GOLD} />
      </View>
    );
  }

  if (success) {
    return (
      <View style={styles.successScreen}>
        <Text style={styles.successEmoji}>🔍</Text>
        <Text style={styles.successTitle}>Your want has been posted!</Text>
        <Text style={styles.successSub}>
          Sellers can now see what you're looking for and respond with a price.
        </Text>

        {/* WEB ONLY, AND AFTER THE POST — both deliberate.

            Web only, because a browser cannot receive a push from this
            app at all: lib/notifications.ts returns null on web before
            it even asks for permission, so no token is ever generated.
            Someone who posts a want from the website has no email, no
            phone and no push — if a seller replies, there is literally
            no way to tell them. That is not theoretical: a real request
            for a Samsung S21 Ultra came in from the web at 22:42 on
            22 Oct 2026 with no token on the account. On a phone the
            push already works and this would be friction asking for
            something we do not need.

            After the post, because asking for a number before it would
            cost posts. The want is already saved and live by the time
            this appears — skipping costs them nothing, and the field is
            attached to something real rather than guarding the door.

            The number is NEVER shown to sellers. If a responding seller
            could see it the deal would move to WhatsApp on first
            contact and never come back — no chat, no accept, no
            transaction, and no way to know the app did anything. */}
        {Platform.OS === 'web' && newRequestId ? (
          phoneSaved ? (
            <View style={styles.contactBox}>
              <Text style={styles.contactDone}>
                ✓ Saved. We'll message you on WhatsApp as soon as a seller sends a price.
              </Text>
            </View>
          ) : (
            <View style={styles.contactBox}>
              <Text style={styles.contactTitle}>Where should we send the prices?</Text>
              <Text style={styles.contactBody}>
                You're on the website, so we can't buzz your phone. Leave your WhatsApp number
                and we'll message you the moment a seller replies. Sellers never see it.
              </Text>
              <TextInput
                style={styles.contactInput}
                value={contactPhone}
                onChangeText={(t) => { setContactPhone(t); setPhoneError(''); }}
                placeholder="0771234567"
                placeholderTextColor="#666"
                keyboardType="phone-pad"
                autoComplete="tel"
              />
              {phoneError ? <Text style={styles.contactError}>{phoneError}</Text> : null}
              <TouchableOpacity
                style={[styles.contactBtn, savingPhone && { opacity: 0.6 }]}
                onPress={saveContactPhone}
                disabled={savingPhone}
              >
                {savingPhone
                  ? <ActivityIndicator color={BLACK} />
                  : <Text style={styles.contactBtnText}>Tell me when a price arrives</Text>}
              </TouchableOpacity>
              <Text style={styles.contactSkip}>
                Or skip — your post is already live either way.
              </Text>
            </View>
          )
        ) : null}

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

        <Text style={styles.heading}>
          {isEditing ? 'Edit what you\'re looking for' : 'Post what you\'re looking for'}
        </Text>
        <Text style={styles.subheading}>
          {isEditing
            ? 'Change the details and save. Sellers will see the updated version.'
            : 'Tell sellers what you want — they\'ll respond with a price. Posting is always free.'}
        </Text>

        {loadError ? <Text style={styles.errorText}>{loadError}</Text> : null}

        {/* Hidden while editing: this is a prompt to switch sides, and
            someone already in the middle of amending their own post is
            not looking for it. */}
        {isEditing ? null : (
          <TouchableOpacity onPress={() => router.push('/browse-wanted')} style={styles.browseLinkRow}>
            <Text style={styles.browseLinkText}>Have something to sell?</Text>
          </TouchableOpacity>
        )}

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
          {/* "Dates" added for services: the Wanted post that prompted the
              Services category was "Wedding Camera man", where the date is
              the single most important detail and the field did not ask
              for it. */}
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Condition, colour, dates — anything specific you need..."
            placeholderTextColor="#666"
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={4}
          />

          <Text style={styles.label}>Category *</Text>
          {/* Wraps rather than scrolls horizontally — see post.tsx's
              matching comment. This one mattered most: the category is
              REQUIRED here ("Tap a category above — required before
              posting"), and on web the chips past the visible edge
              could not be reached at all, so anyone whose want belonged
              in Building, Baby or Other was blocked from posting. */}
          <View style={styles.categoryWrap}>
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
          </View>
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

          {/* Was free text with placeholder "e.g. Harare", which is how
              the live data ended up holding 'bulawayo' next to
              'Bulawayo' and one row reading 'ghdxed'. See
              components/LocationPicker.tsx. */}
          <Text style={styles.label}>Your location *</Text>
          <LocationPicker
            value={location}
            onChange={setLocation}
            placeholder="Select your city"
          />
        </View>

        <View style={styles.infoBox}>
          {/* FIX: see top-of-file comment. Previous text described a
              chat model that no longer exists. */}
          <Text style={styles.infoText}>
            💬 Posting is free and chatting is free — talk to everyone who responds, ask
            questions, compare prices. You only pay once we've found you what you asked
            for: accept a price and it's 5% of it — at least $1.50, never more than $15.
            The seller keeps 100% of theirs.
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
            <Text style={styles.submitText}>
              {isEditing ? 'Save changes' : 'Post what I\'m looking for'}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  loadingScreen: { flex: 1, backgroundColor: '#111111', alignItems: 'center', justifyContent: 'center' },
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

  categoryWrap: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
  categoryChip: { backgroundColor: DARK, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, marginRight: 8, marginBottom: 8, borderWidth: 0.5, borderColor: '#333' },
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

  // Sits between the congratulations and the two buttons. Boxed and
  // slightly set back so it reads as an offer rather than as another
  // required step in a form they have already finished.
  contactBox: {
    backgroundColor: '#1c1c1c', borderRadius: 14, borderWidth: 0.5, borderColor: '#333',
    padding: 18, marginBottom: 24, width: '100%', maxWidth: 420, alignSelf: 'center',
  },
  contactTitle: { color: '#fff', fontSize: 15, fontWeight: '800', marginBottom: 6, textAlign: 'center' },
  contactBody: { color: GREY, fontSize: 12.5, lineHeight: 18, marginBottom: 14, textAlign: 'center' },
  contactInput: {
    backgroundColor: '#111', borderRadius: 10, borderWidth: 0.5, borderColor: '#3a3a3a',
    color: '#fff', fontSize: 15, paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 13 : 10, marginBottom: 12,
  },
  contactError: { color: '#ff8a8a', fontSize: 12, marginBottom: 10, lineHeight: 17 },
  contactBtn: { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  contactBtnText: { color: BLACK, fontSize: 14, fontWeight: '800' },
  contactSkip: { color: '#777', fontSize: 11.5, textAlign: 'center', marginTop: 10 },
  contactDone: { color: '#4fc96e', fontSize: 13, lineHeight: 19, textAlign: 'center' },
});
