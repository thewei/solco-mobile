// Expo Project UUID is public app configuration, not a credential. Native
// Android FCM setup and an EAS project are required before registering tokens.
import Constants from 'expo-constants';

export function expoProjectId(): string | null {
  const configured = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  return typeof configured === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(configured) ? configured : null;
}
