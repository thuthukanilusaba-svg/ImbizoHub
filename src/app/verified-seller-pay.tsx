// app/verified-seller-pay.tsx
// Pay for real, enforced Verified Seller status.
//
// UPDATED: this used to set profiles.is_verified = true the instant
// payment confirmed — no document, no review, just money. That's not
// real verification, and it was inconsistent with how delivery
// operators already work in this app (a separate paid vs.
// verification_tier state, gated on submitting a national ID). Now:
// pay $15 -> upload an ID document -> status becomes 'pending_review'
// -> an admin approves or rejects via admin-verification-review.tsx.
// is_verified only ever becomes true on approval, never on payment
// alone. Payment and document upload can happen in either order; the
// "pending review" state only shows once both are done.
//
// UPDATED AGAIN: the submission/review backend is now shared across
// seller, delivery_operator, and transport_operator verification —
// see unified-verification.sql. This screen calls submit_verification
// and my_verification_status with verification_type = 'seller'; the
// $15 payment step is still seller-specific (operators don't pay to
// get ID-verified, only to register).
//
// The actual write of verification_document_url /
// verification_submitted_at / verification_review_status happens
// through the submit_verification() Postgres function, never a direct
// client update — same reasoning as submit_rating() from the rating-
// security rewrite: a user must never be able to set their own review
// status to 'approved' via a raw API call.
//
// Usage: router.push('/verified-seller-pay')

import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Image, Platform, ScrollView, StyleSheet,
  Text, TouchableOpacity, View,
} from 'react-native';
import { normalizeImageOrientation } from '../../lib/imageOrientation';
import { supabase } from '../../lib/supabase';
import { prepareUpload } from '../../lib/uploadHelpers';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';
const GREEN = '#4fc96e';
const RED = '#ff8a8a';

const PRICE = 15;
const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 20; // ~40 seconds total — was 15 (~30s); widened
// after a real trip_deposit payment on quotes.tsx took 32s to confirm
// and got missed under the old window. Same webhook path, same fix.

type ReviewStatus = 'not_submitted' | 'pending_review' | 'approved' | 'rejected';

