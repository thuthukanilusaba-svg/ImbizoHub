// app/feature-listing-pay.tsx
// Pay to feature a specific listing for 7 days.
//
// NEW: launch promotion — free until Jan 31, 2027, same window as the
// other four promo flows built today. See
// feature-listing-free-promo/index.ts for the full reasoning. Kept as
// a fully separate handler from handlePay(), same pattern used
// throughout today's promo work — handlePay() itself is completely
// untouched and ready to take over immediately once the promo ends.
//
// Usage: router.push(`/feature-listing-pay?listing_id=${id}`)

import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Platform, ScrollView, StyleSheet,
  Text, TouchableOpacity, View,
} from 'react-native';
import { extractFunctionError } from '../../lib/paymentError';
import { formatPrice } from '../../lib/money';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';
const GREEN = '#4fc96e';

const PRICE = 5;
const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 15;

const FREE_PROMO_END = new Date('2027-01-31T23:59:59Z');
const isPromoActive = () => new Date() < FREE_PROMO_END;

export default function FeatureListingPayScreen() {
  const router = useRouter();
  const { listing_id } = useLocalSearchParams<{ listing_id: string }>();
  const [loading, setLoading] = useState(true);
  const [myId, setMyId] = useState('');
  const [myEmail, setMyEmail] = useState('');
  const [listing, setListing] = useState<any>(null);
  const [error, setError] = useState('');
  const [paying, setPaying] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => { init(); }, []);

  async function init() {
    setLoading(true);
    setError('');

    if (!listing_id) { setError('No listing specified.'); setLoading(false); return; }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.is_anonymous) {
      router.push('/register');
      return;
    }
    setMyId(user.id);
    setMyEmail(user.email ?? '');

    const { data, error: fetchError } = await supabase
      .from('listings')
      .select('id, title, price, image_url, user_id, featured_until')
      .eq('id', listing_id)
      .maybeSingle();

    if (fetchError || !data) { setError('Listing not found.'); setLoading(false); return; }
    if (data.user_id !== user.id) { setError('You can only feature your own listings.'); setLoading(false); return; }

    setListing(data);
    setLoading(false);
  }

  async function handleFeatureFree() {
    setError('');
    setPaying(true);

    const { data, error: fnError } = await supabase.functions.invoke('feature-listing-free-promo', {
      body: {
        listing_id: listing.id,
        buyer_id: myId,
      },
    });

    setPaying(false);

    if (fnError || data?.error) {
      setError(await extractFunctionError(fnError, data, 'Could not feature this listing. Please try again.'));
      return;
    }

    setListing((prev: any) => ({ ...prev, featured_until: data.featured_until }));
    setSuccess(true);
  }

  async function handlePay() {
    setError('');
    setPaying(true);

    const { data, error: fnError } = await supabase.functions.invoke('create-payment', {
      body: {
        kind: 'featured_listing',
        amount: PRICE,
        email: myEmail,
        listing_id: listing.id,
        buyer_id: myId,
      },
    });

    if (fnError || !data?.checkoutUrl) {
      setError(await extractFunctionError(fnError, data, 'Could not start payment. Please try again.'));
      setPaying(false);
      return;
    }

    const { reference, checkoutUrl } = data;
    await WebBrowser.openBrowserAsync(checkoutUrl);

    setPaying(false);
    setVerifying(true);

    const paid = await pollForPaid(reference);

    setVerifying(false);

    if (paid) {
      setSuccess(true);
    } else {
      setError(
        'We haven\'t received confirmation of your payment yet. If you completed an EcoCash prompt on your phone, it can take a moment — try again in a few seconds, or check your Paynow confirmation email.'
      );
    }
  }

  async function pollForPaid(reference: string): Promise<boolean> {
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      const { data } = await supabase
        .from('payment_intents')
        .select('status')
        .eq('our_reference', reference)
        .maybeSingle();

      if (data?.status === 'paid') return true;
      if (data?.status === 'error' || data?.status === 'cancelled') return false;

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    return false;
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={GOLD} />
      </View>
    );
  }

  if (error && !listing) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>⚠️ {error}</Text>
        <TouchableOpacity style={styles.backLink} onPress={() => router.back()}>
          <Text style={styles.backLinkText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const alreadyFeatured = listing?.featured_until && new Date(listing.featured_until).getTime() > Date.now();

  if (success || alreadyFeatured) {
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}><Text style={styles.backArrow}>‹</Text> Back</Text>
          </TouchableOpacity>
          <View style={styles.successCard}>
            <Text style={styles.successEmoji}>⭐</Text>
            <Text style={styles.successTitle}>Your listing is Featured</Text>
            {listing?.featured_until && (
              <Text style={styles.successBody}>
                Live on Home until {new Date(listing.featured_until).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}
              </Text>
            )}
            <TouchableOpacity style={styles.doneBtn} onPress={() => router.replace('/')}>
              <Text style={styles.doneBtnText}>Back to home</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}><Text style={styles.backArrow}>‹</Text> Back</Text>
        </TouchableOpacity>

        <Text style={styles.heading}>Feature this listing</Text>
        <Text style={styles.subheading}>Show up in the Featured slot on Home for 7 days.</Text>

        <View style={styles.listingCard}>
          <Text style={styles.listingTitle}>{listing.title}</Text>
          <Text style={styles.listingPrice}>${formatPrice(listing.price)}</Text>
        </View>

        <View style={styles.priceCard}>
          <Text style={styles.priceLabel}>7 days Featured</Text>
          {isPromoActive() ? (
            <>
              <Text style={[styles.priceValue, { color: GREEN }]}>FREE</Text>
              <Text style={styles.priceNote}>Normally ${PRICE.toFixed(2)} — launch promo through Jan 31, 2027</Text>
            </>
          ) : (
            <Text style={styles.priceValue}>${PRICE.toFixed(2)}</Text>
          )}
        </View>

        {error ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>⚠️ {error}</Text></View>
        ) : null}

        <TouchableOpacity
          style={[styles.payBtn, (paying || verifying) && { opacity: 0.6 }]}
          onPress={isPromoActive() ? handleFeatureFree : handlePay}
          disabled={paying || verifying}
        >
          {paying || verifying
            ? <ActivityIndicator color={BLACK} />
            : isPromoActive()
            ? <Text style={styles.payBtnText}>Feature free — launch promo</Text>
            : <Text style={styles.payBtnText}>Pay ${PRICE.toFixed(2)} with Paynow</Text>
          }
        </TouchableOpacity>
        {verifying && <Text style={styles.verifyingNote}>Waiting for payment confirmation...</Text>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  content: { padding: 20, paddingTop: Platform.OS === 'ios' ? 56 : 40 },
  center: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', padding: 32 },

  backBtn: { marginBottom: 16 },
  backText: { color: GREY, fontSize: 14 },
  // NEW: bigger than the label text so the '‹' glyph reads clearly — direct product decision ("back symbol too small").
  backArrow: { fontSize: 20 },
  backLink: { marginTop: 16 },
  backLinkText: { color: GOLD, fontSize: 14 },
  heading: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 6 },
  subheading: { fontSize: 13, color: GREY, marginBottom: 24 },

  listingCard: { backgroundColor: BLACK, borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 0.5, borderColor: '#333' },
  listingTitle: { color: '#fff', fontSize: 15, fontWeight: '700', marginBottom: 4 },
  listingPrice: { color: GOLD, fontSize: 16, fontWeight: '800' },

  priceCard: { backgroundColor: DARK, borderRadius: 14, padding: 20, alignItems: 'center', marginBottom: 20, borderWidth: 1, borderColor: GOLD },
  priceLabel: { color: GREY, fontSize: 12, marginBottom: 6 },
  priceValue: { color: GOLD, fontSize: 32, fontWeight: '800' },
  priceNote: { color: GREY, fontSize: 11, marginTop: 6, textAlign: 'center' },

  errorBox: { backgroundColor: '#3a1a1a', borderRadius: 10, padding: 12, marginBottom: 16 },
  errorText: { color: '#ff8a8a', fontSize: 13, textAlign: 'center' },

  payBtn: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  payBtnText: { color: BLACK, fontSize: 15, fontWeight: '800' },
  verifyingNote: { color: GREY, fontSize: 12, textAlign: 'center', marginTop: 12 },

  successCard: { alignItems: 'center', paddingTop: 60 },
  successEmoji: { fontSize: 56, marginBottom: 16 },
  successTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 8 },
  successBody: { color: GREY, fontSize: 13, marginBottom: 28 },
  doneBtn: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32 },
  doneBtnText: { color: BLACK, fontSize: 14, fontWeight: '800' },
});