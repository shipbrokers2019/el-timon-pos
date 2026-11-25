import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.eltimon.pos',
  appName: 'El Timón POS',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
    backgroundColor: '#FAF8F4',
  },
};

export default config;
