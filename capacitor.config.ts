import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // O appId continua `com.aulasmat.app`: ele é a identidade da ficha na Play
  // Store e não pode mudar num app já publicado. O nome que o usuário vê é o
  // appName abaixo, e esse sim virou Cronys.
  appId: 'com.aulasmat.app',
  appName: 'Cronys',
  webDir: 'dist',
  plugins: {
    Preferences: {
      // Também fica: é a chave do armazenamento local no aparelho. Trocá-la
      // não renomeia nada visível, só faz o app perder o que já guardou.
      group: 'AulasMatPrefs',
    },
  },
};

export default config;
