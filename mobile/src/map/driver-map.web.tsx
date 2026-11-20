import { Map as MapLibreMap, Marker, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { DriverPosition } from '../realtime/use-driver-location';
import { colors, fonts, radius } from '../ui/theme';

export type DriverMapProps = { position: DriverPosition | null; stale: boolean };

/** Free vector tiles, no API key (https://openfreemap.org). */
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const ZOOM = 15;

// Metro does not emit MapLibre's worker, so it is served from public/ (see scripts/sync-maplibre-worker.mjs).
if (typeof window !== 'undefined') setWorkerUrl(new URL('/maplibre-gl-worker.mjs', window.location.origin).href);
/** Glide time between two GPS fixes; close to the driver's send interval so the pin never stops. */
const GLIDE_MS = 1_800;

/** Inverted drop (map pin) in the app colors. Anchored at its tip. */
function createPin(): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('aria-label', 'Ubicación del chofer');
  el.style.width = '36px';
  el.style.height = '48px';
  el.style.transition = 'opacity 300ms';
  el.innerHTML = `
    <svg width="36" height="48" viewBox="0 0 36 48" xmlns="http://www.w3.org/2000/svg">
      <path d="M18 1C8.6 1 1 8.6 1 18c0 12.8 17 29 17 29s17-16.2 17-29C35 8.6 27.4 1 18 1z"
            fill="${colors.primary}" stroke="${colors.white}" stroke-width="2"/>
      <circle cx="18" cy="18" r="7" fill="${colors.white}"/>
      <circle cx="18" cy="18" r="3.5" fill="${colors.dark}"/>
    </svg>`;
  el.style.filter = 'drop-shadow(0 3px 4px rgba(0,0,0,0.35))';
  return el;
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function DriverMap({ position, stale }: DriverMapProps) {
  const containerRef = useRef<ComponentRef<typeof View>>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const shownRef = useRef<{ lng: number; lat: number } | null>(null);
  const frameRef = useRef<number | null>(null);
  const followRef = useRef(true);
  const [following, setFollowing] = useState(true);

  // Create the map once.
  useEffect(() => {
    // On web a View renders a DOM element, which is what MapLibre mounts into.
    const container = containerRef.current as unknown as HTMLElement | null;
    if (!container) return;
    const map = new MapLibreMap({
      container,
      style: MAP_STYLE,
      center: [-66.9146, 10.5061],
      zoom: ZOOM,
      attributionControl: { compact: true },
    });
    map.on('dragstart', () => {
      followRef.current = false;
      setFollowing(false);
    });
    mapRef.current = map;
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      shownRef.current = null;
    };
  }, []);

  // Move the pin: glide from where it is to the new fix.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !position) return;
    const target = { lng: position.lng, lat: position.lat };

    if (!markerRef.current) {
      markerRef.current = new Marker({ element: createPin(), anchor: 'bottom' }).setLngLat(target).addTo(map);
      shownRef.current = target;
      map.jumpTo({ center: target, zoom: ZOOM });
      return;
    }

    const from = shownRef.current ?? target;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    if (prefersReducedMotion()) {
      markerRef.current.setLngLat(target);
      shownRef.current = target;
      if (followRef.current) map.jumpTo({ center: target });
      return;
    }
    const startedAt = performance.now();
    const step = (time: number) => {
      const t = Math.min(1, (time - startedAt) / GLIDE_MS);
      const point = { lng: from.lng + (target.lng - from.lng) * t, lat: from.lat + (target.lat - from.lat) * t };
      markerRef.current?.setLngLat(point);
      shownRef.current = point;
      if (followRef.current) map.jumpTo({ center: point });
      frameRef.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    frameRef.current = requestAnimationFrame(step);
  }, [position]);

  // Dim the pin when the location is outdated.
  useEffect(() => {
    const el = markerRef.current?.getElement();
    if (el) el.style.opacity = stale ? '0.45' : '1';
  }, [stale, position]);

  function recenter() {
    followRef.current = true;
    setFollowing(true);
    if (shownRef.current) mapRef.current?.easeTo({ center: shownRef.current, zoom: ZOOM, duration: 500 });
  }

  return (
    <View style={styles.frame}>
      <View ref={containerRef} style={styles.fill} nativeID="driver-map" />
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
          <Text style={styles.recenterText}>Centrar en el chofer</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { height: 320, borderRadius: radius.sheet, overflow: 'hidden', backgroundColor: colors.disabled },
  // flex, not absolute fill: MapLibre's CSS forces `position: relative` on its container, which would
  // cancel absolute positioning and collapse the map to 0px high.
  fill: { flex: 1 },
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
