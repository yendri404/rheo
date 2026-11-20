import { FadeIn, FadeInDown, FadeOutLeft, LinearTransition, ReduceMotion, ZoomIn } from 'react-native-reanimated';

/**
 * Shared motion presets so every screen moves the same way.
 * All of them honor the OS "reduce motion" setting.
 */
export const motion = {
  /** Sheet content when the screen changes phase (e.g. trip started, trip finished). */
  sheetEnter: FadeInDown.springify().damping(18).reduceMotion(ReduceMotion.System),
  /** Short header messages when they change. */
  textEnter: FadeIn.duration(280).reduceMotion(ReduceMotion.System),
  /** A passenger appearing in the driver's list. */
  rowEnter: FadeInDown.springify().damping(16).reduceMotion(ReduceMotion.System),
  /** A passenger leaving the driver's list. */
  rowExit: FadeOutLeft.duration(220).reduceMotion(ReduceMotion.System),
  /** Remaining rows sliding into place after an insert or removal. */
  rowLayout: LinearTransition.springify().damping(18).reduceMotion(ReduceMotion.System),
  /** Celebratory pop (finished check). */
  pop: ZoomIn.springify().damping(11).delay(120).reduceMotion(ReduceMotion.System),
} as const;

export const COLOR_TRANSITION_MS = 320;
