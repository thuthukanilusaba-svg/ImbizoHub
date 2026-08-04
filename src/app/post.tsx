// app/post.tsx
// Post a listing — supports multiple photo uploads to Supabase Storage
//
// FIX (product decision, following the pattern established across the
// rest of the app today): posting a listing now requires a REAL
// (non-anonymous) account, unlike posting a Wanted request or a van-hire
// trip. Reasoning: a listing is persistent inventory, not a one-off
// request — it sits on the marketplace until someone manages it, and an
// anonymous session has no recovery path if lost, meaning an abandoned
// anonymous listing could never be edited, marked sold, or removed
// again. Buyers messaging that seller would be messaging someone who may
// never come back. This is closer in kind to "arranging a deal" (which
// already requires a real account everywhere else in the app) than to
// casual browsing/posting.
//
// The check happens in TWO places:
//   1. requireRealAccount(), called BEFORE pickImages() does anything —
//      so an anonymous user is redirected to register before they invest
//      time picking and uploading photos, rather than after, which would
//      leave those uploads orphaned in storage with no listing ever
//      created to reference them.
//   2. Re-checked in handlePost() as a defensive backstop, in case
//      session state changed between opening this screen and submitting.

import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  ScrollView as RNScrollView,
  ScrollView,
  StyleSheet,
  Text, TextInput, TouchableOpacity,
  View,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { prepareUpload } from '../../lib/uploadHelpers';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';
const MAX_PHOTOS = 6;

const categories = ['Phones', 'Vehicles', 'Furniture', 'Clothing', 'Appliances', 'Building', 'Baby', 'Other'];

