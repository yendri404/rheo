import { StyleSheet, Text, View } from 'react-native';
import type { DriverPosition } from '../realtime/use-driver-location';
import { colors, fonts } from '../ui/theme';
import { MapFrame } from './map-frame';
import type { LatLng } from './proximity';

export type DriverMapProps = { position: DriverPosition | null; stale: boolean; near: boolean; self: LatLng | null };

/**
 * Native placeholder. The live map currently runs on web (driver-map.web.tsx); the native map needs
 * @maplibre/maplibre-react-native and a development build, which is a separate, larger step.
 */
export function DriverMap({ position, near }: DriverMapProps) {
  return (
    <MapFrame near={near} height={220}>
      <View style={styles.box}>
        <Text style={styles.text}>
          {position ? 'El chofer va en camino.' : 'Esperando la ubicación del chofer…'}
        </Text>
        <Text style={styles.hint}>El mapa en vivo llegará pronto a la app móvil.</Text>
      </View>
    </MapFrame>
  );
}

const styles = StyleSheet.create({
  box: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  text: { fontFamily: fonts.bold, fontSize: 16, color: colors.dark, textAlign: 'center' },
  hint: { fontFamily: fonts.regular, fontSize: 13, color: colors.disabledText, marginTop: 6, textAlign: 'center' },
});
