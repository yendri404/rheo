import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { colors } from './theme';

type Props = {
  /** Rendered width in px; the height follows the 364:266 artwork ratio. */
  width?: number;
  /** Body, wheels and bulb details. */
  color?: string;
  /** Windshield, door, hubs and bulb: cut-outs that should match the background behind the logo. */
  cutout?: string;
};

/** Eureka Rheo logo: a transport van with a light bulb. Source artwork: `mobile/assets/eureka-rheo-logo-white.svg`. */
export function Logo({ width = 200, color = colors.white, cutout = colors.primary }: Props) {
  return (
    <Svg width={width} height={(width * 266) / 364} viewBox="0 0 364 266" fill="none" accessibilityLabel="Logo de Eureka Rheo">
      <Path
        fill={color}
        d="M26 6H202C238 6 258 22 268 42L288 102C336 114 350 134 350 162V201C350 214.333 343.333 221 330 221H306C306 197.804 287.196 179 264 179C240.804 179 222 197.804 222 221H134C134 197.804 115.196 179 92 179C68.804 179 50 197.804 50 221H26C12.667 221 6 214.333 6 201V26C6 12.667 12.667 6 26 6Z"
      />
      <Circle cx={92} cy={221} r={34} fill={color} />
      <Circle cx={264} cy={221} r={34} fill={color} />

      {/* Door */}
      <Rect x={212} y={116} width={60} height={52} rx={10} stroke={cutout} strokeWidth={4} strokeLinejoin="round" />
      <Path d="M226 134H242" stroke={cutout} strokeWidth={4} strokeLinecap="round" />

      {/* Wheel hubs */}
      <Circle cx={92} cy={221} r={8} fill={cutout} />
      <Circle cx={264} cy={221} r={8} fill={cutout} />

      {/* Windshield */}
      <Path
        d="M213 31C233 31 244 37 250 47L265 101H213Z"
        fill={cutout}
        stroke={cutout}
        strokeWidth={6}
        strokeLinejoin="round"
      />

      {/* Bulb: glass, screw threads, tip */}
      <Path
        fill={cutout}
        d="M84.98 129.245C61.813 133.153 38.778 121.634 28.007 100.754C17.236 79.875 21.201 54.427 37.814 37.814C54.427 21.201 79.875 17.236 100.754 28.007C121.634 38.778 133.153 61.813 129.245 84.98C132.569 95.799 136.811 102.87 145.296 111.355L111.355 145.296C102.87 136.811 95.799 132.569 84.98 129.245Z"
      />
      <Rect
        x={107.983}
        y={128.983}
        width={52}
        height={10}
        rx={5}
        fill={cutout}
        transform="matrix(0.707107 -0.707107 0.707107 0.707107 -55.497475 133.982756)"
      />
      <Rect
        x={120.175}
        y={138.175}
        width={46}
        height={10}
        rx={5}
        fill={cutout}
        transform="matrix(0.707107 -0.707107 0.707107 0.707107 -59.305087 143.175144)"
      />
      <Path
        fill={cutout}
        d="M138.225 159.439L159.438 138.225C164.153 142.939 162.974 148.832 155.903 155.903C148.832 162.974 142.939 164.153 138.225 159.439Z"
      />

      {/* Bulb details: filament supports, filament, glass highlight */}
      <G stroke={color} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M119.134 134.69L78.121 93.678M134.69 119.134L93.678 78.121" />
        <Path d="M78.121 93.678L72.111 79.889L85.899 85.899L79.889 72.111L93.678 78.121" />
        <Path d="M37.816 71.757C38.681 65.203 41.24 58.988 45.241 53.726" opacity={0.9} />
      </G>
    </Svg>
  );
}