export default function PostScreen() {
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState('Phones');
  const [images, setImages] = useState<{ uri: string; uploading: boolean; url?: string }[]>([]);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Returns true if there's a real, non-anonymous session. Redirects to
  // /register and returns false otherwise — callers should bail out
  // immediately when this returns false.
  async function requireRealAccount(): Promise<boolean> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.is_anonymous) {
      router.push('/register');
      return false;
    }
    return true;
  }

  async function pickImages() {
    if (images.length >= MAX_PHOTOS) {
      setError(`Maximum ${MAX_PHOTOS} photos allowed.`);
      return;
    }
    setError('');

    // Checked here, before any photo picking/uploading starts — see file
    // header comment for why this can't wait until final submit.
    const ok = await requireRealAccount();
    if (!ok) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Permission to access photos is required.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.7,
      selectionLimit: MAX_PHOTOS - images.length,
    });

    if (result.canceled) return;

    const newImages = result.assets.map((asset) => ({ uri: asset.uri, uploading: true }));
    setImages((prev) => [...prev, ...newImages]);

    // Upload each new image
    for (const asset of result.assets) {
      uploadImage(asset.uri);
    }
  }

  // NEW: camera capture, alongside the existing multi-select gallery
  // picker. Camera and photo-library permissions are SEPARATE on both
  // iOS and Android, so this needs its own permission request. Camera
  // can only capture one photo at a time (no multi-select equivalent),
  // so this adds exactly one image per tap rather than sharing
  // pickImages()'s multi-select logic.
  async function takePhoto() {
    if (images.length >= MAX_PHOTOS) {
      setError(`Maximum ${MAX_PHOTOS} photos allowed.`);
      return;
    }
    setError('');

    const ok = await requireRealAccount();
    if (!ok) return;

    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError('Camera permission is required to take a photo.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });

    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    setImages((prev) => [...prev, { uri: asset.uri, uploading: true }]);
    uploadImage(asset.uri);
  }

  async function uploadImage(uri: string) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not logged in');

      // FIX (real bug, not the earlier deprecation warning): this used
      // to be fetch(uri).then(r => r.blob()) — a well-known failure
      // mode on React Native/Expo where the Blob polyfill can throw
      // "Creating blobs from 'ArrayBuffer' and 'ArrayBufferView' are
      // not supported". Replaced with the approach Supabase's own docs
      // recommend — see lib/uploadHelpers.ts.
      const { data: uploadData, contentType, extension } = await prepareUpload(uri);
      const fileName = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from('listing-photos')
        .upload(fileName, uploadData, {
          contentType,
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('listing-photos')
        .getPublicUrl(fileName);

      setImages((prev) =>
        prev.map((img) =>
          img.uri === uri ? { ...img, uploading: false, url: urlData.publicUrl } : img
        )
      );
    } catch (err: any) {
      setError(`Upload failed: ${err.message}`);
      setImages((prev) => prev.filter((img) => img.uri !== uri));
    }
  }

  function removeImage(uri: string) {
    setImages((prev) => prev.filter((img) => img.uri !== uri));
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

    const stillUploading = images.some((img) => img.uploading);
    if (stillUploading) {
      setError('Please wait for photos to finish uploading.');
      return;
    }

    setPosting(true);

    // Defensive re-check — see file header comment. pickImages() already
    // guards this at the point photos are picked, but session state
    // could in principle change between then and submitting.
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.is_anonymous) {
      setPosting(false);
      router.push('/register');
      return;
    }

    const imageUrls = images.map((img) => img.url).filter(Boolean) as string[];

    // NEW: Dealer Pro benefit — a listing posted by an active Pro
    // subscriber gets the 'Dealer' badge instead of 'New', making their
    // listings visually stand out across the app (index.tsx and
    // explore.tsx both already render this badge style for any value
    // other than 'Verified' — this was previously hardcoded to 'New'
    // for absolutely everyone, so the badge rendering existed but
    // nothing ever actually triggered it). Same "paid boolean + expires_at
    // checked against now()" pattern already used everywhere else in the
    // app (dealer.tsx, analytics.tsx, explore.tsx's Pro-sorting check).
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

    const { error: insertError } = await supabase.from('listings').insert({
      user_id: user.id,
      title: title.trim(),
      description: description.trim(),
      price: priceNum,
      location: location.trim(),
      category,
      image_url: imageUrls[0] || null, // backwards compatible — first photo
      image_urls: imageUrls,            // full gallery
      badge: posterIsDealerPro ? 'Dealer' : 'New',
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
        <Text style={styles.successTitle}>Listing posted!</Text>
        <Text style={styles.successBody}>Your item is now live on ImbizoHub.</Text>
        <TouchableOpacity style={styles.successBtn} onPress={() => router.replace('/')}>
          <Text style={styles.successBtnText}>Back to home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.heading}>Post a listing</Text>
        <Text style={styles.subheading}>Add photos and details to attract buyers.</Text>

        <TouchableOpacity
          style={styles.whatsappImportLink}
          onPress={() => router.push('/whatsapp-import')}
        >
          <Text style={styles.whatsappImportLinkText}>
            💬 Already selling on WhatsApp? Import a listing instead →
          </Text>
        </TouchableOpacity>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>⚠️ {error}</Text>
          </View>
        ) : null}

        {/* Photo gallery */}
        <Text style={styles.label}>Photos ({images.length}/{MAX_PHOTOS})</Text>
        <RNScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoScroll}>
          {images.map((img) => (
            <View key={img.uri} style={styles.photoThumb}>
              <Image source={{ uri: img.uri }} style={styles.photoImage} />
              {img.uploading && (
                <View style={styles.photoUploadingOverlay}>
                  <ActivityIndicator color="#fff" />
                </View>
              )}
              {!img.uploading && (
                <TouchableOpacity style={styles.photoRemoveBtn} onPress={() => removeImage(img.uri)}>
                  <Text style={styles.photoRemoveText}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}

          {images.length < MAX_PHOTOS && (
            <>
              <TouchableOpacity style={styles.addPhotoBtn} onPress={takePhoto}>
                <Text style={styles.addPhotoIcon}>📸</Text>
                <Text style={styles.addPhotoText}>Camera</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.addPhotoBtn} onPress={pickImages}>
                <Text style={styles.addPhotoIcon}>🖼️</Text>
                <Text style={styles.addPhotoText}>Gallery</Text>
              </TouchableOpacity>
            </>
          )}
        </RNScrollView>

        {/* Form fields */}
        <View style={styles.card}>
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
        </View>

        <TouchableOpacity
          style={[styles.postBtn, posting && { opacity: 0.6 }]}
          onPress={handlePost}
          disabled={posting}
        >
          {posting ? <ActivityIndicator color="#fff" /> : <Text style={styles.postBtnText}>Post listing</Text>}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  content: { padding: 20, paddingBottom: 60 },

  backBtn: { marginBottom: 16 },
  backText: { color: GREY, fontSize: 14 },
  heading: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 6 },
  subheading: { fontSize: 13, color: GREY, marginBottom: 20 },

  whatsappImportLink: { backgroundColor: DARK, borderRadius: 12, padding: 12, marginBottom: 16, borderWidth: 0.5, borderColor: GOLD },
  whatsappImportLinkText: { color: GOLD, fontSize: 12, fontWeight: '700', textAlign: 'center' },

  errorBox: { backgroundColor: '#3a1a1a', borderRadius: 10, padding: 12, marginBottom: 16 },
  errorText: { color: '#ff8a8a', fontSize: 13 },

  label: { fontSize: 13, fontWeight: '700', color: '#fff', marginBottom: 8, marginTop: 14 },

  photoScroll: { marginBottom: 8 },
  photoThumb: { width: 90, height: 90, borderRadius: 12, marginRight: 10, overflow: 'hidden', position: 'relative' },
  photoImage: { width: '100%', height: '100%' },
  photoUploadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  photoRemoveBtn: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  photoRemoveText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  addPhotoBtn: { width: 90, height: 90, borderRadius: 12, borderWidth: 1.5, borderColor: '#444', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', backgroundColor: DARK },
  addPhotoIcon: { fontSize: 22, marginBottom: 4 },
  addPhotoText: { color: GREY, fontSize: 10 },

  card: { backgroundColor: BLACK, borderRadius: 14, padding: 16, marginTop: 10, borderWidth: 0.5, borderColor: '#333' },
  input: {
    backgroundColor: DARK, borderRadius: 10, paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 13 : 10, fontSize: 14, color: '#fff',
    borderWidth: 0.5, borderColor: '#333',
  },
  textArea: { height: 90, textAlignVertical: 'top', paddingTop: 10 },

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
