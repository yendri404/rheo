import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useSession } from '../session/session-context';
import { colors } from '../ui/theme';

/** Routes each user to the screen set of their role. */
export default function Index() {
  const { session } = useSession();
  if (session === undefined) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary }}>
        <ActivityIndicator color={colors.background} />
      </View>
    );
  }
  if (!session) return <Redirect href="/login" />;
  return <Redirect href={session.user.role === 'driver' ? '/driver' : '/passenger'} />;
}
