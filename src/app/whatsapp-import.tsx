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
// FIX (14 Sep, found in testing — not a code defect, a missing
// guardrail): this screen always did insert({ user_id: user.id }), so
// every imported item becomes the importer's own listing. That is
// correct for the intended user — a trader migrating their own
// catalogue — but the screen said "paste your whole WhatsApp catalog"
// and never said whose items it expected. A tester pasted a WhatsApp
// GROUP, and 24 items belonging to other people went live under that
// tester's name: buyers messaged someone who had nothing to sell,
// their seller rating was exposed to deals they could not complete,
// and the Meet & Pay handover PIN meant nothing because they held no
// goods. Fixed by stating the rule (note above the paste box) and
// requiring it to be acknowledged (ownItems checkbox, enforced again
// in handlePostAll). Deliberately NOT solved by letting people post on
// someone else's behalf — that is a real design question, and it
// collides with the paid contact-unlock model.
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
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { checkListingContent } from '../../lib/contentSafety';
import LocationPicker from '../../components/LocationPicker';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';
import { CATEGORY_LABELS } from '../../lib/categories';

const GREEN = '#4fc96e';
const RED = '#ff8a8a';

// Labels only — these chips carry no icon. Shared so a category added
// here cannot go missing from the browse filters, which would leave
// posts that nobody can filter their way to.
const categories = CATEGORY_LABELS;

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

  // Must be ticked before anything is imported. See the note rendered
  // above the paste box for why this exists — a tester pasted a
  // WhatsApp GROUP rather than their own catalogue and 24 other
  // people's items went live under their name. Deliberately NOT
  // remembered between visits: it is a statement about the specific
  // items being imported right now, not a preference.
  const [ownItems, setOwnItems] = useState(false);

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

    // Checked here as well as in the disabled button, not instead of
    // it. The button is the affordance; this is the guarantee. Nothing
    // reaches the listings table without the person having said these
    // items are theirs.
    if (!ownItems) {
      setError('Confirm these are your own items before importing.');
      return;
    }

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
      // This screen matters more than the others for this check: the
      // text comes from a pasted WhatsApp export, so the person
      // importing it did not write it and may not have read it. Caught
      // before the loop starts, so an import never half-completes on a
      // row the database is going to refuse anyway.
      const unsafe = checkListingContent(it.title, it.description);
      if (unsafe) {
        setError(`"${it.title || 'One item'}": ${unsafe}`);
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

    // BADGE FIX (23 Sep 2026). This screen hardcoded badge:'New' for every
    // imported row, while post.tsx reads Dealer Pro status and stamps
    // 'Dealer'. The result was backwards: a Pro seller's BULK catalogue —
    // the largest part of their inventory, and the reason they bought Pro
    // — carried no badge, while the handful posted by hand did.
    //
    // Fetched once before the loop: a sixty-item import would otherwise
    // make sixty identical profile queries, and the answer cannot change
    // halfway through.
    const { data: posterProfile } = await supabase
      .from('profiles')
      .select('dealer_pro_active, dealer_pro_expires_at')
      .eq('id', user.id)
      .maybeSingle();

    const posterIsDealerPro = !!(
      posterProfile?.dealer_pro_active &&
      posterProfile?.dealer_pro_expires_at &&
      new Date(posterProfile.dealer_pro_expires_at).getTime() > Date.now()
    );

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
        badge: posterIsDealerPro ? 'Dealer' : 'New',
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

        <Text style={styles.heading}>Import your own items</Text>
        <Text style={styles.subheading}>
          Paste your own WhatsApp catalogue — one item or twenty. Separate each product with a blank
          line and we'll split them out automatically.
        </Text>

        {/* WHY THIS IS HERE (found in testing, 14 Sep): a tester pasted
            a WhatsApp GROUP rather than their own catalogue, and 24
            other people's items went live under the tester's name. The
            screen said "your whole WhatsApp catalog" and then quietly
            did insert({ user_id: user.id }) — the assumption lived only
            in the copy, never stated and never enforced. Buyers then
            messaged someone with nothing to sell, that person's seller
            rating was exposed to deals they could not complete, and the
            handover PIN was meaningless because they held no goods.
            Saying it plainly costs one paragraph. */}
        <View style={styles.ownershipNote}>
          <Text style={styles.ownershipNoteText}>
            Everything you import is posted as <Text style={styles.ownershipNoteStrong}>your</Text> listing.
            Buyers message you, and you arrange the payment and handover — so only import items you are
            selling yourself, not items other people posted in a group.
          </Text>
        </View>

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
            {/* Was free text with placeholder "e.g. Harare", like post.tsx
                and post-wanted.tsx before they were wired to this picker.
                Free text is what produced 'Bulawayo' and 'bulawayo' as two
                separate cities in the live data, plus 'ghdxed' and a
                browser-autofilled 'Burbank'. This screen is the worst place
                to leave it: one careless entry here is applied to EVERY
                item in the import at once. */}
            <LocationPicker
              value={sharedLocation}
              onChange={setSharedLocation}
              placeholder="Select the city for all items"
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
                <LocationPicker
                  value={item.location}
                  onChange={(v) => updateItem(item.key, 'location', v)}
                  placeholder="Select the city"
                />
              </>
            )}
            {items.length > 1 && (
              <>
                <Text style={styles.label}>Location override (optional)</Text>
                <LocationPicker
                  value={item.location}
                  onChange={(v) => updateItem(item.key, 'location', v)}
                  placeholder={sharedLocation || 'Uses the shared location above'}
                />
                {/* A picker has no empty option, so without this there is
                    no way back to the shared location once one is chosen
                    by mistake — the free-text field it replaces could just
                    be cleared. Shown only when there is something to
                    clear. */}
                {item.location ? (
                  <TouchableOpacity onPress={() => updateItem(item.key, 'location', '')}>
                    <Text style={styles.clearOverride}>
                      ← Use the shared location instead
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </>
            )}

            <Text style={styles.label}>Category</Text>
            {/* Wraps rather than scrolls horizontally — see post.tsx's
                matching comment. */}
            <View style={styles.categoryWrap}>
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
            </View>

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
            style={styles.ownCheckRow}
            onPress={() => setOwnItems((v) => !v)}
            activeOpacity={0.7}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: ownItems }}
            accessibilityLabel="These are my own items and I can sell them"
          >
            <View style={[styles.ownCheckBox, ownItems && styles.ownCheckBoxOn]}>
              {ownItems ? <Text style={styles.ownCheckTick}>✓</Text> : null}
            </View>
            <Text style={styles.ownCheckText}>
              These are my own items. I have them, and I'll deal with buyers myself.
            </Text>
          </TouchableOpacity>
        )}

        {parsed && items.length > 0 && (
          <TouchableOpacity
            // marginTop trimmed because the confirmation row directly
            // above already carries the 24 this button used to need.
            style={[styles.postBtn, { marginTop: 12 }, (posting || !ownItems) && { opacity: 0.45 }]}
            onPress={handlePostAll}
            disabled={posting || !ownItems}
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
  clearOverride: { color: GOLD, fontSize: 12, fontWeight: '700', marginTop: 8 },

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

  categoryWrap: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
  categoryChip: { backgroundColor: DARK, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, marginRight: 8, marginBottom: 8, borderWidth: 0.5, borderColor: '#333' },
  categoryChipActive: { backgroundColor: GOLD, borderColor: GOLD },
  categoryChipText: { color: GREY, fontSize: 12 },
  categoryChipTextActive: { color: BLACK, fontWeight: '700' },

  // Sits above the paste box, before anything has been typed — the
  // point is to be read BEFORE a group gets pasted, not after.
  ownershipNote: {
    backgroundColor: '#3a2800', borderRadius: 12, padding: 14,
    marginTop: 14, borderWidth: 0.5, borderColor: GOLD,
  },
  ownershipNoteText: { color: '#f0dca8', fontSize: 12.5, lineHeight: 19 },
  ownershipNoteStrong: { fontWeight: '800', color: GOLD },

  ownCheckRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginTop: 24, paddingVertical: 4,
  },
  ownCheckBox: {
    width: 24, height: 24, borderRadius: 6, borderWidth: 1.5,
    borderColor: GREY, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  ownCheckBoxOn: { backgroundColor: GOLD, borderColor: GOLD },
  ownCheckTick: { color: BLACK, fontSize: 15, fontWeight: '900' },
  ownCheckText: { color: '#e8e8e8', fontSize: 13, flex: 1, lineHeight: 18 },

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
