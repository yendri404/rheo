import { StyleSheet, Text, View } from 'react-native';
import type { DriverPosition } from '../realtime/use-driver-location';
import { colors, fonts, radius } from '../ui/theme';

export type DriverMapProps = { position: DriverPosition | null; stale: boolean };

/**
 * Native placeholder. The live map currently runs on web (driver-map.web.tsx); the native map needs
 * @maplibre/maplibre-react-native and a development build, which is a separate, larger step.
 */
export function DriverMap({ position }: DriverMapProps) {
  return (
    <View style={styles.box}>
      <Text style={styles.text}>
        {position ? 'El chofer va en camino.' : 'Esperando la ubicación del chofer…'}
      </Text>
      <Text style={styles.hint}>El mapa en vivo llegará pronto a la app móvil.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    height: 220,
    borderRadius: radius.sheet,
    backgroundColor: colors.disabled,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  text: { fontFamily: fonts.bold, fontSize: 16, color: colors.dark, textAlign: 'center' },
  hint: { fontFamily: fonts.regular, fontSize: 13, color: colors.disabledText, marginTop: 6, textAlign: 'center' },
});
