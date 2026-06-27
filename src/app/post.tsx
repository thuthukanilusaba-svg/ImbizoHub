import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

const categories = ['Phones', 'Vehicles', 'Furniture', 'Clothing', 'Appliances', 'Building', 'Baby', 'Electronics', 'Other'];

export default function PostScreen() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handlePost = async () => {
    if (!title || !price || !location || !category) {
      setError('Please fill in title, price, location and category.');
      return;
    }
    setLoading(true);
    setError('');

    const { data: { session } } = await supabase.auth.getSession();

    const { error: insertError } = await supabase.from('listings').insert({
      title,
      description,
      price: parseFloat(price),
      location,
      category,
      image_url: imageUrl || 'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=400',
      badge: 'Verified',
      user_id: session?.user?.id,
    });

    setLoading(false);
    if (insertError) {
      setError(insertError.message);
    } else {
      setSuccess(true);
      setTimeout(() => router.push('/'), 1500);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <ScrollView showsVerticalScrollIndicator={false}>

        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.closeBtn}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Post a listing</Text>
          <Text style={styles.draftBtn}> </Text>
        </View>

        {success ? (
          <View style={styles.successBox}>
            <Text style={styles.successIcon}>🎉</Text>
            <Text style={styles.successText}>Listing posted successfully!</Text>
            <Text style={styles.successSub}>Redirecting to home...</Text>
          </View>
        ) : (
          <>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <View style={styles.section}>
              <Text style={styles.lbl}>TITLE *</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. iPhone 13 Pro 256GB"
                placeholderTextColor="#555"
                value={title}
                onChangeText={setTitle}
                maxLength={60}
              />
              <Text style={styles.charCount}>{title.length} / 60</Text>
            </View>

            <View style={styles.section}>
              <Text style={styles.lbl}>CATEGORY *</Text>
              <View style={styles.catGrid}>
                {categories.map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.catPill, category === cat && styles.catPillActive]}
                    onPress={() => setCategory(cat)}
                  >
                    <Text style={[styles.catPillText, category === cat && styles.catPillTextActive]}>{cat}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.lbl}>PRICE (USD) *</Text>
              <View style={styles.inputRow}>
                <Text style={styles.currency}>$</Text>
                <TextInput
                  style={styles.priceInput}
                  placeholder="0"
                  placeholderTextColor="#555"
                  value={price}
                  onChangeText={setPrice}
                  keyboardType="numeric"
                />
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.lbl}>LOCATION *</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Harare, Avondale"
                placeholderTextColor="#555"
                value={location}
                onChangeText={setLocation}
              />
            </View>

            <View style={styles.section}>
              <Text style={styles.lbl}>DESCRIPTION</Text>
              <TextInput
                style={styles.descInput}
                placeholder="Describe your item..."
                placeholderTextColor="#555"
                value={description}
                onChangeText={setDescription}
                multiline
                maxLength={500}
              />
              <Text style={styles.charCount}>{description.length} / 500</Text>
            </View>

            <View style={styles.section}>
              <Text style={styles.lbl}>IMAGE URL (optional)</Text>
              <TextInput
                style={styles.input}
                placeholder="https://..."
                placeholderTextColor="#555"
                value={imageUrl}
                onChangeText={setImageUrl}
              />
              <Text style={styles.photoTip}>Tip: Paste an image URL. Leave blank for a default image.</Text>
            </View>

            <View style={styles.section}>
              <TouchableOpacity style={styles.btnPost} onPress={handlePost} disabled={loading}>
                {loading ? (
                  <ActivityIndicator color={BLACK} />
                ) : (
                  <Text style={styles.btnPostText}>Post listing</Text>
                )}
              </TouchableOpacity>
              <Text style={styles.postNote}>Your listing will be live instantly</Text>
            </View>

            <View style={{ height: 40 }} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  header: { backgroundColor: BLACK, padding: 16, paddingTop: 50, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  closeBtn: { color: '#fff', fontSize: 20 },
  headerTitle: { color: '#fff', fontSize: 14, fontWeight: '700' },
  draftBtn: { color: GOLD, fontSize: 13 },
  section: { backgroundColor: BLACK, paddingHorizontal: 16, paddingBottom: 14 },
  lbl: { color: GREY, fontSize: 11, marginBottom: 6, letterSpacing: 0.5 },
  input: { backgroundColor: DARK, borderRadius: 10, padding: 12, borderWidth: 0.5, borderColor: '#444', color: '#fff', fontSize: 14 },
  inputRow: { backgroundColor: DARK, borderRadius: 10, padding: 12, borderWidth: 0.5, borderColor: '#444', flexDirection: 'row', alignItems: 'center', gap: 8 },
  currency: { color: GOLD, fontSize: 16, fontWeight: '800' },
  priceInput: { color: '#fff', fontSize: 16, fontWeight: '700', flex: 1 },
  descInput: { backgroundColor: DARK, borderRadius: 10, padding: 12, borderWidth: 0.5, borderColor: '#444', color: '#fff', fontSize: 13, minHeight: 100, textAlignVertical: 'top' },
  charCount: { color: '#555', fontSize: 10, textAlign: 'right', marginTop: 4 },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catPill: { backgroundColor: DARK, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, borderWidth: 0.5, borderColor: '#444' },
  catPillActive: { backgroundColor: '#3a2800', borderColor: GOLD },
  catPillText: { color: '#ccc', fontSize: 12 },
  catPillTextActive: { color: GOLD },
  photoTip: { color: '#555', fontSize: 10, marginTop: 6 },
  btnPost: { backgroundColor: GOLD, borderRadius: 14, padding: 16, alignItems: 'center' },
  btnPostText: { color: BLACK, fontSize: 15, fontWeight: '800' },
  postNote: { color: '#555', fontSize: 10, textAlign: 'center', marginTop: 8 },
  errorText: { color: '#ff4444', fontSize: 13, textAlign: 'center', padding: 12 },
  successBox: { alignItems: 'center', padding: 60 },
  successIcon: { fontSize: 48, marginBottom: 16 },
  successText: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  successSub: { color: GREY, fontSize: 13 },
});