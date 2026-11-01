export type Vec3 = [number, number, number];
export type ClassId = 'runner' | 'traceur' | 'acrobat';
export type MapId = 'skyline' | 'foundry' | 'harbor';
export type { MovementPose as Pose } from './movement.js';
import type { MovementPose as Pose } from './movement.js';
export interface GhostFrame {
  t: number;
  p: Vec3;
  yaw: number;
  pose: Pose;
  phase?: number;
  wallSide?: number;
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
  version: number;
  wallSections: { from: number; to: number; wall: number }[];
}
export function courseProgress(course: Course, z: number) {
  return Math.max(
    0,
    Math.min(1, (z - course.start[2]) / (course.checkpoints.at(-1)!.p[2] - course.start[2])),
  );
}
export function localRecordKey(course: Course) {
  return `pa-record-${course.id}-v${course.version}`;
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
  { p: [0, 2, 0], size: [16, 4, 10] },
  { p: [0, 2, 31.5], size: [16, 4, 8] },
  { p: [0, 3, 50.5], size: [22, 4, 24] },
  { p: [2, 3, 91], size: [18, 4, 12] },
  { p: [0, 3, 110], size: [14, 4, 16] },
  { p: [5, 4, 131], size: [13, 4, 16], kind: 'hinge' },
  { p: [0, 3, 152], size: [14, 4, 16] },
  { p: [0, 3, 173], size: [16, 4, 18] },
  { p: [-7.8, 8, 18], size: [1, 8, 30], kind: 'wall' },
  { p: [10.8, 9.5, 76], size: [1, 9, 31], kind: 'wall' },
  { p: [-1, 4.6, 31.5], size: [5, 1.2, 2], kind: 'obstacle' },
  { p: [0, 7.1, 51], size: [24, 0.7, 2.6], kind: 'obstacle' },
  { p: [2, 5.6, 92], size: [4, 1.2, 2], kind: 'obstacle' },
  { p: [0, 5.6, 155], size: [4, 1.2, 2], kind: 'obstacle' },
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
    distance: 183,
    target: 34000,
    version: 2,
    wallSections: [
      { from: 0, to: 1, wall: 8 },
      { from: 2, to: 3, wall: 9 },
    ],
    accent,
    start: [0, 4, -5],
    platforms: base.map((p) => ({ ...p, p: shift(p.p) })),
    checkpoints: [
      { p: [0, 4, -5], label: 'START' },
      { p: shift([0, 5, 46]), label: '01' },
      { p: shift([2, 5, 91]), label: '02' },
      { p: shift([0, 5, 150]), label: '03' },
      { p: shift([0, 5, 178]), label: 'FINISH' },
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
  phase?: number;
  wallSide?: number;
  progress: number;
  finished?: number;
}
// An initial, transparent skill estimate learned from validated solo times.
// Open races are casual; this is not an authoritative competitive ladder rating.
export function ratingForRun(time: number, target: number) {
  return Math.round(Math.max(600, Math.min(1800, 1200 + (target / time - 1) * 650)));
}
export function botDuration(mmr: number, seed = 0) {
  const base = 34000 / Math.max(0.35, 1 + (mmr - 1200) / 650);
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
