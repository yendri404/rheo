import { Redirect } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { errorMessage } from '../api/client';
import { ROUTE_LABELS, type PassengerState } from '../api/types';
import { useTripState } from '../realtime/use-trip-state';
import { useAuthenticated, useSession } from '../session/session-context';
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
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    setJoining(true);
    setError(null);
    try {
      setState((await api.joinTrip()) as PassengerState);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setJoining(false);
    }
  }

  const trip = state?.activeTrip ?? null;
  const joined = trip?.joined ?? false;

  return (
    <ScreenLayout
      onSignOut={signOut}
      connected={connected}
      header={
        <>
          <Text style={styles.greeting}>{greeting()}</Text>
          <Text style={styles.name} numberOfLines={1}>
            {session.user.name}
          </Text>
        </>
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
          <View style={styles.action}>
            <PrimaryButton
              label={joined ? 'Confirmado' : 'Usaré el transporte'}
              onPress={join}
              disabled={!trip || joined}
              loading={joining}
            />
          </View>
          <Text style={styles.hint}>
            {!trip
              ? 'Te avisaremos cuando el chofer inicie la ruta.'
              : joined
                ? 'El chofer ya te ve en su lista.'
                : 'Si no vas a usar el transporte, no necesitas hacer nada.'}
          </Text>
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
  greeting: { fontFamily: fonts.regular, fontSize: 18, color: colors.white },
  name: { fontFamily: fonts.regular, fontSize: 38, color: colors.background, marginTop: 4 },
  caption: { fontFamily: fonts.regular, fontSize: 22, color: colors.dark },
  banner: { marginTop: 14, marginLeft: -8 },
  action: { marginTop: 48 },
  hint: { fontFamily: fonts.regular, fontSize: 13, color: colors.disabledText, marginTop: 16, textAlign: 'center' },
  error: { fontFamily: fonts.regular, fontSize: 14, color: colors.danger, marginTop: 12, textAlign: 'center' },
});
