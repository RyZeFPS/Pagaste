import type { ConfigContext, ExpoConfig } from 'expo/config';

const appUrl = process.env.EXPO_PUBLIC_APP_URL?.trim() || 'https://pagaste.app';
const appDomain = new URL(appUrl).hostname;
const easProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Pagaste',
  slug: 'pagaste',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'pagaste',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: 'app.pagaste.mobile',
    supportsTablet: true,
    associatedDomains: [`applinks:${appDomain}`],
    infoPlist: {
      NSCameraUsageDescription: 'Pagaste necesita la cámara para fotografiar tus tickets.',
      NSPhotoLibraryUsageDescription:
        'Pagaste necesita acceso a tus fotos para seleccionar tickets y personalizar perfiles y grupos.',
    },
  },
  android: {
    package: 'app.pagaste.mobile',
    adaptiveIcon: {
      backgroundColor: '#F5F7FB',
      foregroundImage: './assets/images/android-icon-foreground.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: true,
    permissions: ['android.permission.CAMERA'],
    blockedPermissions: ['android.permission.RECORD_AUDIO'],
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [
          { scheme: 'https', host: appDomain, pathPrefix: '/c/' },
          { scheme: 'https', host: appDomain, pathPrefix: '/invite/' },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  web: {
    bundler: 'metro',
    output: 'single',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    ['expo-router', { origin: appUrl, asyncRoutes: { web: 'production' } }],
    [
      'expo-splash-screen',
      {
        backgroundColor: '#1769E8',
        image: './assets/images/splash-icon.png',
        imageWidth: 76,
      },
    ],
    [
      'expo-camera',
      {
        cameraPermission: 'Pagaste necesita la cámara para fotografiar tus tickets.',
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission:
          'Pagaste necesita acceso a tus fotos para seleccionar tickets y personalizar perfiles y grupos.',
      },
    ],
    [
      'expo-notifications',
      {
        icon: './assets/images/android-icon-monochrome.png',
        color: '#1769E8',
        defaultChannel: 'pagaste',
      },
    ],
    ['expo-secure-store', { configureAndroidBackup: true }],
    'expo-localization',
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: easProjectId ? { eas: { projectId: easProjectId } } : undefined,
});
