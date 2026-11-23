import Constants, { ExecutionEnvironment } from 'expo-constants';
import type { ComponentType } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { DriverPosition } from '../realtime/use-driver-location';
import { colors, fonts } from '../ui/theme';
import { MapFrame } from './map-frame';
import type { LatLng } from './proximity';

export type DriverMapProps = {
  position: DriverPosition | null;
  stale: boolean;
  /** The driver is within ~200 m of the passenger: the border turns yellow. */
  near: boolean;
  /** The passenger's own position, shown as a small dot. Never leaves the device. */
  self: LatLng | null;
};

/**
 * The MapLibre native module throws as soon as it is imported where it is not compiled in (Expo Go,
 * or a dev build made before it was added). Every route loads at startup, so a static import would
 * crash the whole app; it is loaded here only when available, with a placeholder otherwise.
 */
function loadNativeMap(): ComponentType<DriverMapProps> | null {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return null; // Expo Go
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('./native-driver-map') as typeof import('./native-driver-map')).NativeDriverMap;
  } catch {
    return null;
  }
}

const NativeMap = loadNativeMap();

export function DriverMap(props: DriverMapProps) {
  if (NativeMap) return <NativeMap {...props} />;
  return (
    <MapFrame near={props.near} height={220}>
      <View style={styles.box}>
        <Text style={styles.text}>
          {props.position ? 'El chofer va en camino.' : 'Esperando la ubicación del chofer…'}
        </Text>
        <Text style={styles.hint}>El mapa necesita un development build (no funciona en Expo Go).</Text>
      </View>
    </MapFrame>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  text: { fontFamily: fonts.bold, fontSize: 16, color: colors.dark, textAlign: 'center' },
  hint: { fontFamily: fonts.regular, fontSize: 13, color: colors.disabledText, marginTop: 6, textAlign: 'center' },
});
