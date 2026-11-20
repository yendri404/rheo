import { Redirect } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { errorMessage } from '../api/client';
import { ROUTE_LABELS, type PassengerState } from '../api/types';
import { useTripState } from '../realtime/use-trip-state';
import { useAuthenticated, useSession } from '../session/session-context';
import { motion } from '../ui/motion';
import { PrimaryButton } from '../ui/primary-button';
import { RouteBanner } from '../ui/route-banner';
import { ScreenLayout } from '../ui/screen-layout';
import { colors, fonts } from '../ui/theme';

export default function PassengerRoute() {
  const { session, api } = useSession();
  if (!session || !api) return <Redirect href="/login" />;
  if (session.user.role !== 'passenger') return <Redirect href="/" />;
  return <PassengerScreen />;
}

function greeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Buenos días';
  if (hour < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

function PassengerScreen() {
  const { session, api, signOut } = useAuthenticated();
  const { state, setState, connected } = useTripState<PassengerState>(session.token, api, signOut);
  const [busy, setBusy] = useState<'join' | 'leave' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: 'join' | 'leave', action: () => Promise<unknown>) {
    setBusy(kind);
    setError(null);
    try {
      setState((await action()) as PassengerState);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  const trip = state?.activeTrip ?? null;
  const joined = trip?.joined ?? false;
  const pickedUp = trip?.confirmed ?? false;

  const status = !state
    ? 'Cargando…'
    : !trip
      ? 'Te avisaremos cuando el chofer inicie la ruta.'
      : pickedUp
        ? 'El chofer confirmó tu parada. ¡Buen viaje!'
        : joined
          ? 'El chofer ya te ve en su lista.'
          : 'Si no vas a usar el transporte, no necesitas hacer nada.';

  return (
    <ScreenLayout
      // A started or finished trip replays the entrance animation while the app is open.
      contentKey={!state ? 'loading' : (trip?.id ?? 'idle')}
      onSignOut={signOut}
      connected={connected}
      header={
        <>
          <Text style={styles.greeting}>{greeting()}</Text>
          <Text style={styles.name} numberOfLines={1}>
            {session.user.name}
          </Text>
          <Animated.Text key={status} entering={motion.textEnter} style={styles.status}>
            {status}
          </Animated.Text>
        </>
      }
      footer={
        state && (
          <>
            <PrimaryButton
              label={pickedUp ? 'A bordo' : joined ? 'Confirmado' : 'Usaré el transporte'}
              onPress={() => run('join', api.joinTrip)}
              disabled={!trip || joined}
              loading={busy === 'join'}
            />
            {joined && !pickedUp && (
              <Animated.View entering={motion.textEnter}>
                <Pressable
                  onPress={() => run('leave', api.leaveTrip)}
                  disabled={busy !== null}
                  hitSlop={10}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.cancel, pressed && styles.cancelPressed]}
                >
                  {busy === 'leave' ? (
                    <ActivityIndicator color={colors.disabledText} size="small" />
                  ) : (
                    <Text style={styles.cancelLabel}>Ya no lo usaré</Text>
                  )}
                </Pressable>
              </Animated.View>
            )}
          </>
        )
      }
    >
      {!state ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <View>
          <Text style={styles.caption}>{trip ? 'Ruta en curso:' : 'Próxima ruta:'}</Text>
          <View style={styles.banner}>
            <RouteBanner label={ROUTE_LABELS[trip?.route ?? state.nextRoute]} highlighted={!!trip && !joined} />
          </View>
          {error && (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          )}
        </View>
      )}
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  greeting: { fontFamily: fonts.regular, fontSize: 18, color: colors.white, marginTop: 24 },
  name: { fontFamily: fonts.regular, fontSize: 38, color: colors.background, marginTop: 4 },
  // Translucency lives in the color: the entering animation owns opacity.
  status: { fontFamily: fonts.regular, fontSize: 15, color: 'rgba(234, 240, 241, 0.85)', marginTop: 8 },
  caption: { fontFamily: fonts.regular, fontSize: 22, color: colors.dark },
  banner: { marginTop: 14, marginLeft: -8 },
  cancel: {
    alignSelf: 'center',
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.disabled,
    minHeight: 36,
    justifyContent: 'center',
  },
  cancelPressed: { backgroundColor: colors.disabled },
  cancelLabel: { fontFamily: fonts.regular, fontSize: 13, color: colors.disabledText },
  error: { fontFamily: fonts.regular, fontSize: 14, color: colors.danger, marginTop: 20, textAlign: 'center' },
});
