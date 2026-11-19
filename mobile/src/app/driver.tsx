import { Redirect } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { errorMessage } from '../api/client';
import { ROUTE_LABELS, type DriverState } from '../api/types';
import { useTripState } from '../realtime/use-trip-state';
import { useAuthenticated, useSession } from '../session/session-context';
import { Checkmark } from '../ui/checkmark';
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

  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    try {
      setState((await action()) as DriverState);
    } catch (error) {
      Alert.alert('No se pudo completar', errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  if (justFinished) {
    return (
      <ScreenLayout
        headerHeight="55%"
        header={
          <View style={styles.finishedIcon}>
            <Checkmark size={64} strokeWidth={6} />
          </View>
        }
        footer={<PrimaryButton label="Ok" onPress={() => setJustFinished(false)} />}
      >
        <Text style={styles.finishedText}>Carrera finalizada</Text>
      </ScreenLayout>
    );
  }

  if (!state) {
    return (
      <ScreenLayout header={null} onSignOut={signOut} connected={connected}>
        <ActivityIndicator color={colors.primary} />
      </ScreenLayout>
    );
  }

  const trip = state.activeTrip;

  if (!trip) {
    return (
      <ScreenLayout
        headerHeight="45%"
        onSignOut={signOut}
        connected={connected}
        header={<Text style={styles.greeting}>Hola, {session.user.name}</Text>}
        footer={
          <PrimaryButton
            label="Empezar nueva carrera"
            loading={busy === 'start'}
            onPress={() => run('start', api.startTrip)}
          />
        }
      >
        <Text style={styles.caption}>Siguiente ruta:</Text>
        <Text style={styles.nextRoute}>{ROUTE_LABELS[state.nextRoute]}</Text>
        <Text style={styles.hint}>Al empezar, todos los pasajeros reciben una notificación.</Text>
      </ScreenLayout>
    );
  }

  const pending = trip.passengers.filter((passenger) => !passenger.confirmed).length;

  return (
    <ScreenLayout
      onSignOut={signOut}
      connected={connected}
      header={
        <>
          <Text style={styles.headerCaption}>Ruta:</Text>
          <Text style={styles.headerRoute}>{ROUTE_LABELS[trip.route]}</Text>
        </>
      }
      footer={
        <PrimaryButton
          label="Terminar ruta"
          disabled={!trip.canFinish}
          loading={busy === 'finish'}
          onPress={() =>
            run('finish', async () => {
              const next = await api.finishTrip();
              setJustFinished(true);
              return next;
            })
          }
        />
      }
    >
      <Text style={styles.summary}>
        {trip.passengers.length === 0
          ? 'Esperando pasajeros…'
          : pending === 0
            ? 'Todas las paradas confirmadas'
            : `${pending} de ${trip.passengers.length} paradas pendientes`}
      </Text>
      <FlatList
        data={trip.passengers}
        keyExtractor={(passenger) => passenger.userId}
        renderItem={({ item }) => (
          <PassengerRow
            name={item.name}
            address={item.address}
            confirmed={item.confirmed}
            loading={busy === item.userId}
            onConfirm={() => run(item.userId, () => api.confirmStop(item.userId))}
          />
        )}
      />
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  greeting: { fontFamily: fonts.regular, fontSize: 20, color: colors.background },
  caption: { fontFamily: fonts.regular, fontSize: 18, color: colors.dark },
  nextRoute: { fontFamily: fonts.regular, fontSize: 44, color: colors.dark, marginTop: 12 },
  hint: { fontFamily: fonts.regular, fontSize: 13, color: colors.disabledText, marginTop: 24 },
  headerCaption: { fontFamily: fonts.regular, fontSize: 22, color: colors.white },
  headerRoute: { fontFamily: fonts.regular, fontSize: 40, color: colors.background },
  summary: { fontFamily: fonts.regular, fontSize: 14, color: colors.disabledText, marginBottom: 14 },
  finishedIcon: {
    alignSelf: 'center',
    marginBottom: 24,
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 5,
    borderColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  finishedText: { fontFamily: fonts.regular, fontSize: 30, color: colors.dark, textAlign: 'center', marginTop: 12 },
});
