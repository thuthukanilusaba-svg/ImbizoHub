import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import ws from 'ws';

const supabaseUrl = 'https://goughfxpcwxwsfthlmii.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvdWdoZnhwY3d4d3NmdGhsbWlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NDA5MjEsImV4cCI6MjA5ODExNjkyMX0.g4UiWuOJQrr4mPwe8xLrntna_xcCl7gOgFH2jlJn1AI';

const getStorage = () => {
  if (Platform.OS === 'web') return undefined;
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  return AsyncStorage;
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: getStorage(),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // Every screen that handles a Supabase redirect (auth-callback.tsx,
    // reset-password.tsx, lib/oauth.ts's native path) expects a `code`
    // query param and calls exchangeCodeForSession(). Without this flag,
    // the client defaults to the older implicit flow, which returns
    // tokens as a #access_token=... URL hash fragment instead — which
    // none of those screens read, so the exchange always silently
    // "fails" with a missing-code error even though sign-in succeeded.
    flowType: 'pkce',
  },
  realtime: {
    // The `ws` package's constructor is declared more widely than
    // supabase-js's WebSocketLikeConstructor expects (it accepts
    // `string | URL` where the interface narrows that parameter). The two
    // are compatible in practice — this is a disagreement between two
    // libraries' .d.ts files, not a real mismatch — so the cast states
    // that rather than leaving a permanent error in the build.
    transport: ws as unknown as NonNullable<
      NonNullable<Parameters<typeof createClient>[2]>['realtime']
    >['transport'],
  },
});