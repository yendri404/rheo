import { Redirect } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import Animated from 'react-native-reanimated';
import { errorMessage } from '../api/client';
import { ROUTE_LABELS, type DriverPassenger, type DriverState, type DriverTrip, type RouteName } from '../api/types';
import { useDriverTracking } from '../location/use-driver-tracking';
import { useTripState } from '../realtime/use-trip-state';
import { useAuthenticated, useSession } from '../session/session-context';
import { Checkmark } from '../ui/checkmark';
import { useConfirm } from '../ui/confirm-dialog';
import { motion } from '../ui/motion';
import { PassengerRow } from '../ui/passenger-row';
import { PrimaryButton } from '../ui/primary-button';
import { ScreenLayout } from '../ui/screen-layout';
import { colors, fonts } from '../ui/theme';

export default function DriverRoute() {
  const { session, api } = useSession();
  if (!session || !api) return <Redirect href="/login" />;
  if (session.user.role !== 'driver') return <Redirect href="/" />;
  return <DriverScreen />;
}

function DriverScreen() {
  const { session, api, signOut } = useAuthenticated();
  const { state, setState, connected } = useTripState<DriverState>(session.token, api, signOut);
  const [busy, setBusy] = useState<string | null>(null);
  const [justFinished, setJustFinished] = useState(false);
  // Inline instead of Alert.alert, which is a no-op on web.
  const [error, setError] = useState<string | null>(null);
  const tracking = useDriverTracking(Boolean(state?.activeTrip));

  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      setState((await action()) as DriverState);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  const { confirm, dialog } = useConfirm();

  async function startTrip(route: RouteName) {
    const ok = await confirm({
      title: `¿Empezar la ruta ${ROUTE_LABELS[route]}?`,
      message: 'Todos los pasajeros recibirán una notificación y podrán anotarse.',
      confirmLabel: 'Empezar',
    });
    if (ok) await run('start', api.startTrip);
  }

  async function confirmStop(passenger: DriverPassenger) {
    const ok = await confirm({
      title: `¿Confirmar parada de ${passenger.name}?`,
      message: 'Confírmala solo cuando el pasajero ya esté a bordo. No se puede deshacer.',
      details: [passenger.address || 'Sin dirección'],
      confirmLabel: 'Confirmar',
    });
    if (ok) await run(passenger.userId, () => api.confirmStop(passenger.userId));
  }

  async function finishTrip(trip: DriverTrip) {
    const ok = await confirm({
      title: `¿Terminar la ruta ${ROUTE_LABELS[trip.route]}?`,
      message: 'Verifica el resumen antes de terminar. No se puede deshacer.',
      details: [
        `Pasajeros recogidos: ${trip.passengers.length}`,
        `Siguiente ruta: ${ROUTE_LABELS[state!.nextRoute]}`,
      ],
      confirmLabel: 'Terminar',
    });
    if (!ok) return;
    await run('finish', async () => {
      const next = await api.finishTrip();
      setJustFinished(true);
      return next;
    });
  }

  async function askSignOut() {
    const ok = await confirm({
      title: '¿Cerrar sesión?',
      message: state?.activeTrip ? 'Hay una ruta en curso. Seguirá activa y podrás retomarla al volver a entrar.' : undefined,
      confirmLabel: 'Cerrar sesión',
    });
    if (ok) await signOut();
  }

  const errorBanner = error && (
    <Text style={styles.error} accessibilityRole="alert">
      {error}
    </Text>
  );

  if (justFinished) {
    return (
      // Mockup: big white check on the green background, short sheet with the message and "Ok".
      <ScreenLayout
        contentKey="finished"
        sheet="content"
        headerAlign="center"
        header={
          <Animated.View entering={motion.pop} style={styles.finishedIcon} accessibilityLabel="Ruta completada">
            <Checkmark size={72} strokeWidth={7} color={colors.background} />
          </Animated.View>
        }
        footer={<PrimaryButton label="Ok" onPress={() => setJustFinished(false)} />}
      >
        <Text style={styles.finishedText}>Carrera finalizada</Text>
      </ScreenLayout>
    );
  }

  if (!state) {
    return (
      <ScreenLayout
        contentKey="loading"
        header={<Text style={styles.headerCaption}>Cargando…</Text>}
        onSignOut={signOut}
        connected={connected}
      >
        <ActivityIndicator color={colors.primary} />
      </ScreenLayout>
    );
  }

  const trip = state.activeTrip;

  if (!trip) {
    return (
      // Mockup: the green area stays empty (reserved for future illustrations); the sheet hugs its content.
      <ScreenLayout
        contentKey="home"
        sheet="content"
        onSignOut={askSignOut}
        connected={connected}
        footer={
          <PrimaryButton
            label="Empezar nueva carrera"
            loading={busy === 'start'}
            onPress={() => startTrip(state.nextRoute)}
          />
        }
      >
        <Text style={styles.caption}>Siguiente ruta:</Text>
        <Text style={styles.nextRoute}>{ROUTE_LABELS[state.nextRoute]}</Text>
        {errorBanner}
        {dialog}
      </ScreenLayout>
    );
  }

  const pending = trip.passengers.filter((passenger) => !passenger.confirmed).length;
  const status =
    trip.passengers.length === 0
      ? 'Esperando pasajeros…'
      : pending === 0
        ? 'Todas las paradas confirmadas'
        : `${pending} de ${trip.passengers.length} paradas pendientes`;

  return (
    <ScreenLayout
      contentKey={trip.id}
      onSignOut={askSignOut}
      connected={connected}
      header={
        <>
          <Text style={styles.headerCaption}>Ruta:</Text>
          <Text style={styles.headerTitle}>{ROUTE_LABELS[trip.route]}</Text>
          {/* Re-keyed so each count change fades in instead of snapping. */}
          <Animated.Text key={status} entering={motion.textEnter} style={styles.headerStatus}>
            {status}
          </Animated.Text>
        </>
      }
      footer={
        <PrimaryButton
          label="Terminar ruta"
          disabled={!trip.canFinish}
          loading={busy === 'finish'}
          onPress={() => finishTrip(trip)}
        />
      }
    >
      {errorBanner}
      {tracking === 'denied' && (
        <Text style={styles.notice} accessibilityRole="alert">
          Activa la ubicación para que los pasajeros vean dónde estás.
        </Text>
      )}
      {tracking === 'foreground' && (
        <Text style={styles.notice}>Tu ubicación solo se comparte mientras la app está abierta.</Text>
      )}
      {trip.passengers.length === 0 && (
        <Animated.Text entering={motion.textEnter} style={styles.empty}>
          Los pasajeros aparecerán aquí en cuanto se anoten.
        </Animated.Text>
      )}
      {/* Plain map instead of FlatList: the layout already scrolls, and a route has few passengers.
          New passengers spring in, cancelled ones slide out, and the rest glide into place. */}
      {trip.passengers.map((item) => (
        <Animated.View key={item.userId} entering={motion.rowEnter} exiting={motion.rowExit} layout={motion.rowLayout}>
          <PassengerRow
            name={item.name}
            address={item.address}
            confirmed={item.confirmed}
            loading={busy === item.userId}
            onConfirm={() => confirmStop(item)}
          />
        </Animated.View>
      ))}
      {dialog}
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  headerCaption: { fontFamily: fonts.regular, fontSize: 20, color: colors.white, marginTop: 24 },
  headerTitle: { fontFamily: fonts.regular, fontSize: 40, color: colors.background },
  // Translucency lives in the color: the entering animation owns opacity.
  headerStatus: { fontFamily: fonts.regular, fontSize: 15, color: 'rgba(234, 240, 241, 0.85)', marginTop: 6 },
  caption: { fontFamily: fonts.regular, fontSize: 18, color: colors.dark, marginTop: 16 },
  // Generous bottom space mirrors the mockup's proportions (sheet ~half the screen).
  nextRoute: { fontFamily: fonts.regular, fontSize: 44, color: colors.dark, marginTop: 20, marginBottom: 120 },
  empty: { fontFamily: fonts.regular, fontSize: 14, color: colors.disabledText, textAlign: 'center', marginTop: 24 },
  error: { fontFamily: fonts.regular, fontSize: 14, color: colors.danger, marginBottom: 12 },
  notice: { fontFamily: fonts.regular, fontSize: 14, color: colors.disabledText, marginBottom: 12 },
  finishedIcon: {
    alignSelf: 'center',
    width: 168,
    height: 168,
    borderRadius: 84,
    borderWidth: 6,
    borderColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  finishedText: {
    fontFamily: fonts.regular,
    fontSize: 32,
    color: colors.dark,
    textAlign: 'center',
    marginTop: 36,
    marginBottom: 60,
  },
});
