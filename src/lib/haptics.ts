import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

const native = () => Capacitor.isNativePlatform();

export const haptics = {
  tap: () => { if (native()) Haptics.impact({ style: ImpactStyle.Light }).catch(() => {}); },
  success: () => { if (native()) Haptics.notification({ type: NotificationType.Success }).catch(() => {}); },
  warning: () => { if (native()) Haptics.notification({ type: NotificationType.Warning }).catch(() => {}); },
};
