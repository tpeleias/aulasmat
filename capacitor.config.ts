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
    // Login com o Google nativo do Android (src/lib/googleLogin.ts). Só o
    // Google: o Facebook traria o SDK dele e a permissão de ID de publicidade,
    // que a ficha da Play Store declara que o app não usa.
    // Notificações (05/10): no Android quem desenha é o sistema, com o ícone
    // ic_stat_cronys e o canal "cronys" (src/lib/push.ts cria o canal).
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    SocialLogin: {
      providers: { google: true, facebook: false, apple: false, twitter: false },
      logLevel: 1,
    },
  },
};

export default config;
