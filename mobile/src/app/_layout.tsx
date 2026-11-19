import { Comfortaa_400Regular, Comfortaa_700Bold, useFonts } from '@expo-google-fonts/comfortaa';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider } from '../session/session-context';
import { colors } from '../ui/theme';

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Comfortaa_400Regular, Comfortaa_700Bold });
  // Fall back to system fonts rather than blocking the app if fonts fail to load.
  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.primary }, animation: 'fade' }} />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
