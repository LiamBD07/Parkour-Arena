export const POSES = [
  'idle',
  'run',
  'jump',
  'fall',
  'slide',
  'dive',
  'roll',
  'vault',
  'flip',
  'wallrun',
] as const;
export type MovementPose = (typeof POSES)[number];
export const MOVEMENT = {
  step: 1 / 120,
  gravity: 24,
  jumpSpeed: 10.4,
  jumpBuffer: 0.2,
  coyote: 0.16,
  runSpeed: 8.8,
  sprintSpeed: 11.8,
  wallSpeed: 16,
  wallDuration: 1.8,
  wallDescent: 0.65,
  diveSpeed: 18,
  diveLift: 7.8,
  rollDuration: 0.66,
} as const;
