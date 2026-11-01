export const ACTIONS = [
  ['forward', 'Move forward'],
  ['back', 'Move backward'],
  ['left', 'Move left'],
  ['right', 'Move right'],
  ['jump', 'Jump / vault / midair trick'],
  ['roll', 'Ground roll'],
  ['ability', 'Class ability'],
  ['restart', 'Restart run'],
  ['pause', 'Pause'],
] as const;
export type Action = (typeof ACTIONS)[number][0];
export type Bindings = Record<Action, string>;
export const DEFAULT_BINDINGS: Bindings = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  roll: 'ShiftLeft',
  ability: 'KeyQ',
  restart: 'KeyR',
  pause: 'KeyP',
};
const aliases: Partial<Record<Action, string[]>> = {
  forward: ['ArrowUp'],
  back: ['ArrowDown'],
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
};
export function validBinding(code: string) {
  return /^(Key[A-Z]|Digit[0-9]|Arrow(?:Up|Down|Left|Right)|Space|Shift(?:Left|Right)|Control(?:Left|Right)|Alt(?:Left|Right)|Mouse[0-4]|Enter|Backspace|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash)$/.test(
    code,
  );
}
export function normalizeBindings(value?: Partial<Bindings>): Bindings {
  let bindings = { ...DEFAULT_BINDINGS };
  for (const [action] of ACTIONS)
    if (value?.[action] && validBinding(value[action]!))
      bindings = rebind(bindings, action, value[action]!);
  return bindings;
}
/** Preserve custom controls while migrating the old R-roll / Shift-sprint defaults. */
export function migrateBindings(value: Partial<Bindings> = {}): Bindings {
  const previous: Partial<Bindings> = { ...DEFAULT_BINDINGS, roll: 'KeyR' };
  let bindings = { ...DEFAULT_BINDINGS };
  for (const [action] of ACTIONS)
    if (action !== 'restart' && value[action] && value[action] !== previous[action])
      bindings = rebind(bindings, action, value[action]!);
  return bindings;
}
/** Swap conflicting bindings so no action becomes inaccessible or fires together. */
export function rebind(current: Bindings, action: Action, code: string): Bindings {
  if (!validBinding(code)) return current;
  const next = { ...current };
  const previous = next[action];
  for (const [other] of ACTIONS)
    if (other !== action && next[other] === code) next[other] = previous;
  next[action] = code;
  return next;
}
export function keyLabel(code: string) {
  const special: Record<string, string> = {
    Space: 'SPACE',
    ShiftLeft: 'L SHIFT',
    ShiftRight: 'R SHIFT',
    ControlLeft: 'L CTRL',
    ControlRight: 'R CTRL',
    AltLeft: 'L ALT',
    AltRight: 'R ALT',
    Mouse0: 'MOUSE 1',
    Mouse1: 'MOUSE 3',
    Mouse2: 'MOUSE 2',
    Mouse3: 'MOUSE 4',
    Mouse4: 'MOUSE 5',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
  };
  return special[code] || code.replace(/^Key|^Digit/, '').toUpperCase();
}
/** Edge presses survive render frames with no physics tick, including a press+release between frames. */
export class RunnerControls {
  private held = new Set<string>();
  private pending = new Map<Action, number>();
  private axis = { forward: 0, right: 0 };
  constructor(public bindings: Bindings = { ...DEFAULT_BINDINGS }) {}
  actionFor(code: string): Action | undefined {
    return (
      ACTIONS.find(([action]) => this.bindings[action] === code)?.[0] ||
      (code === 'ShiftRight' && this.bindings.roll === 'ShiftLeft' ? 'roll' : undefined)
    );
  }
  down(code: string, now: number, repeat = false) {
    const action = this.actionFor(code);
    if (!repeat && !this.held.has(code) && action) this.pending.set(action, now);
    this.held.add(code);
    return action;
  }
  up(code: string) {
    this.held.delete(code);
  }
  press(action: Action, now: number) {
    this.pending.set(action, now);
  }
  move(forward: number, right: number) {
    this.axis = { forward, right };
  }
  clear() {
    this.held.clear();
    this.pending.clear();
    this.axis = { forward: 0, right: 0 };
  }
  private isHeld(action: Action) {
    return (
      this.held.has(this.bindings[action]) ||
      (aliases[action] || []).some(
        (code) => !Object.values(this.bindings).includes(code) && this.held.has(code),
      )
    );
  }
  consume(now: number, yaw: number) {
    const edge = (action: Action) => {
      const at = this.pending.get(action);
      this.pending.delete(action);
      // A slow rendered frame must not throw away a real press. Pause, blur and
      // rebinding explicitly clear the queue instead of expiring it by wall time.
      return at !== undefined;
    };
    return {
      forward: Number(this.isHeld('forward')) - Number(this.isHeld('back')) + this.axis.forward,
      right: Number(this.isHeld('right')) - Number(this.isHeld('left')) + this.axis.right,
      jump: edge('jump'),
      roll: edge('roll'),
      ability: edge('ability'),
      yaw,
    };
  }
}
/** Fixed simulation with input consumption inside the tick, never in a render-only frame. */
export class FixedStepper {
  private remainder = 0;
  advance(delta: number, tick: (dt: number) => void) {
    const step = 1 / 120;
    this.remainder += Math.max(0, Math.min(0.15, delta));
    let count = 0;
    while (this.remainder + 1e-10 >= step) {
      tick(step);
      this.remainder -= step;
      count++;
    }
    return count;
  }
}
