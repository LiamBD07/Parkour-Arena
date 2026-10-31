export type Vec3 = [number, number, number];
export type ClassId = 'runner' | 'traceur' | 'acrobat';
export type MapId = 'skyline' | 'foundry' | 'harbor';
export type Pose = 'run' | 'slide' | 'dive' | 'flip' | 'idle';
export interface GhostFrame {
  t: number;
  p: Vec3;
  yaw: number;
  pose: Pose;
}
export interface Platform {
  p: Vec3;
  size: Vec3;
  kind?: 'hinge' | 'wall' | 'obstacle';
}
export interface Checkpoint {
  p: Vec3;
  label: string;
}
export interface Course {
  id: MapId;
  name: string;
  district: string;
  description: string;
  difficulty: string;
  distance: number;
  target: number;
  accent: string;
  start: Vec3;
  platforms: Platform[];
  checkpoints: Checkpoint[];
}
export const CLASSES = [
  {
    id: 'runner' as const,
    name: 'Runner',
    role: 'BUILT FOR SPEED',
    ability: 'Second wind',
    description: 'A short burst of speed. Make every straight count.',
    key: 'Q',
    cooldown: 12,
    color: '#c7ef5c',
    stats: [92, 68, 75],
  },
  {
    id: 'traceur' as const,
    name: 'Traceur',
    role: 'OWN THE WALLS',
    ability: 'Wall kick',
    description: 'Launch from high-friction walls with extra lift.',
    key: 'Q',
    cooldown: 10,
    color: '#5fd5e9',
    stats: [76, 93, 72],
  },
  {
    id: 'acrobat' as const,
    name: 'Acrobat',
    role: 'STAY AIRBORNE',
    ability: 'Air step',
    description: 'One extra jump in the air. Find a new line.',
    key: 'Q',
    cooldown: 14,
    color: '#c2a2ff',
    stats: [75, 77, 94],
  },
];
const base: Platform[] = [
  { p: [0, 2, 0], size: [14, 4, 18] },
  { p: [0, 2, 22], size: [13, 4, 16] },
  { p: [-5, 3, 43], size: [13, 4, 16] },
  { p: [2, 4, 64], size: [13, 4, 16] },
  { p: [0, 3, 85], size: [14, 4, 16] },
  { p: [5, 4, 106], size: [13, 4, 16], kind: 'hinge' },
  { p: [0, 3, 127], size: [14, 4, 16] },
  { p: [0, 3, 148], size: [16, 4, 18] },
  { p: [-7.8, 8, 19], size: [1, 8, 22], kind: 'wall' },
  { p: [9.5, 10, 62], size: [1, 9, 19], kind: 'wall' },
  { p: [-1, 4.6, 25], size: [5, 1.2, 2], kind: 'obstacle' },
  { p: [-5, 7.1, 47], size: [10, 0.7, 2.6], kind: 'obstacle' },
  { p: [2, 6.6, 67], size: [4, 1.2, 2], kind: 'obstacle' },
  { p: [0, 5.6, 130], size: [4, 1.2, 2], kind: 'obstacle' },
];
function makeCourse(
  id: MapId,
  name: string,
  district: string,
  description: string,
  difficulty: string,
  accent: string,
  bend: number,
): Course {
  const shift = (p: Vec3): Vec3 => [p[0] + Math.sin(p[2] / 32) * bend, p[1], p[2]];
  return {
    id,
    name,
    district,
    description,
    difficulty,
    distance: 154,
    target: 24500,
    accent,
    start: [0, 4, -5],
    platforms: base.map((p) => ({ ...p, p: shift(p.p) })),
    checkpoints: [
      { p: [0, 4, -5], label: 'START' },
      { p: shift([-5, 5, 42]), label: '01' },
      { p: shift([0, 5, 83]), label: '02' },
      { p: shift([0, 5, 125]), label: '03' },
      { p: shift([0, 5, 151]), label: 'FINISH' },
    ],
  };
}
export const COURSES: Course[] = [
  makeCourse(
    'skyline',
    'Skyline Circuit',
    'SECTOR 07 · ROOFTOPS',
    'Above the noise. Beyond the ordinary. Find your line across the city skyline.',
    'INTERMEDIATE',
    '#c7ef5c',
    0,
  ),
  makeCourse(
    'foundry',
    'The Foundry',
    'SECTOR 03 · INDUSTRIAL',
    'Hot steel. Tight corners. Thread a precise line through the industrial district.',
    'TECHNICAL',
    '#ff9a62',
    3,
  ),
  makeCourse(
    'harbor',
    'Harbor Run',
    'SECTOR 12 · WATERFRONT',
    'Salt in the air and nothing below. Keep your momentum on the waterfront.',
    'ADVANCED',
    '#67dbe6',
    6,
  ),
];
export const ITEMS = [
  {
    id: 'standard',
    name: 'Origin',
    kind: 'skin',
    rarity: 'STANDARD',
    price: 0,
    color: '#c7ef5c',
    description: 'Every great run starts somewhere.',
  },
  {
    id: 'carbon',
    name: 'Carbon Ghost',
    kind: 'skin',
    rarity: 'EPIC',
    price: 1200,
    color: '#82c9ff',
    description: 'Disappear into the skyline. Matte graphite. Ice-blue details.',
  },
  {
    id: 'ember',
    name: 'Afterburn',
    kind: 'skin',
    rarity: 'RARE',
    price: 600,
    color: '#ff9365',
    description: 'Leave a little heat behind.',
  },
  {
    id: 'violet',
    name: 'Night Shift',
    kind: 'skin',
    rarity: 'EPIC',
    price: 1400,
    color: '#bf9cff',
    description: 'Made for the hours after dark.',
  },
  {
    id: 'chalk',
    name: 'Off Grid',
    kind: 'skin',
    rarity: 'RARE',
    price: 800,
    color: '#e5ded0',
    description: 'Clean lines. Uncomplicated speed.',
  },
  {
    id: 'lime-trail',
    name: 'Volt trail',
    kind: 'trail',
    rarity: 'RARE',
    price: 450,
    color: '#c7ef5c',
    description: 'A signature line of electric lime.',
  },
  {
    id: 'ember-trail',
    name: 'Heatwave trail',
    kind: 'trail',
    rarity: 'EPIC',
    price: 900,
    color: '#ff9365',
    description: 'Make your fastest line glow.',
  },
] as const;
export type ItemId = (typeof ITEMS)[number]['id'];
export interface Player {
  id: string;
  username: string;
  credits: number;
  mmr: number;
  equipped: string;
  trail: string | null;
  owned: string[];
  runs: number;
  best: number | null;
}
export interface LeaderboardEntry {
  id: string;
  username: string;
  time: number;
  classId: ClassId;
  skin: string;
  createdAt: string;
}
export interface PeerState {
  id: string;
  p: Vec3;
  yaw: number;
  pose: Pose;
  progress: number;
  finished?: number;
}
// An initial, transparent skill estimate learned from validated solo times.
// Open races are casual; this is not an authoritative competitive ladder rating.
export function ratingForRun(time: number, target: number) {
  return Math.round(Math.max(600, Math.min(1800, 1200 + (target / time - 1) * 650)));
}
export function botDuration(mmr: number, seed = 0) {
  const base = 24500 / Math.max(0.35, 1 + (mmr - 1200) / 650);
  return Math.round(Math.max(14000, Math.min(65000, base + (seed - 1) * 900)) / 100) * 100;
}
export function formatTime(ms: number | null): string {
  if (ms === null) return '--:--.---';
  return `${Math.floor(ms / 60000)
    .toString()
    .padStart(2, '0')}:${(Math.floor(ms / 1000) % 60).toString().padStart(2, '0')}.${Math.floor(
    ms % 1000,
  )
    .toString()
    .padStart(3, '0')}`;
}
