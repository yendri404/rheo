import { StyleSheet, Text } from 'react-native';
import { colors, fonts } from './theme';

export function greetingFor(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Buenos días';
  if (hour < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

/** Time-of-day greeting plus the user's name, for the green header of the role home screens. */
export function Greeting({ name }: { name: string }) {
  return (
    <>
      <Text style={styles.greeting}>{greetingFor()}</Text>
      <Text style={styles.name} numberOfLines={1}>
        {name}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  greeting: { fontFamily: fonts.regular, fontSize: 18, color: colors.white, marginTop: 24 },
  name: { fontFamily: fonts.regular, fontSize: 38, color: colors.background, marginTop: 4 },
});
