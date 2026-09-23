// app/s/[slug].tsx
//
// The in-app landing point for a short shop link —
// imbizohub.com/s/kombi-spares. It resolves the slug to a profile id and
// hands straight over to app/seller.tsx, which is the real screen.
//
// ─────────────────────────────────────────────────────────────────────
// WHY THIS FILE HAD TO EXIST BEFORE THE NEXT BUILD, not after.
//
// app.json's Android intent filter now claims pathPrefix "/s" as well as
// "/seller". From the next build onward, Android stops opening a shop
// link in the browser and hands it to the app instead.
//
// Without a route at this exact path, expo-router would match nothing
// and the app would open on its not-found screen. That is STRICTLY
// WORSE than the behaviour being replaced: today the link opens the web
// page, which renders the shop and then redirects into the app through
// the imbizohub:// scheme. It works. Claiming the path without handling
// it would take a working link and break it, for installed users only —
// the people most likely to be the dealer testing their own link.
//
// This is the same shape as the bug seller.tsx's header describes: an
// intent filter that pointed at a route which did not exist, so every
// shared link opened the app to "not found". It is worth not doing that
// twice.
//
// SHIPPABLE OVER THE AIR. A new route file is JavaScript, so this
// reaches existing installs in the next `eas update`. The intent filter
// is the part that needs a build. Shipping them in that order — route
// first, filter second — means there is never a window where the path
// is claimed and unhandled.
// ─────────────────────────────────────────────────────────────────────
//
// WHY REDIRECT RATHER THAN RENDER: seller.tsx already does everything
// this screen would — catalogue, rating, badges, message button, block
// and report. Duplicating it for the sake of a prettier URL would give
// the app two seller screens that have to be kept in step, and they
// would not stay in step.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { normaliseSlug, SLUG_RE } from '../../../lib/slug';
import { supabase } from '../../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const GREY = '#AAAAAA';

export default function ShopLinkRedirect() {
  const router = useRouter();
  const { slug } = useLocalSearchParams<{ slug?: string }>();
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Normalised before matching, because a link typed off the side of
      // a van arrives in whatever case the person typing it used, and
      // slugs are stored lowercase. "/s/Kombi-Spares" is the same shop.
      const value = normaliseSlug(Array.isArray(slug) ? slug[0] : slug);

      if (!value || !SLUG_RE.test(value)) {
        if (!cancelled) setNotFound(true);
        return;
      }

      // profiles is publicly readable (profiles_select_all USING true),
      // so this resolves for a signed-out visitor too — which matters,
      // since a shop link is the one URL most likely to be opened by
      // somebody who has never used the app.
      const { data } = await supabase
        .from('profiles')
        .select('id')
        .eq('slug', value)
        .maybeSingle();

      if (cancelled) return;

      if (!data?.id) {
        setNotFound(true);
        return;
      }

      // replace, not push: the shop link is an address, not a step. A
      // back tap should leave the app the way it came in, not land on a
      // spinner that immediately redirects again.
      router.replace(`/seller?id=${data.id}`);
    })();

    return () => { cancelled = true; };
  }, [slug]);

  if (notFound) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Shop not found</Text>
        <Text style={styles.body}>
          This shop link may have changed or been removed.
        </Text>
        <TouchableOpacity style={styles.btn} onPress={() => router.replace('/')}>
          <Text style={styles.btnText}>Browse ImbizoHub</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={GOLD} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: '#111111', alignItems: 'center', justifyContent: 'center', padding: 28 },
  title: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 8 },
  body: { color: GREY, fontSize: 13.5, textAlign: 'center', lineHeight: 20, marginBottom: 26 },
  btn: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 30 },
  btnText: { color: BLACK, fontSize: 14, fontWeight: '800' },
});
