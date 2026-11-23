import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Camera, Map, Marker, type CameraRef } from '@maplibre/maplibre-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { colors, fonts } from '../ui/theme';
import type { DriverMapProps } from './driver-map';
import { framingFor, type Framing } from './framing';
import { MapFrame } from './map-frame';
import type { LatLng } from './proximity';

/** Free vector tiles, no API key (https://openfreemap.org). Same style as the web map. */
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const MAP_HEIGHT = 320;
/** Points around the framed markers; the pin is ~44pt tall above its tip. */
const FIT_PADDING = { top: 64, bottom: 48, left: 40, right: 40 };
/** Glide time between two GPS fixes; close to the driver's send interval so the pin never stops. */
const GLIDE_MS = 1_800;
const PIN_SIZE = 44;
const CARACAS: [number, number] = [-66.9146, 10.5061];

/**
 * Native live map (MapLibre, needs a development build; loaded through driver-map.tsx). Mirrors
 * driver-map.web.tsx: the pin glides between fixes, the camera keeps driver and passenger in view
 * until the user pans, and a button brings the camera back.
 */
export function NativeDriverMap({ position, stale, near, self }: DriverMapProps) {
  const cameraRef = useRef<CameraRef>(null);
  const reduceMotion = useReducedMotion();
  // Android drops camera calls until the style has loaded, and the server replays the driver's last
  // position the moment the passenger connects, so the first framing is redone once the map is ready.
  const [ready, setReady] = useState(false);
  // Where the pin is drawn right now (it trails `position` while gliding).
  const [shown, setShown] = useState<LatLng | null>(null);
  const shownRef = useRef<LatLng | null>(null);
  const frameRef = useRef<number | null>(null);
  const followRef = useRef(true);
  const [following, setFollowing] = useState(true);
  const selfRef = useRef(self);
  selfRef.current = self;

  function show(point: LatLng) {
    shownRef.current = point;
    setShown(point);
  }

  function moveCamera(framing: Framing, duration: number) {
    const camera = cameraRef.current;
    if (!camera) return;
    if ('bounds' in framing) camera.fitBounds(framing.bounds, { padding: FIT_PADDING, duration, easing: 'linear' });
    else camera.easeTo({ center: framing.center, zoom: framing.zoom, duration, easing: 'linear' });
  }

  // Glide the pin to each new fix; the camera follows with the same duration so both stay in step.
  useEffect(() => {
    if (!position) return;
    const target = { lat: position.lat, lng: position.lng };
    const from = shownRef.current;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);

    if (!from || reduceMotion) {
      show(target);
      if (followRef.current) moveCamera(framingFor(target, selfRef.current), 0);
      return;
    }
    if (followRef.current) moveCamera(framingFor(target, selfRef.current), GLIDE_MS);
    const startedAt = Date.now();
    const step = () => {
      const t = Math.min(1, (Date.now() - startedAt) / GLIDE_MS);
      show({ lat: from.lat + (target.lat - from.lat) * t, lng: from.lng + (target.lng - from.lng) * t });
      frameRef.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    frameRef.current = requestAnimationFrame(step);
  }, [position, reduceMotion]);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  // Re-frame when the passenger moves (the driver may be standing still between two fixes) and once
  // the map is ready (camera moves sent before that were dropped).
  useEffect(() => {
    if (ready && followRef.current && shownRef.current) {
      moveCamera(framingFor(shownRef.current, self), reduceMotion ? 0 : 500);
    }
  }, [self, reduceMotion, ready]);

  // Stable, so the memoized Map does not re-render on every glide frame.
  const onRegionWillChange = useCallback(({ nativeEvent }: { nativeEvent: { userInteraction: boolean } }) => {
    if (!nativeEvent.userInteraction) return;
    followRef.current = false;
    setFollowing(false);
  }, []);
  const onStyleLoaded = useCallback(() => setReady(true), []);

  function recenter() {
    followRef.current = true;
    setFollowing(true);
    if (shownRef.current) moveCamera(framingFor(shownRef.current, selfRef.current), reduceMotion ? 0 : 500);
  }

  return (
    <MapFrame near={near} height={MAP_HEIGHT}>
      <Map
        style={styles.fill}
        mapStyle={MAP_STYLE}
        logo={false}
        compass={false}
        attributionPosition={{ bottom: 8, right: 8 }}
        // Explicit on purpose: on Android the map only claims the touch from the parent ScrollView
        // (requestDisallowInterceptTouchEvent) when this prop was actually set; left unset, a vertical
        // drag on the map scrolls the sheet instead of panning the map.
        dragPan
        onRegionWillChange={onRegionWillChange}
        onDidFinishLoadingStyle={onStyleLoaded}
      >
        <Camera ref={cameraRef} initialViewState={{ center: CARACAS, zoom: 15 }} />
        {self && (
          <Marker id="self" lngLat={[self.lng, self.lat]} anchor="center">
            <View style={styles.selfDot} accessibilityLabel="Tu ubicación" />
          </Marker>
        )}
        {shown && (
          <Marker id="driver" lngLat={[shown.lng, shown.lat]} anchor="bottom">
            <View style={[styles.pin, stale && styles.pinStale]} accessibilityLabel="Ubicación del chofer">
              <MaterialCommunityIcons name="map-marker" size={PIN_SIZE} color={colors.primary} />
            </View>
          </Marker>
        )}
      </Map>
      {!position && (
        <View style={styles.overlay} pointerEvents="none">
          <Text style={styles.overlayText}>Esperando la ubicación del chofer…</Text>
        </View>
      )}
      {stale && (
        <View style={styles.badge} pointerEvents="none">
          <Text style={styles.badgeText}>Ubicación desactualizada</Text>
        </View>
      )}
      {position && !following && (
        <Pressable onPress={recenter} accessibilityRole="button" style={styles.recenter}>
          <Text style={styles.recenterText}>{self ? 'Ver al chofer y a mí' : 'Centrar en el chofer'}</Text>
        </Pressable>
      )}
    </MapFrame>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pin: {
    width: PIN_SIZE,
    height: PIN_SIZE,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 3 },
  },
  pinStale: { opacity: 0.45 },
  selfDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.dark,
    borderWidth: 3,
    borderColor: colors.white,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(234, 240, 241, 0.75)',
  },
  overlayText: { fontFamily: fonts.bold, fontSize: 15, color: colors.dark },
  badge: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  badgeText: { fontFamily: fonts.bold, fontSize: 12, color: colors.dark },
  recenter: {
    position: 'absolute',
    bottom: 12,
    alignSelf: 'center',
    backgroundColor: colors.dark,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  recenterText: { fontFamily: fonts.regular, fontSize: 13, color: colors.background },
});
