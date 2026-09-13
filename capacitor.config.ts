import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.aulasmat.app',
  appName: 'Portal de Aulas',
  webDir: 'dist',
  plugins: {
    Preferences: {
      group: 'AulasMatPrefs',
    },
  },
};

export default config;
