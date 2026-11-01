export const POSES = [
  'idle',
  'run',
  'jump',
  'fall',
  'slide',
  'dive',
  'crash',
  'roll',
  'roll-ready',
  'vault',
  'flip',
  'sideflip',
  'spin',
  'corkscrew',
  'wallrun',
] as const;
export type MovementPose = (typeof POSES)[number];
export const TRICKS = ['flip', 'sideflip', 'spin', 'corkscrew'] as const;
export type TrickPose = (typeof TRICKS)[number];
export function isTrick(pose: string): pose is TrickPose {
  return (TRICKS as readonly string[]).includes(pose);
}
export const TRICK_NAMES: Record<TrickPose, string> = {
  flip: 'FRONT FLIP',
  sideflip: 'SIDE FLIP',
  spin: 'AIR SPIN',
  corkscrew: 'CORKSCREW',
};
export const MOVEMENT = {
  step: 1 / 120,
  gravity: 24,
  jumpSpeed: 10.4,
  jumpBuffer: 0.2,
  coyote: 0.16,
  runSpeed: 11.8,
  walkSpeed: 3.8,
  wallSpeed: 16,
  wallDuration: 1.8,
  wallDescent: 0.65,
  vaultSpeed: 18,
  vaultReach: 3.5,
  vaultBoostDuration: 0.8,
  diveLift: 7.8,
  diveHandHeight: 0.95,
  diveHandReach: 1,
  crashDuration: 0.85,
  crashSpeed: 2.4,
  rollDuration: 0.66,
  rollBuffer: 0.25,
  rollPrepHeight: 0.65,
  trickDuration: 0.46,
} as const;
