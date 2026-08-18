// app/operator-id-verify.tsx
// ID verification for delivery and transport operators — the step
// dealer.tsx has referenced for a while ("Submit your national ID to
// become verified and get more jobs") but that never actually existed
// as a screen. No payment here — operators already pay a separate
// registration fee (delivery-operator-register-pay.tsx /
// operator-register-pay.tsx); this is purely the identity-check step
// that upgrades their standing once approved.
//
// Shares the same backend as Verified Seller
// (verified-seller-pay.tsx) — submit_verification /
// my_verification_status / the verification_requests table and admin
// review flow — see unified-verification.sql. Approval sets:
//   delivery_operator  -> delivery_operators.verification_tier = 'id_verified'
//   transport_operator -> profiles.operator_id_verified = true
//
// SCOPE: this is the ID-photo tier only. delivery_operators has a
// third tier ('trusted') that needs an affidavit + referee, a
// meaningfully different process not built here.
//
// NEW: "Take Photo" now opens IdCameraCapture — a custom in-app camera
// with a visible ID-boundary guide overlay — instead of the plain OS
// camera picker (ImagePicker.launchCameraAsync), which has no way to
// show a custom alignment guide on its native UI. See
// components/IdCameraCapture.tsx for why this needed a different
// library (expo-camera instead of expo-image-picker for this specific
// path). Gallery selection is unchanged — still expo-image-picker,
// since there's no live camera feed to overlay a guide on for an
// already-existing photo.
//
// Usage: router.push('/operator-id-verify?type=delivery_operator')
//        router.push('/operator-id-verify?type=transport_operator')

import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Image, Platform, ScrollView, StyleSheet,
  Text, TouchableOpacity, View,
} from 'react-native';
import IdCameraCapture from '../../components/IdCameraCapture';
import { normalizeImageOrientation } from '../../lib/imageOrientation';
import { supabase } from '../../lib/supabase';
import { prepareUpload } from '../../lib/uploadHelpers';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';
const RED = '#ff8a8a';

type OperatorType = 'delivery_operator' | 'transport_operator';
type ReviewStatus = 'not_submitted' | 'pending_review' | 'approved' | 'rejected';

// FIX: `type` used to silently default to 'delivery_operator' whenever it
// was missing or malformed (`type === 'transport_operator' ? ... :
// 'delivery_operator'`), with no validation at all. This screen handles
// real government ID photos — the most sensitive data category in the
// app — so a malformed/stale deep link could silently submit someone's ID
// under the wrong verification category with no warning. Now an invalid
// `type` renders an explicit error screen instead of guessing.
const VALID_TYPES: OperatorType[] = ['delivery_operator', 'transport_operator'];

const COPY: Record<OperatorType, { title: string; benefit: string; emoji: string }> = {
  delivery_operator: {
    title: 'Delivery operator ID verification',
    benefit: 'Verified drivers appear higher in the driver list buyers choose from.',
    emoji: '📦',
  },
  transport_operator: {
    title: 'Transport operator ID verification',
    benefit: 'Verified operators appear higher when customers review quotes.',
    emoji: '🚐',
  },
};

