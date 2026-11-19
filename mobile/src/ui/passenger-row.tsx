import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius } from './theme';
import { Checkmark } from './checkmark';

type Props = {
  name: string;
  address: string;
  confirmed: boolean;
  loading: boolean;
  onConfirm: () => void;
};

export function PassengerRow({ name, address, confirmed, loading, onConfirm }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.address} numberOfLines={2}>
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
        {loading ? <ActivityIndicator color={colors.background} /> : confirmed ? <Checkmark size={20} /> : null}
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
  text: { flex: 1, paddingVertical: 12, paddingHorizontal: 14 },
  name: { fontFamily: fonts.bold, fontSize: 17, color: colors.dark },
  address: { fontFamily: fonts.regular, fontSize: 13, color: colors.dark, marginTop: 4 },
  action: { width: 60, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.dark },
  actionDone: { backgroundColor: colors.primary },
  pressed: { opacity: 0.8 },
});
