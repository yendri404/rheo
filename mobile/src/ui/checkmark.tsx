import { View } from 'react-native';
import { colors } from './theme';

type Props = { size: number; color?: string; strokeWidth?: number };

/** Check drawn from two borders of a rotated box, so no SVG dependency is needed. */
export function Checkmark({ size, color = colors.background, strokeWidth = Math.max(2, size / 8) }: Props) {
  return (
    <View
      style={{
        width: size * 0.5,
        height: size,
        borderRightWidth: strokeWidth,
        borderBottomWidth: strokeWidth,
        borderColor: color,
        transform: [{ rotate: '45deg' }, { translateY: -size * 0.1 }],
      }}
    />
  );
}
