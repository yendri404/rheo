import { FadeIn, FadeInDown, FadeOutLeft, LinearTransition, ReduceMotion, ZoomIn } from 'react-native-reanimated';

/**
 * Spring configs are duration + dampingRatio on purpose: Reanimated 4 fills any missing
 * physics values from its "gentle" preset (mass 4, stiffness 900), so passing only `damping`
 * produces a far bouncier spring than it looks. dampingRatio 1 = no overshoot; lower = more bounce.
 */
export const springs = {
  /** The sheet rising or falling to its new position. */
  sheet: { duration: 550, dampingRatio: 0.9 },
  /** First half of a "pop": quick grow. */
  popOut: { duration: 180, dampingRatio: 0.6 },
  /** Second half of a "pop": settle back with a little life. */
  popBack: { duration: 320, dampingRatio: 0.6 },
} as const;

/**
 * Shared motion presets so every screen moves the same way.
 * All of them honor the OS "reduce motion" setting.
 */
export const motion = {
  /** Sheet content when the screen changes phase (e.g. trip started, trip finished). */
  sheetEnter: FadeInDown.springify(500).dampingRatio(0.85).reduceMotion(ReduceMotion.System),
  /** Short header messages when they change. */
  textEnter: FadeIn.duration(280).reduceMotion(ReduceMotion.System),
  /** A passenger appearing in the driver's list. */
  rowEnter: FadeInDown.springify(450).dampingRatio(0.8).reduceMotion(ReduceMotion.System),
  /** A passenger leaving the driver's list. */
  rowExit: FadeOutLeft.duration(220).reduceMotion(ReduceMotion.System),
  /** Remaining rows sliding into place after an insert or removal. */
  rowLayout: LinearTransition.springify(400).dampingRatio(0.9).reduceMotion(ReduceMotion.System),
  /** Celebratory pop (finished check): the one place a visible bounce is welcome. */
  pop: ZoomIn.springify(600).dampingRatio(0.55).delay(120).reduceMotion(ReduceMotion.System),
} as const;

export const COLOR_TRANSITION_MS = 320;