export default function OperatorIdVerifyScreen() {
  const router = useRouter();
  const { type } = useLocalSearchParams<{ type: string }>();
  const isValidType = VALID_TYPES.includes(type as OperatorType);
  const operatorType: OperatorType = isValidType ? (type as OperatorType) : 'delivery_operator';
  const copy = COPY[operatorType];

  const [loading, setLoading] = useState(true);
  const [myId, setMyId] = useState('');
  const [currentlyIdVerified, setCurrentlyIdVerified] = useState(false);
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>('not_submitted');
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [pickedImageUri, setPickedImageUri] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showCamera, setShowCamera] = useState(false);

  useEffect(() => {
    if (!isValidType) { setLoading(false); return; }
    init();
  }, [operatorType, isValidType]);

  async function init() {
    setLoading(true);
    setError('');
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || user.is_anonymous) {
      router.push('/register');
      return;
    }
    setMyId(user.id);

    if (operatorType === 'delivery_operator') {
      const { data } = await supabase
        .from('delivery_operators')
        .select('verification_tier')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!data) {
        setError('No delivery operator profile found. Please register as a delivery operator first.');
        setLoading(false);
        return;
      }
      setCurrentlyIdVerified(data.verification_tier === 'id_verified' || data.verification_tier === 'trusted');
    } else {
      const { data } = await supabase
        .from('profiles')
        .select('operator_id_verified')
        .eq('id', user.id)
        .maybeSingle();
      setCurrentlyIdVerified(!!data?.operator_id_verified);
    }

    const { data: statusRows } = await supabase.rpc('my_verification_status', {
      p_verification_type: operatorType,
    });
    const latest = statusRows?.[0];
    setReviewStatus((latest?.status as ReviewStatus) ?? 'not_submitted');
    setRejectionReason(latest?.rejection_reason ?? null);

    setLoading(false);
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

  function handleTakePhoto() {
    setError('');
    setShowCamera(true);
  }

  function handleCameraCapture(uri: string) {
    setShowCamera(false);
    setPickedImageUri(uri);
  }

  async function handleUpload() {
    if (!pickedImageUri) return;
    setError('');
    setUploading(true);

    try {
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

      const { error: rpcError } = await supabase.rpc('submit_verification', {
        p_verification_type: operatorType,
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

  if (!isValidType) {
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.pendingCard}>
            <Text style={styles.pendingEmoji}>⚠️</Text>
            <Text style={styles.pendingTitle}>This verification link isn't valid</Text>
            <Text style={styles.pendingBody}>
              We couldn't tell what kind of verification this link was for, so we stopped before
              submitting anything. Please go back and try again from your dashboard.
            </Text>
            <TouchableOpacity style={[styles.doneBtn, { marginTop: 20 }]} onPress={() => router.replace('/dealer')}>
              <Text style={styles.doneBtnText}>Back to Dashboard</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  if (currentlyIdVerified) {
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}><Text style={styles.backArrow}>‹</Text> Back</Text>
          </TouchableOpacity>
          <View style={styles.successCard}>
            <Text style={styles.successEmoji}>✅</Text>
            <Text style={styles.successTitle}>You're ID verified</Text>
            <Text style={styles.successBody}>{copy.benefit}</Text>
            <TouchableOpacity style={styles.doneBtn} onPress={() => router.replace('/dealer')}>
              <Text style={styles.doneBtnText}>Back to Dashboard</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  if (reviewStatus === 'pending_review') {
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}><Text style={styles.backArrow}>‹</Text> Back</Text>
          </TouchableOpacity>
          <View style={styles.pendingCard}>
            <Text style={styles.pendingEmoji}>🕐</Text>
            <Text style={styles.pendingTitle}>Your ID is under review</Text>
            <Text style={styles.pendingBody}>
              Our team reviews submissions within a few business days — you'll see your verified status
              here as soon as it's approved.
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
          <Text style={styles.backText}><Text style={styles.backArrow}>‹</Text> Back</Text>
        </TouchableOpacity>

        <Text style={styles.heading}>{copy.emoji} {copy.title}</Text>
        <Text style={styles.subheading}>{copy.benefit}</Text>

        {wasRejected && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>
              ⚠️ Your last submission wasn't approved{rejectionReason ? `: ${rejectionReason}` : '.'} Please upload a
              clearer photo to try again.
            </Text>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.stepNote}>Used only to verify your identity — not shown publicly.</Text>

          {pickedImageUri ? (
            <>
              <Image source={{ uri: pickedImageUri }} style={styles.previewImage} />
              <TouchableOpacity
                style={[styles.submitBtn, uploading && { opacity: 0.6 }]}
                onPress={handleUpload}
                disabled={uploading}
              >
                {uploading
                  ? <ActivityIndicator color={BLACK} />
                  : <Text style={styles.submitBtnText}>Submit for review</Text>
                }
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setPickedImageUri(null)} disabled={uploading}>
                <Text style={styles.changePhotoText}>Choose a different photo</Text>
              </TouchableOpacity>
            </>
          ) : (
            <View style={styles.uploadOptionsRow}>
              <TouchableOpacity style={styles.uploadBtnHalf} onPress={handleTakePhoto}>
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

      <IdCameraCapture
        visible={showCamera}
        onCapture={handleCameraCapture}
        onClose={() => setShowCamera(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  content: { padding: 20, paddingTop: Platform.OS === 'ios' ? 56 : 40 },
  center: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },

  backBtn: { marginBottom: 16 },
  backText: { color: GREY, fontSize: 14 },
  // NEW: bigger than the label text so the '‹' glyph reads clearly — direct product decision ("back symbol too small").
  backArrow: { fontSize: 20 },
  heading: { fontSize: 22, fontWeight: '800', color: '#fff', marginBottom: 6 },
  subheading: { fontSize: 13, color: GREY, marginBottom: 24 },

  card: { backgroundColor: BLACK, borderRadius: 14, padding: 18, marginBottom: 16, borderWidth: 0.5, borderColor: '#333' },
  stepNote: { color: GREY, fontSize: 11, marginBottom: 14 },

  errorBox: { backgroundColor: '#3a1a1a', borderRadius: 10, padding: 12, marginBottom: 16 },
  errorText: { color: RED, fontSize: 13 },

  uploadOptionsRow: { flexDirection: 'row', gap: 10 },
  uploadBtnHalf: { flex: 1, backgroundColor: DARK, borderRadius: 14, paddingVertical: 16, alignItems: 'center', borderWidth: 1, borderColor: '#444', borderStyle: 'dashed' },
  uploadBtnHalfText: { color: '#fff', fontSize: 12, fontWeight: '700', textAlign: 'center' },
  previewImage: { width: '100%', height: 180, borderRadius: 10, marginBottom: 14, backgroundColor: DARK },
  changePhotoText: { color: GREY, fontSize: 12, textAlign: 'center', marginTop: 12 },

  submitBtn: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  submitBtnText: { color: BLACK, fontSize: 15, fontWeight: '800' },

  successCard: { alignItems: 'center', paddingTop: 60 },
  successEmoji: { fontSize: 56, marginBottom: 16 },
  successTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 8 },
  successBody: { color: GREY, fontSize: 13, textAlign: 'center', marginBottom: 28, paddingHorizontal: 10 },
  doneBtn: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32 },
  doneBtnText: { color: BLACK, fontSize: 14, fontWeight: '800' },

  pendingCard: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 10 },
  pendingEmoji: { fontSize: 56, marginBottom: 16 },
  pendingTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 12, textAlign: 'center' },
  pendingBody: { color: GREY, fontSize: 13, textAlign: 'center', lineHeight: 20 },
});
