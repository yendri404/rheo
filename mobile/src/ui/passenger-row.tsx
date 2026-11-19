import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Checkmark } from './checkmark';
import { colors, fonts, radius } from './theme';

type Props = {
  name: string;
  address: string;
  confirmed: boolean;
  loading: boolean;
  onConfirm: () => void;
};

/**
 * Pending rows stand out (dark action with a check to tap).
 * Confirmed rows keep the check but fade to grey so they stop drawing attention.
 */
export function PassengerRow({ name, address, confirmed, loading, onConfirm }: Props) {
  return (
    <View style={[styles.row, confirmed && styles.rowDone]}>
      <View style={styles.text}>
        <Text style={[styles.name, confirmed && styles.textDone]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[styles.address, confirmed && styles.textDone]} numberOfLines={2}>
          {address || 'Sin dirección'}
        </Text>
      </View>
      <Pressable
        onPress={onConfirm}
        disabled={confirmed || loading}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={confirmed ? `Parada de ${name} confirmada` : `Confirmar parada de ${name}`}
        accessibilityState={{ disabled: confirmed || loading, checked: confirmed }}
        style={({ pressed }) => [styles.action, confirmed && styles.actionDone, pressed && styles.pressed]}
      >
        {loading ? (
          <ActivityIndicator color={colors.background} />
        ) : (
          <Checkmark size={20} color={confirmed ? colors.background : colors.accent} />
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: colors.disabled,
    borderRadius: radius.control,
    overflow: 'hidden',
    marginBottom: 10,
  },
  rowDone: { backgroundColor: '#D3DCDD' },
  text: { flex: 1, paddingVertical: 12, paddingHorizontal: 14 },
  name: { fontFamily: fonts.bold, fontSize: 17, color: colors.dark },
  address: { fontFamily: fonts.regular, fontSize: 13, color: colors.dark, marginTop: 4 },
  textDone: { color: colors.disabledText, opacity: 0.7 },
  action: { width: 60, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.dark },
  actionDone: { backgroundColor: colors.disabled },
  pressed: { opacity: 0.8 },
});
