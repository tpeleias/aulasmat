import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.aulasmat.app',
  appName: 'Aulas',
  webDir: 'dist',
  plugins: {
    Preferences: {
      group: 'AulasMatPrefs',
    },
  },
};

export default config;
