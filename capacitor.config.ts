import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.varoonenglish.app',
  appName: 'VaronEnglish',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    allowNavigation: [
      'app.varoonenglish.com',
      '*.varoonenglish.com',
      '*.stripe.com',
      '*.phonepe.com',
      '*.youtube.com',
      '*.googlevideo.com',
      '*.ytimg.com',
    ],
  },
};

export default config;
