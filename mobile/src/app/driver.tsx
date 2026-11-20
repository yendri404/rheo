import { Redirect } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { errorMessage } from '../api/client';
import { ROUTE_LABELS, type DriverPassenger, type DriverState, type DriverTrip, type RouteName } from '../api/types';
import { useTripState } from '../realtime/use-trip-state';
import { useAuthenticated, useSession } from '../session/session-context';
import { Checkmark } from '../ui/checkmark';
import { useConfirm } from '../ui/confirm-dialog';
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
      <ScreenLayout
        header={
          <>
            <Text style={styles.headerCaption}>¡Buen trabajo!</Text>
            <Text style={styles.headerTitle}>Carrera finalizada</Text>
          </>
        }
        footer={<PrimaryButton label="Ok" onPress={() => setJustFinished(false)} />}
      >
        <View style={styles.finishedIcon}>
          <Checkmark size={64} strokeWidth={6} color={colors.primary} />
        </View>
        {state && (
          <Text style={styles.finishedText}>
            Siguiente ruta: <Text style={styles.finishedRoute}>{ROUTE_LABELS[state.nextRoute]}</Text>
          </Text>
        )}
      </ScreenLayout>
    );
  }

  if (!state) {
    return (
      <ScreenLayout header={<Text style={styles.headerCaption}>Cargando…</Text>} onSignOut={signOut} connected={connected}>
        <ActivityIndicator color={colors.primary} />
      </ScreenLayout>
    );
  }

  const trip = state.activeTrip;

  if (!trip) {
    return (
      <ScreenLayout
        onSignOut={askSignOut}
        connected={connected}
        header={
          <>
            <Text style={styles.headerCaption}>Hola,</Text>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {session.user.name}
            </Text>
          </>
        }
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
        <Text style={styles.hint}>Al empezar, todos los pasajeros reciben una notificación.</Text>
        {errorBanner}
        {dialog}
      </ScreenLayout>
    );
  }

  const pending = trip.passengers.filter((passenger) => !passenger.confirmed).length;

  return (
    <ScreenLayout
      onSignOut={askSignOut}
      connected={connected}
      header={
        <>
          <Text style={styles.headerCaption}>Ruta:</Text>
          <Text style={styles.headerTitle}>{ROUTE_LABELS[trip.route]}</Text>
          <Text style={styles.headerStatus}>
            {trip.passengers.length === 0
              ? 'Esperando pasajeros…'
              : pending === 0
                ? 'Todas las paradas confirmadas'
                : `${pending} de ${trip.passengers.length} paradas pendientes`}
          </Text>
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
      {trip.passengers.length === 0 && (
        <Text style={styles.empty}>Los pasajeros aparecerán aquí en cuanto se anoten.</Text>
      )}
      {/* Plain map instead of FlatList: the layout already scrolls, and a route has few passengers. */}
      {trip.passengers.map((item) => (
        <PassengerRow
          key={item.userId}
          name={item.name}
          address={item.address}
          confirmed={item.confirmed}
          loading={busy === item.userId}
          onConfirm={() => confirmStop(item)}
        />
      ))}
      {dialog}
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  headerCaption: { fontFamily: fonts.regular, fontSize: 20, color: colors.white, marginTop: 24 },
  headerTitle: { fontFamily: fonts.regular, fontSize: 40, color: colors.background },
  headerStatus: { fontFamily: fonts.regular, fontSize: 15, color: colors.background, opacity: 0.85, marginTop: 6 },
  caption: { fontFamily: fonts.regular, fontSize: 18, color: colors.dark },
  nextRoute: { fontFamily: fonts.regular, fontSize: 44, color: colors.dark, marginTop: 12 },
  hint: { fontFamily: fonts.regular, fontSize: 13, color: colors.disabledText, marginTop: 24 },
  empty: { fontFamily: fonts.regular, fontSize: 14, color: colors.disabledText, textAlign: 'center', marginTop: 24 },
  error: { fontFamily: fonts.regular, fontSize: 14, color: colors.danger, marginBottom: 12 },
  finishedIcon: {
    alignSelf: 'center',
    marginTop: 16,
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 5,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  finishedText: { fontFamily: fonts.regular, fontSize: 18, color: colors.dark, textAlign: 'center', marginTop: 28 },
  finishedRoute: { fontFamily: fonts.bold, color: colors.primary },
});
