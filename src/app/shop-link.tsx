// app/shop-link.tsx
//
// Claim and manage the short shop link — imbizohub.com/s/kombi-spares.
//
// WHAT THIS IS FOR, precisely: the seller storefront page at
// imbizohub.com/seller?id=<uuid> has existed and worked for every
// seller since 23 September 2026, catalogue and all. It is free and it
// stays free, because every seller who shares their page puts
// ImbizoHub in front of somebody who does not have it.
//
// What Dealer Pro sells is the ADDRESS, not the page. Nobody puts
// be32a5f4-9c1d-4f2a-... in a WhatsApp status. A dealer will happily
// type imbizohub.com/s/kombi-spares onto the side of a van.
//
// ─────────────────────────────────────────────────────────────────────
// THREE THINGS ENFORCE THIS, and only one of them is in this file:
//
//   1. enforce_slug_requires_dealer_pro (trigger) requires an unexpired
//      Dealer Pro before any non-null slug is written. service_role
//      bypasses it, so admin grants and the payment webhook still work.
//   2. prevent_profile_privilege_escalation (trigger) stops a user
//      setting dealer_pro_active on themselves. Without THAT, gating on
//      Dealer Pro would gate on a field the user controls, which is not
//      a gate. The two triggers only work as a pair.
//   3. This screen, which is a courtesy. It tells someone what is
//      happening before they tap Save, and it is not security.
//
// So this screen being wrong cannot hand out a link it should not. The
// worst it can do is confuse somebody.
// ─────────────────────────────────────────────────────────────────────
//
// NO NEW DEPENDENCIES ON PURPOSE. Sharing uses react-native's built-in
// Share on native and navigator.share / navigator.clipboard on web;
// WhatsApp goes through the universal wa.me URL, which works in both.
// expo-clipboard and expo-sharing would each be a new native module,
// and a new native module means a new build — this screen would then be
// unshippable over the air, which for a feature that is not open until
// February is a bad trade.
//
// react-native-web IGNORES Alert.alert's buttons array entirely (see
// the note in chat.tsx), so every confirmation and every result here is
// an inline component. Nothing in this file calls Alert.
//
// Usage: router.push('/shop-link')

import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Linking, Platform, ScrollView, Share, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import {
  normaliseSlug, shopLinkDisplay, shopLinkUrl, slugProblem,
  SHOP_LINK_HOST,
} from '../../lib/slug';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';
const GREEN = '#4fc96e';
const RED = '#ff8a8a';

// Long enough that a normal typing speed does not fire a query per
// keystroke, short enough that the answer is there by the time somebody
// has finished reading what they typed.
const CHECK_DEBOUNCE_MS = 400;

type Availability = 'idle' | 'checking' | 'free' | 'taken' | 'mine' | 'error';

