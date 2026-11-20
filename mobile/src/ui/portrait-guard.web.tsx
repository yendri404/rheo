import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from './theme';

// Browsers cannot lock orientation outside fullscreen/installed apps, so on phones and tablets in
// landscape we cover the app and ask to rotate. Desktops (fine pointer) are never blocked.
const LANDSCAPE_TOUCH = '(orientation: landscape) and (pointer: coarse)';

export function PortraitGuard() {
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia(LANDSCAPE_TOUCH);
    const update = () => setBlocked(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  if (!blocked) return null;
  return (
    <View style={styles.cover} accessibilityRole="alert" accessibilityLabel="Gira tu dispositivo a vertical">
      <Ionicons name="phone-portrait-outline" size={56} color={colors.background} />
      <Text style={styles.title}>Gira tu dispositivo</Text>
      <Text style={styles.body}>Esta app solo se usa en vertical.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1000,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: { fontFamily: fonts.regular, fontSize: 28, color: colors.background, marginTop: 16 },
  body: { fontFamily: fonts.regular, fontSize: 15, color: colors.background, marginTop: 8, textAlign: 'center' },
});
