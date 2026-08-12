// app/dealer.tsx
// Dealer/Operator dashboard
// Shows dealer stats + inventory for anyone with at least one listing
// (myListingCount > 0) — CONFIRMED as the intended definition during a
// review pass, not account_type === 'seller' as an earlier version of
// this comment claimed. accountType was being fetched into state but
// never actually used anywhere in the component; removed for clarity
// rather than left as dead state implying a gate that doesn't exist.
// Given any real account can post a listing regardless of account_type,
// "has a listing" is the more meaningful real-world signal for whether
// someone needs dealer tools — a delivery operator who also sells a
// few things should see listing management too, matching the same
// dual-role spirit already used elsewhere in this file.
//
// Shows delivery jobs for paid delivery operators
// Both sections render independently — a seller who is ALSO a paid delivery
// operator sees both, not just one. Previously these were mutually
// exclusive (isDeliveryOperator ? delivery : dealer), which meant a
// dual-role user could never see their dealer stats, and — separately —
// ANY non-delivery-operator (including plain buyers) was shown the fake
// dealer stats regardless of account type. Both are fixed here, including
// the header, which previously always showed "Dealer dashboard / Moyo
// Motors" branding even for users with no dealer role at all.
//
// HEADER FIX (dual-role users): previously headerIsDelivery = isDeliveryOperator
// meant a user who is BOTH a seller and an active delivery operator always
// got the "Delivery Dashboard / DRIVER" header, even though their dealer
// stats section also renders further down the same screen — the header
// never reflected the seller identity at all for dual-role users. Rather
// than picking one role to win, dual-role users now get a neutral
// "Dashboard" title with BOTH the PRO and DRIVER badges shown together,
// and a subtitle that reflects both identities. Single-role users see
// exactly what they saw before — no change for them.
//
// FIX: bottom nav now accounts for the device's own safe-area inset
// (gesture bar / nav buttons) instead of a hardcoded paddingBottom,
// which was overlapping with the system navigation on some phones.
//
// FIX: wrapped only the scrollable content (not the whole screen,
// including the persistent bottom nav) in KeyboardAvoidingView — same
// scoping reasoning as profile.tsx/explore.tsx. The delivery PIN entry
// field (pinEntryBox, inline within the scrollable job list — not a
// Modal) was being covered by the keyboard; wrapping the whole screen
// instead would have shifted the absolutely-positioned bottom nav
// around unexpectedly whenever that field was focused.
//
// NEW: item-size badge added to both job card sections (Open delivery
// requests + My deliveries) — closes a real gap found during a final
// review: the item-size pricing tier and driver-matching filter were
// built, but nothing ever actually SHOWED the size to the operator
// deciding whether to accept a job. An operator could see the fee
// ($15) without any clear signal that meant "large item, bring a
// van/truck" specifically.
//
// FIX (real race-condition bug, found during a thorough review):
// acceptJob() and confirmDelivery() both relied on a `.eq('status',
// 'requested')` / `.eq('pin', entered)` guard to prevent double-
// acceptance or a stale-PIN confirmation — a correct guard on its own,
// but neither call checked how many rows it actually matched. If two
// operators tapped "Accept" on the same job near-simultaneously, the
// losing operator's update would match ZERO rows (the other operator
// already changed the status) yet still return no error — and the code
// treated "no error" as success regardless, optimistically showing the
// job in the losing operator's own "My deliveries" list even though the
// database never actually assigned it to them. Same pattern in
// confirmDelivery(): a buyer regenerating their PIN at the wrong moment
// could cause an operator's correct-at-the-time PIN entry to silently
// match nothing, while still being shown as "confirmed." Both now use
// .select() and explicitly check whether any row actually came back
// before treating the action as successful.

import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

