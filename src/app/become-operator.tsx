// app/become-operator.tsx
//
// UPDATED (product decision): now reached AFTER payment, not before.
// The registration flow is: tap "Become a..." in profile.tsx → pay the
// $10 fee directly (delivery-operator-register-pay.tsx /
// operator-register-pay.tsx) → land here to fill in vehicle details.
// Previously this screen came BEFORE payment; moved to reduce friction
// on the actual "become an operator" decision — pay first, fill in the
// details once you're already committed, rather than asking for
// details before someone's even paid.
//
// Both payment screens' own success-screen buttons now route here
// (type param distinguishes which), instead of going straight to
// operator-requests.tsx / dealer.tsx.
//
// account_type still gets set here for BOTH types — even though
// transport's own payment confirmation already sets it directly (see
// confirm-payment.ts's transport_operator_registration branch), a
// redundant write of the same value here is harmless, and delivery's
// payment confirmation never touches profiles.account_type at all, so
// this is the only place that actually happens for delivery operators.
//
// FIX (real bug, confirmed by direct report): "Finish setup" always
// routed to /dealer regardless of type, even though the delivery-side
// note below explicitly promises ID verification as the immediate next
// step. The text and the actual navigation were simply disconnected —
// a user following the promised flow would land on the dashboard with
// no upload screen anywhere in sight, having to discover
// dealer.tsx's verification card on their own to ever find it. Now
// genuinely routes there for delivery operators. See handleSubmit().
//
// FIX (real data-loss bug, found during a thorough review): the
// "General area / city" field had its own state and its own real
// TextInput, but delivery_operators never had a column for it —
// confirmed against the actual schema (see
// add-delivery-area-column.sql, which adds delivery_area). Every
// delivery operator who filled this field in had that value silently
// discarded on submit — no error, form succeeded, data just vanished.
// Now actually included in the delivery_operators update below.
//
// Usage: router.push('/become-operator?type=delivery')
//     or router.push('/become-operator?type=operator')

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

export default function BecomeOperatorScreen() {
  const router = useRouter();
  const { type } = useLocalSearchParams<{ type: 'delivery' | 'operator' }>();
  const isDelivery = type === 'delivery';

  const [vehicleType, setVehicleType] = useState('');
  const [vehicleCapacity, setVehicleCapacity] = useState('');
  const [deliveryVehicleType, setDeliveryVehicleType] = useState('');
  const [deliveryArea, setDeliveryArea] = useState('');

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  async function handleSubmit() {
    setErrorMsg('');

    if (isDelivery && !deliveryVehicleType.trim()) {
      setErrorMsg('Please enter your vehicle type.');
      return;
    }
    if (!isDelivery && !vehicleType.trim()) {
      setErrorMsg('Please enter your vehicle type.');
      return;
    }

    setLoading(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setErrorMsg('You need to be signed in to do this.');
      setLoading(false);
      return;
    }

    const storedType = isDelivery ? 'delivery' : 'transport_operator';

    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        account_type: storedType,
        vehicle_type: isDelivery ? deliveryVehicleType : vehicleType,
        vehicle_capacity: isDelivery ? null : (parseInt(vehicleCapacity) || null),
      })
      .eq('id', user.id);

    if (profileError) {
      setErrorMsg('Something went wrong: ' + profileError.message);
      setLoading(false);
      return;
    }

    if (isDelivery) {
      const { error: deliveryError } = await supabase
        .from('delivery_operators')
        .update({
          vehicle_type: deliveryVehicleType,
          // FIX: was missing entirely — see top-of-file comment. This
          // is the only line needed once the column actually exists.
          delivery_area: deliveryArea.trim() || null,
        })
        .eq('user_id', user.id);

      if (deliveryError) {
        setErrorMsg('Something went wrong saving your vehicle details: ' + deliveryError.message);
        setLoading(false);
        return;
      }
    }

    setLoading(false);

    if (isDelivery) {
      router.replace('/operator-id-verify?type=delivery_operator');
    } else {
      router.replace('/dealer');
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>
          {isDelivery ? '📦 You\'re registered! Last step' : '🚐 You\'re registered! Last step'}
        </Text>
        <Text style={styles.subtitle}>
          {isDelivery
            ? 'Payment received — just add your vehicle details and you\'re ready to start accepting deliveries.'
            : 'Payment received — just add your vehicle details and you\'re ready to start bidding on trips.'}
        </Text>

        {isDelivery ? (
          <>
            <Text style={styles.label}>Vehicle Type</Text>
            <TextInput style={styles.input} placeholder="e.g. Motorbike, Car, Taxi, Bus, Bakkie"
              placeholderTextColor="#888" value={deliveryVehicleType} onChangeText={setDeliveryVehicleType} />
            <Text style={styles.label}>General area / city</Text>
            <TextInput style={styles.input} placeholder="e.g. Harare, Bulawayo, or both"
              placeholderTextColor="#888" value={deliveryArea} onChangeText={setDeliveryArea} />
            <View style={styles.note}>
              <Text style={styles.noteText}>
                🪪 Next, submit your national ID to become a verified operator and appear higher in delivery requests.
              </Text>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.label}>Vehicle Type</Text>
            <TextInput style={styles.input} placeholder="e.g. Van, Minibus, Bus" placeholderTextColor="#888"
              value={vehicleType} onChangeText={setVehicleType} />
            <Text style={styles.label}>Passenger Capacity</Text>
            <TextInput style={styles.input} placeholder="e.g. 8" placeholderTextColor="#888"
              value={vehicleCapacity} onChangeText={setVehicleCapacity} keyboardType="numeric" />
          </>
        )}

        {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}

        <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={loading}>
          {loading ? <ActivityIndicator color={BLACK} /> : <Text style={styles.buttonText}>Finish setup</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BLACK },
  content: { padding: 24, paddingBottom: 48 },
  backBtn: { marginBottom: 16 },
  backText: { color: GREY, fontSize: 14 },
  title: { fontSize: 20, fontWeight: '800', color: '#fff', marginBottom: 8 },
  subtitle: { fontSize: 13, color: GREY, lineHeight: 19, marginBottom: 24 },
  label: { color: '#ccc', fontSize: 14, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: DARK, color: '#fff', borderRadius: 8, padding: 12, fontSize: 16, borderWidth: 1, borderColor: '#444' },
  note: { backgroundColor: '#1a1a2e', borderRadius: 8, padding: 12, marginTop: 16, borderWidth: 0.5, borderColor: '#3a3a5e' },
  noteText: { color: '#8888aa', fontSize: 11, lineHeight: 16 },
  error: { color: '#ff6b6b', marginTop: 16, textAlign: 'center' },
  button: { backgroundColor: GOLD, borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 24 },
  buttonText: { color: BLACK, fontWeight: 'bold', fontSize: 16 },
});