export default function ShopLinkScreen() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [myId, setMyId] = useState('');
  const [fullName, setFullName] = useState('');
  const [savedSlug, setSavedSlug] = useState<string | null>(null);
  const [dealerProActive, setDealerProActive] = useState(false);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [availability, setAvailability] = useState<Availability>('idle');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [justSaved, setJustSaved] = useState(false);
  const [shareNote, setShareNote] = useState('');

  // Guards the debounced availability check against answering for a
  // value the user has already typed past. Without this, a slow reply
  // for "kom" can land after a fast reply for "kombi" and paint the
  // wrong verdict next to the right name.
  const checkSeq = useRef(0);

  const candidate = normaliseSlug(draft);
  const structural = slugProblem(candidate);

  useEffect(() => { init(); }, []);

  async function init() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || user.is_anonymous) {
      router.replace('/register');
      return;
    }

    setMyId(user.id);

    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, slug, dealer_pro_active, dealer_pro_expires_at')
      .eq('id', user.id)
      .maybeSingle();

    if (profile) {
      setFullName(profile.full_name ?? '');
      setSavedSlug(profile.slug ?? null);
      setDealerProActive(!!(
        profile.dealer_pro_active &&
        profile.dealer_pro_expires_at &&
        new Date(profile.dealer_pro_expires_at).getTime() > Date.now()
      ));
    }

    setLoading(false);
  }

  // ── availability ────────────────────────────────────────────────────
  // profiles is publicly selectable (profiles_select_all USING true), so
  // this works for any signed-in user and leaks nothing that the seller
  // page does not already show. It is advisory: the partial unique index
  // is what actually prevents two dealers holding one name, and a save
  // can still come back 23505 if somebody claimed it in the gap.
  const checkAvailability = useCallback(async (value: string) => {
    const seq = ++checkSeq.current;
    setAvailability('checking');

    const { data, error: qErr } = await supabase
      .from('profiles')
      .select('id')
      .eq('slug', value)
      .maybeSingle();

    if (seq !== checkSeq.current) return; // a later keystroke owns the field now

    if (qErr) { setAvailability('error'); return; }
    if (!data) { setAvailability('free'); return; }
    setAvailability(data.id === myId ? 'mine' : 'taken');
  }, [myId]);

  useEffect(() => {
    if (!editing) return;
    if (structural) { setAvailability('idle'); checkSeq.current++; return; }

    const t = setTimeout(() => checkAvailability(candidate), CHECK_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [candidate, structural, editing, checkAvailability]);

  // ── save ────────────────────────────────────────────────────────────
  async function save() {
    if (structural || saving) return;

    setSaving(true);
    setError('');

    // .select() so the row comes back AFTER the trigger has normalised
    // it. The stored value is the truth; showing the typed value would
    // print a link that is not the link.
    const { data, error: upErr } = await supabase
      .from('profiles')
      .update({ slug: candidate })
      .eq('id', myId)
      .select('slug')
      .single();

    setSaving(false);

    if (upErr) {
      setError(messageForSaveError(upErr));
      return;
    }

    setSavedSlug(data?.slug ?? candidate);
    setEditing(false);
    setJustSaved(true);
    setAvailability('idle');
  }

  async function clearSlug() {
    setSaving(true);
    setError('');

    // Clearing is always allowed by the trigger, deliberately — a dealer
    // whose Pro has lapsed must be able to take their link down.
    const { error: upErr } = await supabase
      .from('profiles')
      .update({ slug: null })
      .eq('id', myId);

    setSaving(false);

    if (upErr) { setError(messageForSaveError(upErr)); return; }

    setSavedSlug(null);
    setJustSaved(false);
    setEditing(false);
    setDraft('');
  }

  // ── sharing ─────────────────────────────────────────────────────────
  const liveUrl = savedSlug ? shopLinkUrl(savedSlug) : '';
  const shareMessage = savedSlug
    ? `${fullName ? fullName + ' — ' : ''}see what I have for sale: ${liveUrl}`
    : '';

  async function shareLink() {
    if (!savedSlug) return;
    setShareNote('');

    if (Platform.OS === 'web') {
      const nav: any = typeof navigator === 'undefined' ? null : navigator;
      try {
        if (nav?.share) {
          await nav.share({ title: fullName || 'My shop', text: shareMessage, url: liveUrl });
          return;
        }
        if (nav?.clipboard?.writeText) {
          await nav.clipboard.writeText(liveUrl);
          setShareNote('Link copied.');
          return;
        }
      } catch {
        // A cancelled share sheet throws. That is not an error worth
        // telling anybody about — fall through to the hint.
      }
      setShareNote('Press and hold the link above to copy it.');
      return;
    }

    try {
      await Share.share({ message: shareMessage });
    } catch {
      setShareNote('Could not open the share sheet.');
    }
  }

  function shareOnWhatsApp() {
    if (!savedSlug) return;
    // wa.me is the universal form: it opens the app when installed and
    // web.whatsapp.com when not, on every platform. A whatsapp:// scheme
    // would fail silently on desktop web, which is where half of these
    // links get typed out.
    Linking.openURL(`https://wa.me/?text=${encodeURIComponent(shareMessage)}`);
  }

  // ── render ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={GOLD} />
      </View>
    );
  }

  const suggestion = normaliseSlug(fullName);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}><Text style={styles.backArrow}>‹</Text> Back</Text>
        </TouchableOpacity>

        <Text style={styles.heading}>Your shop link</Text>
        <Text style={styles.subheading}>
          One short address for everything you have for sale. Put it in your
          WhatsApp status, on your van, on a flyer.
        </Text>

        {/* What the thing IS, shown before any of the machinery. Someone
            arriving here from a feature list has read one line about it. */}
        <View style={styles.exampleCard}>
          <Text style={styles.exampleLabel}>INSTEAD OF</Text>
          <Text style={styles.exampleBad} numberOfLines={1}>
            {SHOP_LINK_HOST}/seller?id=be32a5f4-9c1d-4f2a-…
          </Text>
          <Text style={[styles.exampleLabel, { marginTop: 14 }]}>YOU GET</Text>
          <Text style={styles.exampleGood}>
            {SHOP_LINK_HOST}/s/{savedSlug || (candidate && editing ? candidate : suggestion || 'kombi-spares')}
          </Text>
        </View>

        {!dealerProActive ? (
          // ── Not a Dealer Pro ──────────────────────────────────────────
          // Not a greyed-out version of the real form. A disabled input
          // reads as broken; a plain statement of what it costs and when
          // it opens reads as a plan. Nothing here can write a slug —
          // the trigger would refuse it anyway.
          <>
            <View style={styles.notOpenBox}>
              <Text style={styles.notOpenTitle}>Part of Dealer Pro</Text>
              <Text style={styles.notOpenBody}>
                Your seller page is already live and already free — anyone can
                open it and see everything you have listed. Dealer Pro is what
                gives that page a short name instead of a long one.
              </Text>
              <Text style={[styles.notOpenBody, { marginTop: 10 }]}>
                Dealer Pro opens in February 2027. Until 31 January everything
                on ImbizoHub is free anyway.
              </Text>
            </View>

            <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.push('/dealer-pro-pay')}>
              <Text style={styles.secondaryBtnText}>See what Dealer Pro includes ›</Text>
            </TouchableOpacity>
          </>
        ) : savedSlug && !editing ? (
          // ── Has a link ────────────────────────────────────────────────
          <>
            {justSaved && (
              <View style={styles.okBox}>
                <Text style={styles.okText}>✓ Saved. This link is live now.</Text>
              </View>
            )}

            <View style={styles.liveCard}>
              <Text style={styles.liveLabel}>YOUR LINK</Text>
              {/* selectable so press-and-hold copy works everywhere,
                  including the web build where Share is not implemented. */}
              <Text style={styles.liveUrl} selectable>{shopLinkDisplay(savedSlug)}</Text>
            </View>

            <TouchableOpacity style={styles.primaryBtn} onPress={shareOnWhatsApp}>
              <Text style={styles.primaryBtnText}>Share on WhatsApp</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.secondaryBtn} onPress={shareLink}>
              <Text style={styles.secondaryBtnText}>
                {Platform.OS === 'web' ? 'Copy link' : 'Share somewhere else'}
              </Text>
            </TouchableOpacity>

            {shareNote ? <Text style={styles.note}>{shareNote}</Text> : null}

            <TouchableOpacity
              style={styles.linkBtn}
              onPress={() => { setDraft(savedSlug); setEditing(true); setJustSaved(false); setError(''); }}
            >
              <Text style={styles.linkBtnText}>Change my link</Text>
            </TouchableOpacity>

            {/* Named plainly rather than hidden behind "advanced". The
                old link stops working the moment this is tapped, so the
                warning sits with the button, not in a dialog after it. */}
            <TouchableOpacity style={styles.linkBtn} onPress={clearSlug} disabled={saving}>
              <Text style={[styles.linkBtnText, { color: RED }]}>
                {saving ? 'Removing…' : 'Remove my link'}
              </Text>
            </TouchableOpacity>

            {error ? <View style={styles.errorBox}><Text style={styles.errorText}>⚠️ {error}</Text></View> : null}
          </>
        ) : (
          // ── Claiming or changing ─────────────────────────────────────
          <>
            {savedSlug && (
              <View style={styles.warnBox}>
                <Text style={styles.warnText}>
                  Changing this breaks the old link. Anything already printed
                  or forwarded with {shopLinkDisplay(savedSlug)} on it will
                  stop working.
                </Text>
              </View>
            )}

            <Text style={styles.lbl}>PICK YOUR NAME</Text>
            <View style={styles.inputRow}>
              <Text style={styles.inputPrefix}>/s/</Text>
              <TextInput
                style={styles.input}
                value={draft}
                onChangeText={(t) => { setDraft(t); setError(''); }}
                placeholder={suggestion || 'kombi-spares'}
                placeholderTextColor="#6F6F6A"
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                maxLength={60}
                returnKeyType="done"
                onSubmitEditing={save}
              />
            </View>

            {/* The normalised form, always visible while it differs from
                what was typed. Somebody typing "Kombi Spares" should see
                it become kombi-spares as they type, not discover it
                afterwards on a link they have already sent to someone. */}
            {candidate && candidate !== draft.trim() ? (
              <Text style={styles.note}>Will be saved as: {candidate}</Text>
            ) : null}

            <View style={styles.statusRow}>
              {structural ? (
                draft ? <Text style={styles.statusBad}>{structural}</Text> : null
              ) : availability === 'checking' ? (
                <Text style={styles.statusMuted}>Checking…</Text>
              ) : availability === 'free' ? (
                <Text style={styles.statusGood}>✓ {shopLinkDisplay(candidate)} is available</Text>
              ) : availability === 'mine' ? (
                <Text style={styles.statusMuted}>This is already your link.</Text>
              ) : availability === 'taken' ? (
                <Text style={styles.statusBad}>Taken. Try adding your town or what you sell.</Text>
              ) : availability === 'error' ? (
                <Text style={styles.statusMuted}>Couldn&apos;t check just now — you can still try saving.</Text>
              ) : null}
            </View>

            {error ? <View style={styles.errorBox}><Text style={styles.errorText}>⚠️ {error}</Text></View> : null}

            <TouchableOpacity
              style={[styles.primaryBtn, (!!structural || availability === 'taken' || saving) && { opacity: 0.5 }]}
              onPress={save}
              disabled={!!structural || availability === 'taken' || saving}
            >
              {saving
                ? <ActivityIndicator color={BLACK} />
                : <Text style={styles.primaryBtnText}>{savedSlug ? 'Save new link' : 'Claim this link'}</Text>}
            </TouchableOpacity>

            {savedSlug && (
              <TouchableOpacity
                style={styles.linkBtn}
                onPress={() => { setEditing(false); setError(''); setDraft(''); }}
              >
                <Text style={styles.linkBtnText}>Cancel</Text>
              </TouchableOpacity>
            )}

            <Text style={styles.rulesNote}>
              Letters, numbers and hyphens. 3 to 30 characters. Spaces and
              punctuation turn into hyphens automatically.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

// Postgres speaks in codes; the dealer needs a sentence. Every branch
// here corresponds to something the database really raises:
//
//   42501  enforce_slug_requires_dealer_pro — no unexpired Dealer Pro.
//   23505  the partial unique index — somebody else has it. Reachable
//          even after a "free" check, if they claimed it in between.
//   23514  profiles_slug_format or profiles_slug_not_reserved. The
//          constraint name distinguishes them, and it is worth
//          distinguishing: "reserved" and "wrong characters" send the
//          user to completely different next actions.
function messageForSaveError(err: any): string {
  const code = err?.code ?? '';
  const detail = `${err?.message ?? ''} ${err?.details ?? ''}`;

  if (code === '42501') {
    return 'A short shop link is a Dealer Pro feature. Dealer Pro opens in February 2027.';
  }
  if (code === '23505') {
    return 'Somebody claimed that name a moment ago. Try another.';
  }
  if (code === '23514') {
    if (detail.includes('not_reserved')) {
      return 'That name is reserved by ImbizoHub. Try adding your town or what you sell.';
    }
    return 'That name can only use letters, numbers and hyphens, 3 to 30 characters.';
  }
  return err?.message || 'Could not save that link. Please try again.';
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  content: { padding: 20, paddingTop: Platform.OS === 'ios' ? 56 : 40, paddingBottom: 60 },
  center: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },

  backBtn: { marginBottom: 16 },
  backText: { color: GREY, fontSize: 14 },
  backArrow: { fontSize: 20 },

  heading: { fontSize: 26, fontWeight: '800', color: '#fff', marginBottom: 6 },
  subheading: { fontSize: 13, color: GREY, marginBottom: 22, lineHeight: 19 },

  exampleCard: { backgroundColor: BLACK, borderRadius: 14, padding: 16, marginBottom: 20, borderWidth: 0.5, borderColor: '#333' },
  exampleLabel: { color: '#6F6F6A', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  exampleBad: { color: '#7d7d77', fontSize: 13, marginTop: 5, textDecorationLine: 'line-through' },
  exampleGood: { color: GOLD, fontSize: 15, fontWeight: '800', marginTop: 5 },

  notOpenBox: { backgroundColor: DARK, borderRadius: 14, padding: 18, borderWidth: 1, borderColor: '#3a3a36', marginBottom: 16 },
  notOpenTitle: { color: GOLD, fontSize: 15, fontWeight: '800', marginBottom: 8 },
  notOpenBody: { color: GREY, fontSize: 13, lineHeight: 19 },

  warnBox: { backgroundColor: '#332a18', borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: '#4a3c1e' },
  warnText: { color: '#e5c98a', fontSize: 12.5, lineHeight: 18 },

  okBox: { backgroundColor: '#17301f', borderRadius: 10, padding: 12, marginBottom: 16 },
  okText: { color: GREEN, fontSize: 13, fontWeight: '700' },

  liveCard: { backgroundColor: DARK, borderRadius: 14, padding: 18, marginBottom: 18, borderWidth: 1, borderColor: GOLD },
  liveLabel: { color: '#8d8d87', fontSize: 10, fontWeight: '800', letterSpacing: 1, marginBottom: 7 },
  liveUrl: { color: GOLD, fontSize: 17, fontWeight: '800' },

  lbl: { color: '#8d8d87', fontSize: 10, fontWeight: '800', letterSpacing: 1, marginBottom: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: BLACK, borderRadius: 12, borderWidth: 1, borderColor: '#3a3a36', paddingHorizontal: 14 },
  inputPrefix: { color: '#6F6F6A', fontSize: 15, fontWeight: '700' },
  // Explicit colour on BOTH the text and the placeholder. The contact
  // form on the marketing site shipped white text on a white panel and
  // nobody could see what they were typing; it is the same mistake to
  // make here, and it is invisible in code review.
  input: { flex: 1, color: '#fff', fontSize: 15, paddingVertical: 14, paddingHorizontal: 4 },

  statusRow: { minHeight: 22, marginTop: 10 },
  statusGood: { color: GREEN, fontSize: 12.5 },
  statusBad: { color: RED, fontSize: 12.5 },
  statusMuted: { color: GREY, fontSize: 12.5 },
  note: { color: GREY, fontSize: 12, marginTop: 8 },
  rulesNote: { color: '#6F6F6A', fontSize: 11.5, marginTop: 18, lineHeight: 17 },

  errorBox: { backgroundColor: '#3a1a1a', borderRadius: 10, padding: 12, marginTop: 14 },
  errorText: { color: RED, fontSize: 13 },

  primaryBtn: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 18 },
  primaryBtnText: { color: BLACK, fontSize: 15, fontWeight: '800' },
  secondaryBtn: { borderWidth: 1.5, borderColor: '#3a3a36', borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 10 },
  secondaryBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  linkBtn: { paddingVertical: 14, alignItems: 'center' },
  linkBtnText: { color: GOLD, fontSize: 13.5, fontWeight: '700' },
});