export default function DealerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [myId, setMyId] = useState('');
  const [myListingCount, setMyListingCount] = useState(0);
  const [myFullName, setMyFullName] = useState('');
  const [myEmail, setMyEmail] = useState('');
  const [deliveryOperator, setDeliveryOperator] = useState<any>(null);
  const [registrationRequired, setRegistrationRequired] = useState(false);
  const [openJobs, setOpenJobs] = useState<any[]>([]);
  const [myJobs, setMyJobs] = useState<any[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [acceptError, setAcceptError] = useState('');
  const [pinInputs, setPinInputs] = useState<Record<string, string>>({});
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [pinErrors, setPinErrors] = useState<Record<string, string>>({});
  const [dealerProActive, setDealerProActive] = useState(false);
  const [dealerProExpiresAt, setDealerProExpiresAt] = useState<string | null>(null);
  const [pendingConfirmations, setPendingConfirmations] = useState<any[]>([]);

  useEffect(() => {
    loadUser();
  }, []);

  async function loadUser() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setMyId(user.id);
    setMyEmail(user.email ?? '');

    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, dealer_pro_active, dealer_pro_expires_at')
      .eq('id', user.id)
      .maybeSingle();

    if (profile) {
      setMyFullName(profile.full_name ?? '');
      setDealerProActive(!!(
        profile.dealer_pro_active &&
        profile.dealer_pro_expires_at &&
        new Date(profile.dealer_pro_expires_at).getTime() > Date.now()
      ));
      setDealerProExpiresAt(profile.dealer_pro_expires_at ?? null);
    }

    const { count: listingCount } = await supabase
      .from('listings')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);
    setMyListingCount(listingCount ?? 0);

    const { data: operator } = await supabase
      .from('delivery_operators')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (operator) {
      const isPaidAndCurrent = operator.registration_paid &&
        operator.registration_expires_at &&
        new Date(operator.registration_expires_at).getTime() > Date.now();

      if (isPaidAndCurrent) {
        setDeliveryOperator(operator);
        loadDeliveryJobs(operator.id, user.id);
      } else {
        setRegistrationRequired(true);
      }
    }

    loadPendingConfirmations(user.id);
  }

  async function loadPendingConfirmations(userId: string) {
    const { data: sessions } = await supabase
      .from('meetpay_sessions')
      .select('id, type, reference_id, buyer_id, created_at')
      .eq('seller_id', userId)
      .eq('status', 'pending')
      .gt('pin_expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (!sessions || sessions.length === 0) {
      setPendingConfirmations([]);
      return;
    }

    const withLabels = await Promise.all(
      sessions.map(async (s) => {
        if (s.type === 'item_request') {
          const { data } = await supabase
            .from('item_requests')
            .select('title')
            .eq('id', s.reference_id)
            .maybeSingle();
          return { ...s, itemLabel: data?.title || 'an item' };
        }
        const { data } = await supabase
          .from('listings')
          .select('title')
          .eq('id', s.reference_id)
          .maybeSingle();
        return { ...s, itemLabel: data?.title || 'a listing' };
      })
    );

    setPendingConfirmations(withLabels);
  }

  async function loadDeliveryJobs(operatorId: string, userId: string) {
    setLoadingJobs(true);

    const { data: open } = await supabase
      .from('delivery_bookings')
      .select('*, listings(title, price), item_requests(title)')
      .eq('status', 'requested')
      .order('requested_at', { ascending: false });

    setOpenJobs(open ?? []);

    const { data: mine } = await supabase
      .from('delivery_bookings')
      .select('*, listings(title, price), item_requests(title)')
      .eq('operator_id', operatorId)
      .neq('status', 'requested')
      .order('accepted_at', { ascending: false });

    setMyJobs(mine ?? []);
    setLoadingJobs(false);
  }

  async function acceptJob(bookingId: string) {
    if (!deliveryOperator) return;
    setAcceptingId(bookingId);
    setAcceptError('');

    // FIX: added .select() and now checks whether any row actually
    // came back — see top-of-file comment. Without this, a losing
    // operator in a race against another operator accepting the same
    // job would see a false "success."
    const { data, error } = await supabase
      .from('delivery_bookings')
      .update({
        operator_id: deliveryOperator.id,
        status: 'accepted',
        accepted_at: new Date().toISOString(),
      })
      .eq('id', bookingId)
      .eq('status', 'requested')
      .select();

    setAcceptingId(null);

    if (error) {
      setAcceptError(error.message);
      return;
    }

    if (!data || data.length === 0) {
      // Someone else already accepted this job in the time between it
      // loading and this tap — remove it from the open list so it
      // doesn't look falsely still available, and say so plainly
      // rather than silently doing nothing.
      setOpenJobs(prev => prev.filter(j => j.id !== bookingId));
      setAcceptError('This job was just accepted by another driver.');
      return;
    }

    const job = openJobs.find(j => j.id === bookingId);
    if (job) {
      setOpenJobs(prev => prev.filter(j => j.id !== bookingId));
      setMyJobs(prev => [{ ...job, status: 'accepted', operator_id: deliveryOperator.id }, ...prev]);
    }
  }

  async function markDispatched(bookingId: string) {
    const { error } = await supabase
      .from('delivery_bookings')
      .update({ status: 'dispatched', dispatched_at: new Date().toISOString() })
      .eq('id', bookingId);

    if (!error) {
      setMyJobs(prev => prev.map(j => j.id === bookingId ? { ...j, status: 'dispatched' } : j));
    }
  }

  async function markDelivered(bookingId: string) {
    const { error } = await supabase
      .from('delivery_bookings')
      .update({ status: 'delivered', delivered_at: new Date().toISOString() })
      .eq('id', bookingId);

    if (!error) {
      setMyJobs(prev => prev.map(j => j.id === bookingId ? { ...j, status: 'delivered' } : j));
    }
  }

  function setPinForJob(bookingId: string, value: string) {
    setPinInputs(prev => ({ ...prev, [bookingId]: value.replace(/[^0-9]/g, '').slice(0, 4) }));
    setPinErrors(prev => ({ ...prev, [bookingId]: '' }));
  }

  async function confirmDelivery(job: any) {
    const entered = pinInputs[job.id] || '';
    setPinErrors(prev => ({ ...prev, [job.id]: '' }));

    if (entered.length !== 4) {
      setPinErrors(prev => ({ ...prev, [job.id]: 'Enter the 4-digit PIN.' }));
      return;
    }
    if (!job.pin) {
      setPinErrors(prev => ({ ...prev, [job.id]: 'Buyer has not generated a PIN yet.' }));
      return;
    }
    if (job.pin_expires_at && new Date(job.pin_expires_at).getTime() < Date.now()) {
      setPinErrors(prev => ({ ...prev, [job.id]: 'This PIN has expired. Ask the buyer to generate a new one.' }));
      return;
    }
    if (entered !== job.pin) {
      setPinErrors(prev => ({ ...prev, [job.id]: 'Incorrect PIN. Check with the buyer and try again.' }));
      return;
    }

    setConfirmingId(job.id);

    // FIX: added .select() and now checks whether any row came back —
    // same reasoning as acceptJob() above. If the buyer regenerated
    // their PIN in the moment between this screen loading job.pin and
    // this submit, the .eq('pin', entered) guard would correctly
    // reject the stale PIN by matching zero rows — but the old code
    // only checked for a query ERROR, which this isn't, so it would
    // have shown "confirmed" without anything actually being confirmed.
    const { data, error } = await supabase
      .from('delivery_bookings')
      .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
      .eq('id', job.id)
      .eq('pin', entered)
      .select();

    setConfirmingId(null);

    if (error) {
      setPinErrors(prev => ({ ...prev, [job.id]: error.message }));
      return;
    }

    if (!data || data.length === 0) {
      setPinErrors(prev => ({
        ...prev,
        [job.id]: 'That PIN no longer matches — ask the buyer for their current PIN and try again.',
      }));
      return;
    }

    setMyJobs(prev => prev.map(j => j.id === job.id ? { ...j, status: 'confirmed' } : j));
    setPinInputs(prev => ({ ...prev, [job.id]: '' }));
  }

  function statusColor(status: string) {
    const map: Record<string, string> = {
      requested: '#888',
      accepted: '#4A90D9',
      dispatched: GOLD,
      delivered: '#4fc96e',
      confirmed: '#4fc96e',
    };
    return map[status] ?? '#888';
  }

  function statusLabel(status: string) {
    const map: Record<string, string> = {
      requested: 'Open',
      accepted: 'Accepted',
      dispatched: 'In transit',
      delivered: 'Delivered — awaiting PIN',
      confirmed: 'Completed',
    };
    return map[status] ?? status;
  }

  function myInitials() {
    if (myFullName) return myFullName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    return myEmail ? myEmail[0].toUpperCase() : '?';
  }

  const isDeliveryOperator = !!deliveryOperator;
  const isSeller = myListingCount > 0;
  const isDualRole = isSeller && isDeliveryOperator;
  const headerIsDelivery = isDeliveryOperator;
  const nothingToShow = !isDeliveryOperator && !isSeller && !registrationRequired;
  const showRoleHeader = isSeller || registrationRequired || isDeliveryOperator;

  const headerTitleText = isDualRole
    ? 'Dashboard'
    : headerIsDelivery
      ? 'Delivery Dashboard'
      : 'Dealer dashboard';

  const headerSubText = isDualRole
    ? `Moyo Motors · Harare · ${deliveryOperator.vehicle_type || 'Delivery Operator'}`
    : headerIsDelivery
      ? `${deliveryOperator.full_name} · ${deliveryOperator.vehicle_type || 'Delivery Operator'}`
      : 'Moyo Motors · Harare';

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView showsVerticalScrollIndicator={false}>

          {/* Header */}
          <View style={styles.header}>
            <View>
              {showRoleHeader ? (
                <>
                  <View style={styles.headerTitle}>
                    <Text style={styles.headerTitleText}>{headerTitleText}</Text>

                    {isDualRole ? (
                      <View style={styles.badgeRow}>
                        <View style={styles.proBadge}>
                          <Text style={styles.proBadgeText}>PRO</Text>
                        </View>
                        <View style={styles.proBadge}>
                          <Text style={styles.proBadgeText}>DRIVER</Text>
                        </View>
                      </View>
                    ) : (
                      <View style={styles.proBadge}>
                        <Text style={styles.proBadgeText}>{headerIsDelivery ? 'DRIVER' : 'PRO'}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.headerSub}>{headerSubText}</Text>
                </>
              ) : (
                <Text style={styles.headerTitleText}>Dashboard</Text>
              )}
            </View>
            <View style={styles.dealerAvatar}>
              <Text style={styles.dealerAvatarText}>
                {isSeller
                  ? 'MM'
                  : headerIsDelivery
                    ? (deliveryOperator.full_name?.[0] ?? 'D')
                    : myInitials()}
              </Text>
            </View>
          </View>

          {pendingConfirmations.length > 0 && (
            <View style={styles.section}>
              <View style={styles.pendingConfirmCard}>
                <Text style={styles.pendingConfirmTitle}>
                  🔑 {pendingConfirmations.length === 1
                    ? '1 deal is waiting for your PIN confirmation'
                    : `${pendingConfirmations.length} deals are waiting for your PIN confirmation`}
                </Text>
                {pendingConfirmations.map((s) => (
                  <TouchableOpacity
                    key={s.id}
                    style={styles.pendingConfirmRow}
                    onPress={() =>
                      router.push(
                        s.type === 'item_request'
                          ? `/chat?item_request_id=${s.reference_id}&receiver_id=${s.buyer_id}&openDeal=1`
                          : `/chat?listing_id=${s.reference_id}&receiver_id=${s.buyer_id}&openDeal=1`
                      )
                    }
                  >
                    <Text style={styles.pendingConfirmItemText} numberOfLines={1}>
                      {s.itemLabel}
                    </Text>
                    <Text style={styles.pendingConfirmArrow}>Confirm PIN →</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {registrationRequired && (
            <View style={styles.section}>
              <View style={styles.regRequiredCard}>
                <Text style={styles.regRequiredEmoji}>📦</Text>
                <Text style={styles.regRequiredTitle}>Complete your registration</Text>
                <Text style={styles.regRequiredBody}>
                  Pay the one-time $10 registration fee to unlock delivery jobs and appear in the driver list. Valid for 12 months.
                </Text>
                <TouchableOpacity
                  style={styles.regRequiredBtn}
                  onPress={() => router.push('/delivery-operator-register-pay')}
                >
                  <Text style={styles.regRequiredBtnText}>Pay $10 to activate →</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {nothingToShow && (
            <View style={styles.section}>
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>Nothing to show here yet.</Text>
                <Text style={styles.emptySubText}>This dashboard is for sellers and registered delivery operators.</Text>
              </View>
            </View>
          )}

          {isDeliveryOperator && (
            <>
              <View style={styles.section}>
                <View style={styles.verificationCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.verificationTitle}>
                      {deliveryOperator.verification_tier === 'trusted' ? '✅ Trusted Operator'
                        : deliveryOperator.verification_tier === 'id_verified' ? '🔵 ID Verified'
                        : '⚠️ Unverified'}
                        </Text>
                    {deliveryOperator.verification_tier === 'unverified' ? (
                    <TouchableOpacity
                      onPress={() => router.push('/operator-id-verify?type=delivery_operator')}
                    >
                      <Text style={[styles.verificationSub, { textDecorationLine: 'underline' }]}>
                        Submit your national ID to become verified and get more jobs.
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.verificationSub}>
                      {deliveryOperator.verification_tier === 'trusted'
                        ? 'You appear first in all delivery requests.'
                        : 'Submit an affidavit and referee to become Trusted.'}
                    </Text>
                  )}
                  </View>
                  {deliveryOperator.rating_count > 0 && (
                    <View style={{ alignItems: 'center' }}>
                      <Text style={styles.driverRatingBig}>{deliveryOperator.rating.toFixed(1)}</Text>
                      <Text style={styles.driverRatingSub}>★ ({deliveryOperator.rating_count})</Text>
                    </View>
                  )}
                </View>
              </View>

              <View style={styles.section}>
                <View style={styles.sectionRow}>
                  <Text style={styles.sectionTitle}>📦 Open delivery requests</Text>
                  <TouchableOpacity onPress={() => deliveryOperator && loadDeliveryJobs(deliveryOperator.id, myId)}>
                    <Text style={styles.refreshText}>Refresh</Text>
                  </TouchableOpacity>
                </View>

                {acceptError ? (
                  <View style={styles.acceptErrorBox}><Text style={styles.acceptErrorText}>⚠️ {acceptError}</Text></View>
                ) : null}

                {loadingJobs ? (
                  <ActivityIndicator color={GOLD} style={{ marginTop: 20 }} />
                ) : openJobs.length === 0 ? (
                  <View style={styles.emptyBox}>
                    <Text style={styles.emptyText}>No open delivery requests right now.</Text>
                    <Text style={styles.emptySubText}>Check back later — new requests appear here as sellers book deliveries.</Text>
                  </View>
                ) : (
                  openJobs.map((job) => (
                    <View key={job.id} style={styles.jobCard}>
                      <View style={styles.jobHeader}>
                        <Text style={styles.jobRoute}>{job.pickup_city} → {job.dropoff_city}</Text>
                        <View style={[styles.jobTypeBadge, { backgroundColor: job.delivery_type === 'intercity' ? '#1a1a2e' : '#1a2a1a' }]}>
                          <Text style={[styles.jobTypeBadgeText, { color: job.delivery_type === 'intercity' ? '#8888ff' : '#4fc96e' }]}>
                            {job.delivery_type === 'intercity' ? '🚌 Intercity' : '🛵 Local'}
                          </Text>
                        </View>
                      </View>

                      {job.parcel_size && (
                        <View style={[
                          styles.jobSizeBadge,
                          job.parcel_size === 'large' && styles.jobSizeBadgeLarge,
                        ]}>
                          <Text style={[
                            styles.jobSizeBadgeText,
                            job.parcel_size === 'large' && styles.jobSizeBadgeTextLarge,
                          ]}>
                            {job.parcel_size === 'large' ? '🚚 Large item — bring a van or truck' : '🚗 Small item — fits in a car'}
                          </Text>
                        </View>
                      )}

                      {(job.listings || job.item_requests) && (
                        <Text style={styles.jobItem}>Item: {job.listings?.title || job.item_requests?.title}</Text>
                      )}
                      {job.parcel_description && (
                        <Text style={styles.jobDesc}>{job.parcel_description}</Text>
                      )}

                      <View style={styles.jobFooter}>
                        <View>
                          <Text style={styles.jobFeeLabel}>You earn</Text>
                          <Text style={styles.jobFee}>${job.delivery_fee} cash</Text>
                        </View>
                        <TouchableOpacity
                          style={[styles.acceptBtn, acceptingId === job.id && { opacity: 0.6 }]}
                          onPress={() => acceptJob(job.id)}
                          disabled={acceptingId === job.id}
                        >
                          {acceptingId === job.id
                            ? <ActivityIndicator color={BLACK} size="small" />
                            : <Text style={styles.acceptBtnText}>Accept job</Text>
                          }
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))
                )}
              </View>

              {myJobs.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>My deliveries</Text>
                  {myJobs.map((job) => (
                    <View key={job.id} style={styles.jobCard}>
                      <View style={styles.jobHeader}>
                        <Text style={styles.jobRoute}>{job.pickup_city} → {job.dropoff_city}</Text>
                        <Text style={[styles.statusText, { color: statusColor(job.status) }]}>
                          {statusLabel(job.status)}
                        </Text>
                      </View>

                      {job.parcel_size && (
                        <View style={[
                          styles.jobSizeBadge,
                          job.parcel_size === 'large' && styles.jobSizeBadgeLarge,
                        ]}>
                          <Text style={[
                            styles.jobSizeBadgeText,
                            job.parcel_size === 'large' && styles.jobSizeBadgeTextLarge,
                          ]}>
                            {job.parcel_size === 'large' ? '🚚 Large item' : '🚗 Small item'}
                          </Text>
                        </View>
                      )}

                      {(job.listings || job.item_requests) && (
                        <Text style={styles.jobItem}>Item: {job.listings?.title || job.item_requests?.title}</Text>
                      )}

                      <View style={styles.jobFooter}>
                        <Text style={styles.jobFee}>${job.delivery_fee} cash</Text>
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          {job.status === 'accepted' && (
                            <TouchableOpacity style={styles.statusBtn} onPress={() => markDispatched(job.id)}>
                              <Text style={styles.statusBtnText}>Mark dispatched</Text>
                            </TouchableOpacity>
                          )}
                          {job.status === 'dispatched' && (
                            <TouchableOpacity style={styles.statusBtn} onPress={() => markDelivered(job.id)}>
                              <Text style={styles.statusBtnText}>Mark delivered</Text>
                            </TouchableOpacity>
                          )}
                          {job.status === 'confirmed' && (
                            <View style={styles.completedBadge}>
                              <Text style={styles.completedBadgeText}>✅ Complete</Text>
                            </View>
                          )}
                        </View>
                      </View>

                      {job.status === 'delivered' && (
                        <View style={styles.pinEntryBox}>
                          <Text style={styles.pinEntryLabel}>Ask the buyer for their 4-digit PIN</Text>
                          <View style={styles.pinEntryRow}>
                            <TextInput
                              style={styles.pinEntryInput}
                              value={pinInputs[job.id] || ''}
                              onChangeText={(t) => setPinForJob(job.id, t)}
                              placeholder="0000"
                              placeholderTextColor="#555"
                              keyboardType="number-pad"
                              maxLength={4}
                            />
                            <TouchableOpacity
                              style={[
                                styles.pinConfirmBtn,
                                (confirmingId === job.id || (pinInputs[job.id] || '').length !== 4) && { opacity: 0.5 },
                              ]}
                              onPress={() => confirmDelivery(job)}
                              disabled={confirmingId === job.id || (pinInputs[job.id] || '').length !== 4}
                            >
                              {confirmingId === job.id
                                ? <ActivityIndicator color={BLACK} size="small" />
                                : <Text style={styles.pinConfirmBtnText}>Confirm</Text>
                              }
                            </TouchableOpacity>
                          </View>
                          {pinErrors[job.id] ? (
                            <Text style={styles.pinErrorText}>⚠️ {pinErrors[job.id]}</Text>
                          ) : null}
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              )}

              {isSeller && <View style={styles.sectionDividerBig} />}
            </>
          )}

          {isSeller && (
            <>
              {isDeliveryOperator && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>🏪 Dealer dashboard</Text>
                </View>
              )}

              <View style={styles.section}>
                <TouchableOpacity style={styles.analyticsTeaser} onPress={() => router.push('/analytics')}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.analyticsTeaserTitle}>📊 Listing performance</Text>
                    <Text style={styles.analyticsTeaserSub}>
                      {dealerProActive
                        ? 'Real numbers from your listings'
                        : 'Dealer Pro benefit — see what\'s included'}
                    </Text>
                  </View>
                  <Text style={styles.analyticsTeaserArrow}>›</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.section}>
                <Text style={styles.lbl}>QUICK ACTIONS</Text>
                <View style={styles.actionsGrid}>
                  <TouchableOpacity style={styles.actionPrimary} onPress={() => router.push('/post')}>
                    <Text style={styles.actionIcon}>+</Text>
                    <Text style={styles.actionPrimaryText}>Add listing</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.actionSecondary} onPress={() => router.push('/analytics')}>
                    <Text style={styles.actionIcon}>📊</Text>
                    <Text style={styles.actionSecondaryText}>Analytics</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.actionSecondary} onPress={() => router.push('/explore')}>
                    <Text style={styles.actionIcon}>⭐</Text>
                    <Text style={styles.actionSecondaryText}>Boost listing</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.divider} />

              <View style={styles.section}>
                {dealerProActive ? (
                  <TouchableOpacity
                    style={styles.subCard}
                    onPress={() => router.push('/dealer-pro-pay')}
                  >
                    <View>
                      <Text style={styles.subName}>Dealer Pro Plan</Text>
                      <Text style={styles.subDetail}>
                        {dealerProExpiresAt
                          ? `Active · Renews ${new Date(dealerProExpiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
                          : 'Active'}
                      </Text>
                    </View>
                    <Text style={styles.subManage}>Manage</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={[styles.subCard, styles.subCardDisabled]}>
                    <View>
                      <Text style={styles.subName}>Dealer Pro Plan</Text>
                      <Text style={styles.subDetail}>Coming soon</Text>
                    </View>
                  </View>
                )}
              </View>
            </>
          )}

          <View style={{ height: 80 + insets.bottom }} />
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={[styles.bottomNav, { paddingBottom: 24 + insets.bottom }]}>
        <TouchableOpacity style={styles.navItem} onPress={() => router.push('/')}>
          <Text style={styles.navIcon}>🏠</Text>
          <Text style={styles.navLabel}>Home</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={() => router.push('/explore')}>
          <Text style={styles.navIcon}>🔍</Text>
          <Text style={styles.navLabel}>Browse</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navPost} onPress={() => router.push('/post')}>
          <Text style={styles.navPostText}>+</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={() => router.push('/messages')}>
          <Text style={styles.navIcon}>💬</Text>
          <Text style={styles.navLabel}>Messages</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={() => router.push('/dealer')}>
          <Text style={[styles.navIcon, { color: GOLD }]}>🏪</Text>
          <Text style={[styles.navLabel, { color: GOLD }]}>Dashboard</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={() => router.push('/profile')}>
          <Text style={styles.navIcon}>👤</Text>
          <Text style={styles.navLabel}>Profile</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  header: { backgroundColor: BLACK, padding: 16, paddingTop: 50, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitleText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  badgeRow: { flexDirection: 'row', gap: 6 },
  proBadge: { backgroundColor: GOLD, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  proBadgeText: { color: BLACK, fontSize: 9, fontWeight: '800' },
  headerSub: { color: GREY, fontSize: 11, marginTop: 2 },
  dealerAvatar: { width: 40, height: 40, backgroundColor: GOLD, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  dealerAvatarText: { color: BLACK, fontSize: 14, fontWeight: '800' },

  section: { backgroundColor: BLACK, padding: 16, marginBottom: 1 },
  sectionDividerBig: { height: 10, backgroundColor: '#111111' },
  lbl: { color: GREY, fontSize: 11, marginBottom: 8, letterSpacing: 0.5 },
  divider: { height: 0.5, backgroundColor: DARK, marginHorizontal: 16 },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { color: '#fff', fontSize: 13, fontWeight: '700', marginBottom: 4 },
  refreshText: { color: GOLD, fontSize: 11 },

  acceptErrorBox: { backgroundColor: '#3a1a1a', borderRadius: 10, padding: 10, marginBottom: 10 },
  acceptErrorText: { color: '#ff8a8a', fontSize: 12 },

  regRequiredCard: { backgroundColor: DARK, borderRadius: 14, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: GOLD },
  regRequiredEmoji: { fontSize: 40, marginBottom: 10 },
  regRequiredTitle: { color: '#fff', fontSize: 16, fontWeight: '800', marginBottom: 8, textAlign: 'center' },
  regRequiredBody: { color: GREY, fontSize: 12, textAlign: 'center', lineHeight: 18, marginBottom: 18 },
  regRequiredBtn: { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 24 },
  regRequiredBtnText: { color: BLACK, fontSize: 14, fontWeight: '800' },

  pendingConfirmCard: { backgroundColor: DARK, borderRadius: 14, padding: 18, borderWidth: 1, borderColor: GOLD },
  pendingConfirmTitle: { color: '#fff', fontSize: 15, fontWeight: '800', marginBottom: 12 },
  pendingConfirmRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#3a3a3a',
  },
  pendingConfirmItemText: { color: GREY, fontSize: 14, flex: 1, marginRight: 10 },
  pendingConfirmArrow: { color: GOLD, fontSize: 13, fontWeight: '700' },

  verificationCard: { backgroundColor: DARK, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 0.5, borderColor: '#333' },
  verificationTitle: { color: '#fff', fontSize: 13, fontWeight: '700', marginBottom: 4 },
  verificationSub: { color: GREY, fontSize: 11, lineHeight: 16 },
  driverRatingBig: { color: GOLD, fontSize: 24, fontWeight: '800' },
  driverRatingSub: { color: GREY, fontSize: 10 },

  emptyBox: { backgroundColor: DARK, borderRadius: 12, padding: 20, alignItems: 'center', borderWidth: 0.5, borderColor: '#333' },
  emptyText: { color: '#fff', fontSize: 13, fontWeight: '600', marginBottom: 6 },
  emptySubText: { color: GREY, fontSize: 11, textAlign: 'center', lineHeight: 16 },

  jobCard: { backgroundColor: DARK, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 0.5, borderColor: '#333' },
  jobHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  jobRoute: { color: '#fff', fontSize: 14, fontWeight: '700' },
  jobTypeBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  jobTypeBadgeText: { fontSize: 10, fontWeight: '700' },

  jobSizeBadge: { alignSelf: 'flex-start', backgroundColor: '#1a2a1a', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 8 },
  jobSizeBadgeLarge: { backgroundColor: '#3a2800', borderWidth: 1, borderColor: GOLD },
  jobSizeBadgeText: { color: '#4fc96e', fontSize: 11, fontWeight: '700' },
  jobSizeBadgeTextLarge: { color: GOLD },

  jobItem: { color: GREY, fontSize: 12, marginBottom: 4 },
  jobDesc: { color: '#888', fontSize: 11, marginBottom: 8, fontStyle: 'italic' },
  jobFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  jobFeeLabel: { color: GREY, fontSize: 10, marginBottom: 2 },
  jobFee: { color: GOLD, fontSize: 16, fontWeight: '800' },
  acceptBtn: { backgroundColor: GOLD, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  acceptBtnText: { color: BLACK, fontSize: 13, fontWeight: '800' },
  statusText: { fontSize: 11, fontWeight: '700' },
  statusBtn: { backgroundColor: '#1a2a1a', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 0.5, borderColor: '#4fc96e' },
  statusBtnText: { color: '#4fc96e', fontSize: 11, fontWeight: '700' },
  completedBadge: { backgroundColor: '#1a2a1a', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  completedBadgeText: { color: '#4fc96e', fontSize: 11, fontWeight: '700' },

  pinEntryBox: { marginTop: 12, paddingTop: 12, borderTopWidth: 0.5, borderTopColor: '#333' },
  pinEntryLabel: { color: GREY, fontSize: 11, marginBottom: 8 },
  pinEntryRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  pinEntryInput: {
    flex: 1, backgroundColor: BLACK, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14,
    color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: 8, textAlign: 'center',
    borderWidth: 0.5, borderColor: '#444',
  },
  pinConfirmBtn: { backgroundColor: GOLD, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  pinConfirmBtnText: { color: BLACK, fontSize: 13, fontWeight: '800' },
  pinErrorText: { color: '#ff8a8a', fontSize: 11, marginTop: 8 },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: { width: '47.5%', backgroundColor: DARK, borderRadius: 12, padding: 14, borderWidth: 0.5, borderColor: '#333' },
  statCardHighlight: { borderColor: GOLD },
  statLbl: { color: GREY, fontSize: 10, marginBottom: 4, letterSpacing: 0.5 },
  statValGold: { color: GOLD, fontSize: 24, fontWeight: '800' },
  statValWhite: { color: '#fff', fontSize: 24, fontWeight: '800' },
  statTrend: { color: '#4A90D9', fontSize: 11, marginTop: 4 },
  statTrendGrey: { color: '#555', fontSize: 11, marginTop: 4 },
  statTrendGold: { color: GOLD, fontSize: 11, marginTop: 4 },
  analyticsTeaser: { backgroundColor: DARK, borderRadius: 12, padding: 16, flexDirection: 'row', alignItems: 'center', borderWidth: 0.5, borderColor: '#333' },
  analyticsTeaserTitle: { color: '#fff', fontSize: 14, fontWeight: '700', marginBottom: 3 },
  analyticsTeaserSub: { color: GREY, fontSize: 11 },
  analyticsTeaserArrow: { color: GOLD, fontSize: 22, marginLeft: 8 },
  actionsGrid: { flexDirection: 'row', gap: 8 },
  actionPrimary: { flex: 1, backgroundColor: GOLD, borderRadius: 10, padding: 12, alignItems: 'center' },
  actionSecondary: { flex: 1, backgroundColor: DARK, borderRadius: 10, padding: 12, alignItems: 'center', borderWidth: 0.5, borderColor: '#333' },
  actionIcon: { fontSize: 16, marginBottom: 4 },
  actionPrimaryText: { color: BLACK, fontSize: 11, fontWeight: '800' },
  actionSecondaryText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  subCard: { backgroundColor: '#3a2800', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: GOLD, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  subCardDisabled: { backgroundColor: DARK, borderColor: '#444', opacity: 0.7 },
  subName: { color: GOLD, fontSize: 12, fontWeight: '800' },
  subDetail: { color: GREY, fontSize: 11, marginTop: 3 },
  subManage: { color: GOLD, fontSize: 11, fontWeight: '700' },

  bottomNav: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: BLACK, borderTopWidth: 0.5, borderTopColor: DARK, paddingVertical: 10, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  navItem: { alignItems: 'center' },
  navIcon: { fontSize: 22, color: '#555' },
  navLabel: { fontSize: 9, color: '#555', marginTop: 2 },
  navPost: { width: 44, height: 44, backgroundColor: GOLD, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  navPostText: { color: BLACK, fontSize: 24, fontWeight: '700', lineHeight: 28 },
});
