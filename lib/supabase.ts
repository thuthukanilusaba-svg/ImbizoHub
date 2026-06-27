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
  },
  realtime: {
    transport: ws,
  },
});