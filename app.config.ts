import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Solco',
  slug: 'solco-mobile',
  // `solco` carries the Mac's pairing link (solco://pair?…).
  scheme: 'solco',
  version: '0.12.0',
  orientation: 'portrait',
  userInterfaceStyle: 'dark',
  icon: './assets/icon.png',
  ios: {
    bundleIdentifier: 'com.whstudio.solco.mobile',
    supportsTablet: true,
    infoPlist: { NSMicrophoneUsageDescription: 'Dictate a message to your coding agent; the Mac turns it into text.' },
  },
  android: {
    package: 'com.whstudio.solco.mobile',
    edgeToEdgeEnabled: true,
    // Dictation records in the Chat WebView and the Mac transcribes it (capabilities.voice), so the app
    // asks for the microphone itself; expo-camera's own request stays off (recordAudioAndroid: false below).
    permissions: ['android.permission.RECORD_AUDIO'],
    predictiveBackGestureEnabled: true,
    // Cleartext note: the Host API is plain http://<lan-ip>:8756, but SDK 54's
    // ExpoConfig has no usesCleartextTraffic field. The flag lives directly in
    // android/app/src/main/AndroidManifest.xml (android:usesCleartextTraffic="true").
    // If android/ is ever regenerated with --clean, re-add it to the manifest.
    icon: './assets/icon.png',
    adaptiveIcon: {
      foregroundImage: './assets/android-adaptive-fg.png',
      backgroundImage: './assets/icon.png',
    },
  },
  web: {
    output: 'static',
    favicon: './public/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    // Local notifications only: remote push would need FCM (absent on China vivo ROMs) or the
    // vivo channel (requires a store listing) — both deferred; see implementation-roadmap M6.
    'expo-notifications',
    // "Share to Solco": Android text/links only (iOS would need a share extension target; not offered).
    ['expo-share-intent', { disableIOS: true, androidIntentFilters: ['text/*'] }],
    // Home-screen widget (Android): the count bar + the three most urgent agents. `not_keyguard` keeps agent
    // titles off the lock screen; the system's own tick is the 30-minute minimum, the app pushes live updates.
    [
      'react-native-android-widget',
      {
        widgets: [
          {
            name: 'SolcoAgents',
            label: 'Solco Agents',
            description: 'Who needs you, who is working, and a tap into the most urgent agent.',
            minWidth: '250dp',
            minHeight: '110dp',
            targetCellWidth: 4,
            targetCellHeight: 2,
            resizeMode: 'horizontal|vertical',
            widgetCategory: 'not_keyguard',
            updatePeriodMillis: 1_800_000,
          },
        ],
      },
    ],
    ['expo-camera', { cameraPermission: 'Scan the pairing QR code shown on your Mac.', microphonePermission: false, recordAudioAndroid: false }],
    [
      'expo-splash-screen',
      {
        backgroundColor: '#08090C',
        image: './assets/splash-icon.png',
        imageWidth: 200,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
};

export default config;
