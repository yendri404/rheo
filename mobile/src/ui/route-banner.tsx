import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from './theme';

const HEIGHT = 56;
const TIP = 18;

type Props = { label: string; highlighted: boolean };

/** Arrow-shaped route tag from the passenger mockup: yellow while action is pending, green once confirmed. */
export function RouteBanner({ label, highlighted }: Props) {
  const fill = highlighted ? colors.accent : colors.primary;
  const text = highlighted ? colors.dark : colors.background;
  return (
    <View style={styles.row} accessible accessibilityLabel={`Ruta ${label}`}>
      <View style={[styles.notch, { borderTopColor: fill, borderBottomColor: fill }]} />
      <View style={[styles.body, { backgroundColor: fill }]}>
        <Text style={[styles.label, { color: text }]}>{label}</Text>
      </View>
      <View style={[styles.tip, { borderLeftColor: fill }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', height: HEIGHT },
  notch: {
    width: TIP,
    borderTopWidth: HEIGHT / 2,
    borderBottomWidth: HEIGHT / 2,
    borderLeftWidth: TIP,
    borderLeftColor: 'transparent',
  },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: 4 },
  tip: {
    borderTopWidth: HEIGHT / 2,
    borderBottomWidth: HEIGHT / 2,
    borderLeftWidth: TIP,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
  },
  label: { fontFamily: fonts.regular, fontSize: 32 },
});