export default function VerifiedSellerPayScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [myId, setMyId] = useState('');
  const [myEmail, setMyEmail] = useState('');

  const [currentlyVerified, setCurrentlyVerified] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [hasPaid, setHasPaid] = useState(false);
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>('not_submitted');
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);

  const [paying, setPaying] = useState(false);
  const [verifyingPayment, setVerifyingPayment] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pickedImageUri, setPickedImageUri] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => { init(); }, []);

  async function init() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || user.is_anonymous) {
      router.push('/register');
      return;
    }

    setMyId(user.id);
    setMyEmail(user.email ?? '');

    const { data: profile } = await supabase
      .from('profiles')
      .select('is_verified, verified_expires_at, verified_paid_at')
      .eq('id', user.id)
      .maybeSingle();

    const isActive = !!(
      profile?.is_verified &&
      profile?.verified_expires_at &&
      new Date(profile.verified_expires_at).getTime() > Date.now()
    );
    setCurrentlyVerified(isActive);
    setExpiresAt(profile?.verified_expires_at ?? null);
    setHasPaid(!!profile?.verified_paid_at);

    // Status comes from the shared verification_requests table (via
    // my_verification_status), not seller-only columns on profiles —
    // same backend delivery/transport operator verification uses too.
    const { data: statusRows } = await supabase.rpc('my_verification_status', {
      p_verification_type: 'seller',
    });
    const latest = statusRows?.[0];
    setReviewStatus((latest?.status as ReviewStatus) ?? 'not_submitted');
    setRejectionReason(latest?.rejection_reason ?? null);

    setLoading(false);
  }

  async function handlePay() {
    setError('');
    setPaying(true);

    const { data, error: fnError } = await supabase.functions.invoke('create-payment', {
      body: {
        kind: 'verified_seller',
        amount: PRICE,
        email: myEmail,
        buyer_id: myId,
      },
    });

    if (fnError || !data?.checkoutUrl) {
      setError(fnError?.message || data?.error || 'Could not start payment. Please try again.');
      setPaying(false);
      return;
    }

    const { reference, checkoutUrl } = data;
    await WebBrowser.openBrowserAsync(checkoutUrl);

    setPaying(false);
    setVerifyingPayment(true);

    const paid = await pollForPaid(reference);

    setVerifyingPayment(false);

    if (paid) {
      await init(); // pick up verified_paid_at and any status change
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

  async function pickDocument() {
    setError('');
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('We need permission to access your photos to upload your ID.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      exif: true,
    });

    if (!result.canceled && result.assets?.[0]) {
      const asset = result.assets[0];
      setPickedImageUri(await normalizeImageOrientation(asset.uri, asset.exif));
    }
  }

  // NEW: camera capture, alongside the existing gallery picker — same
  // fix already applied to operator-id-verify.tsx. Camera and photo-
  // library permissions are separate on both iOS and Android, so this
  // needs its own permission request.
  async function takePhoto() {
    setError('');
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError('We need camera permission to take a photo of your ID.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      exif: true,
    });

    if (!result.canceled && result.assets?.[0]) {
      const asset = result.assets[0];
      setPickedImageUri(await normalizeImageOrientation(asset.uri, asset.exif));
    }
  }

  async function handleUpload() {
    if (!pickedImageUri) return;
    setError('');
    setUploading(true);

    try {
      // FIX (real bug, not the earlier deprecation warning): this used
      // to be fetch(pickedImageUri).then(r => r.blob()) — a well-known
      // failure mode on React Native/Expo where the Blob polyfill can
      // throw "Creating blobs from 'ArrayBuffer' and 'ArrayBufferView'
      // are not supported". Replaced with the ArrayBuffer approach
      // Supabase's own docs recommend — see lib/uploadHelpers.ts for
      // the full reasoning, including why web still needs the original
      // Blob approach (which works fine there — this bug is
      // native-only) and everything now correctly handles both.
      const { data, contentType, extension } = await prepareUpload(pickedImageUri);
      const path = `${myId}/${Date.now()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from('verification-documents')
        .upload(path, data, { contentType });

      if (uploadError) {
        setError(uploadError.message);
        setUploading(false);
        return;
      }

      // Calls the shared submit_verification RPC (type = 'seller') —
      // security definer, writes only for auth.uid(), always sets
      // status to 'pending_review'. A direct client update here would
      // let a user tamper with their own review status.
      const { error: rpcError } = await supabase.rpc('submit_verification', {
        p_verification_type: 'seller',
        p_document_path: path,
      });

      if (rpcError) {
        setError(rpcError.message);
        setUploading(false);
        return;
      }

      setPickedImageUri(null);
      await init();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={GOLD} />
      </View>
    );
  }

  if (currentlyVerified) {
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <View style={styles.successCard}>
            <Text style={styles.successEmoji}>✅</Text>
            <Text style={styles.successTitle}>You're a Verified Seller</Text>
            {expiresAt && (
              <Text style={styles.successBody}>
                Valid until {new Date(expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
              </Text>
            )}
            <TouchableOpacity style={styles.doneBtn} onPress={() => router.replace('/profile')}>
              <Text style={styles.doneBtnText}>Back to Profile</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  // Paid and document submitted — waiting on an admin to review it.
  if (hasPaid && reviewStatus === 'pending_review') {
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <View style={styles.pendingCard}>
            <Text style={styles.pendingEmoji}>🕐</Text>
            <Text style={styles.pendingTitle}>Your documents are under review</Text>
            <Text style={styles.pendingBody}>
              We've received your payment and your ID document. Our team reviews submissions within a
              few business days — you'll see your Verified badge here as soon as it's approved.
            </Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  const wasRejected = reviewStatus === 'rejected';

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.heading}>Verified Seller</Text>
        <Text style={styles.subheading}>Stand out and build trust with buyers.</Text>

        {wasRejected && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>
              ⚠️ Your last submission wasn't approved{rejectionReason ? `: ${rejectionReason}` : '.'} Please upload a
              clearer document to try again.
            </Text>
          </View>
        )}

        <View style={styles.card}>
          <Feature text="A real Verified badge, only after your ID is reviewed and approved" />
          <Feature text="Higher buyer confidence and trust" />
          <Feature text="Valid for 12 months once approved" />
        </View>

        {/* Step 1: payment */}
        <View style={styles.stepCard}>
          <View style={styles.stepHeader}>
            <View style={[styles.stepBadge, hasPaid && styles.stepBadgeDone]}>
              <Text style={styles.stepBadgeText}>{hasPaid ? '✓' : '1'}</Text>
            </View>
            <Text style={styles.stepTitle}>Pay the verification fee</Text>
          </View>
          {hasPaid ? (
            <Text style={styles.stepDone}>Paid ${PRICE.toFixed(2)}</Text>
          ) : (
            <>
              <Text style={styles.priceValue}>${PRICE.toFixed(2)}</Text>
              <TouchableOpacity
                style={[styles.payBtn, (paying || verifyingPayment) && { opacity: 0.6 }]}
                onPress={handlePay}
                disabled={paying || verifyingPayment}
              >
                {paying || verifyingPayment
                  ? <ActivityIndicator color={BLACK} />
                  : <Text style={styles.payBtnText}>Pay ${PRICE.toFixed(2)} with Paynow</Text>
                }
              </TouchableOpacity>
              {verifyingPayment && <Text style={styles.verifyingNote}>Waiting for payment confirmation...</Text>}
            </>
          )}
        </View>

        {/* Step 2: document upload */}
        <View style={styles.stepCard}>
          <View style={styles.stepHeader}>
            <View style={styles.stepBadge}>
              <Text style={styles.stepBadgeText}>2</Text>
            </View>
            <Text style={styles.stepTitle}>Upload a photo of your national ID</Text>
          </View>
          <Text style={styles.stepNote}>Used only to verify your identity — not shown publicly.</Text>

          {pickedImageUri ? (
            <>
              <Image source={{ uri: pickedImageUri }} style={styles.previewImage} />
              <TouchableOpacity
                style={[styles.payBtn, uploading && { opacity: 0.6 }]}
                onPress={handleUpload}
                disabled={uploading}
              >
                {uploading
                  ? <ActivityIndicator color={BLACK} />
                  : <Text style={styles.payBtnText}>Submit for review</Text>
                }
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setPickedImageUri(null)} disabled={uploading}>
                <Text style={styles.changePhotoText}>Choose a different photo</Text>
              </TouchableOpacity>
            </>
          ) : (
            <View style={styles.uploadOptionsRow}>
              <TouchableOpacity style={styles.uploadBtnHalf} onPress={takePhoto}>
                <Text style={styles.uploadBtnHalfText}>📸 Take Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.uploadBtnHalf} onPress={pickDocument}>
                <Text style={styles.uploadBtnHalfText}>🖼️ Choose from Gallery</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {error ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>⚠️ {error}</Text></View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Feature({ text }: { text: string }) {
  return (
    <View style={styles.featureRow}>
      <Text style={styles.featureCheck}>✓</Text>
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  content: { padding: 20, paddingTop: Platform.OS === 'ios' ? 56 : 40 },
  center: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },

  backBtn: { marginBottom: 16 },
  backText: { color: GREY, fontSize: 14 },
  heading: { fontSize: 26, fontWeight: '800', color: '#fff', marginBottom: 6 },
  subheading: { fontSize: 13, color: GREY, marginBottom: 24 },

  card: { backgroundColor: BLACK, borderRadius: 14, padding: 18, marginBottom: 16, borderWidth: 0.5, borderColor: '#333' },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  featureCheck: { color: GREEN, fontSize: 15, fontWeight: '800' },
  featureText: { color: '#fff', fontSize: 13, flex: 1 },

  stepCard: { backgroundColor: BLACK, borderRadius: 14, padding: 18, marginBottom: 16, borderWidth: 0.5, borderColor: '#333' },
  stepHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  stepBadge: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#444', alignItems: 'center', justifyContent: 'center' },
  stepBadgeDone: { backgroundColor: GREEN },
  stepBadgeText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  stepTitle: { color: '#fff', fontSize: 14, fontWeight: '700', flex: 1 },
  stepDone: { color: GREEN, fontSize: 13, fontWeight: '600' },
  stepNote: { color: GREY, fontSize: 11, marginBottom: 14 },

  priceValue: { color: GOLD, fontSize: 28, fontWeight: '800', marginBottom: 14 },

  errorBox: { backgroundColor: '#3a1a1a', borderRadius: 10, padding: 12, marginBottom: 16 },
  errorText: { color: RED, fontSize: 13 },

  payBtn: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  payBtnText: { color: BLACK, fontSize: 15, fontWeight: '800' },
  verifyingNote: { color: GREY, fontSize: 12, textAlign: 'center', marginTop: 12 },

  uploadBtn: { backgroundColor: DARK, borderRadius: 14, paddingVertical: 16, alignItems: 'center', borderWidth: 1, borderColor: '#444', borderStyle: 'dashed' },
  uploadOptionsRow: { flexDirection: 'row', gap: 10 },
  uploadBtnHalf: { flex: 1, backgroundColor: DARK, borderRadius: 14, paddingVertical: 16, alignItems: 'center', borderWidth: 1, borderColor: '#444', borderStyle: 'dashed' },
  uploadBtnHalfText: { color: '#fff', fontSize: 12, fontWeight: '700', textAlign: 'center' },
  uploadBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  previewImage: { width: '100%', height: 180, borderRadius: 10, marginBottom: 14, backgroundColor: DARK },
  changePhotoText: { color: GREY, fontSize: 12, textAlign: 'center', marginTop: 12 },

  successCard: { alignItems: 'center', paddingTop: 60 },
  successEmoji: { fontSize: 56, marginBottom: 16 },
  successTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 8 },
  successBody: { color: GREY, fontSize: 13, marginBottom: 28 },
  doneBtn: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32 },
  doneBtnText: { color: BLACK, fontSize: 14, fontWeight: '800' },

  pendingCard: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 10 },
  pendingEmoji: { fontSize: 56, marginBottom: 16 },
  pendingTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 12, textAlign: 'center' },
  pendingBody: { color: GREY, fontSize: 13, textAlign: 'center', lineHeight: 20 },
});
