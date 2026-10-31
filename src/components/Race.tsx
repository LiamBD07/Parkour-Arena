import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Flag,
  Ghost,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  Trophy,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import {
  CLASSES,
  formatTime,
  type ClassId,
  type Course,
  type GhostFrame,
  type Player,
} from '../../shared/game';
import { api, readLocal, writeLocal, type PlayerResponse, type Settings } from '../api';
import { ArenaEngine, type HudState, type Rival } from '../game/engine';
import type { ArenaNetwork } from '../game/network';
import { Scene, Logo, Credits } from './Primitives';
import type { LocalRecord } from './Pages';

export interface RaceConfig {
  id: string;
  course: Course;
  classId: ClassId;
  rivals: Rival[];
  ticket: string | null;
  multiplayer: boolean;
  startsAt?: number;
}
interface Props {
  config: RaceConfig;
  settings: Settings;
  player: Player | null;
  color: string;
  trailColor?: string;
  onPlayer: (p: Player) => void;
  onExit: () => void;
  onRetry: () => void;
  onAuth: () => void;
  engineRef: React.RefObject<ArenaEngine | null>;
  network: ArenaNetwork | null;
  onError: () => void;
}
interface Result {
  time: number;
  falls: number;
  saved: boolean;
  saving: boolean;
  reward: number;
  pb: boolean;
  error: string;
}
const emptyHud: HudState = {
  time: 0,
  speed: 0,
  checkpoint: 0,
  cooldown: 0,
  progress: 0,
  grounded: true,
  message: '',
  countdown: 3,
  falls: 0,
  rivals: [],
};
export function Race({
  config,
  settings,
  player,
  color,
  trailColor,
  onPlayer,
  onExit,
  onRetry,
  onAuth,
  engineRef,
  network,
  onError,
}: Props) {
  const [hud, setHud] = useState<HudState>(emptyHud),
    [paused, setPaused] = useState(false),
    [result, setResult] = useState<Result | null>(null),
    [sound, setSound] = useState(settings.sound);
  const [graphicsError, setGraphicsError] = useState(false);
  const pausedRef = useRef(false),
    resultRef = useRef(false),
    stickRef = useRef<HTMLDivElement>(null),
    stickOrigin = useRef<{ x: number; y: number } | null>(null),
    lookOrigin = useRef<{ x: number; y: number } | null>(null);
  const pause = useCallback(() => {
    if (resultRef.current) return;
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
    engineRef.current?.setPaused(pausedRef.current);
  }, [engineRef]);
  const finish = useCallback(
    async (time: number, frames: GhostFrame[], falls: number) => {
      resultRef.current = true;
      const key = `pa-record-${config.course.id}`;
      const previous = readLocal<LocalRecord | null>(key, null);
      const pb = !previous || time < previous.time;
      if (pb && !config.multiplayer)
        writeLocal(key, { time, frames, classId: config.classId, date: new Date().toISOString() });
      setResult({ time, falls, pb, saved: false, saving: !!config.ticket, reward: 0, error: '' });
      if (config.ticket) {
        try {
          const r = await api<PlayerResponse & { reward: number; personalBest: boolean }>(
            '/runs/finish',
            { ticket: config.ticket, time, frames },
          );
          onPlayer(r.player);
          setResult({
            time,
            falls,
            pb: r.personalBest,
            saved: true,
            saving: false,
            reward: r.reward,
            error: '',
          });
        } catch (e) {
          setResult({
            time,
            falls,
            pb,
            saved: false,
            saving: false,
            reward: 0,
            error: (e as Error).message,
          });
        }
      }
    },
    [config, onPlayer],
  );
  const options = useMemo(
    () => ({
      mode: 'race' as const,
      course: config.course,
      classId: config.classId,
      color,
      trailColor,
      rivals: config.rivals,
      startsAt: config.startsAt,
      quality: settings.quality,
      sensitivity: settings.sensitivity,
      onHud: setHud,
      onFinish: finish,
      onPause: pause,
      onState: network
        ? (state: Parameters<ArenaNetwork['sendState']>[0]) => network.sendState(state)
        : undefined,
    }),
    [config.id],
  );
  useEffect(() => {
    engineRef.current?.setSound(sound);
  }, [sound, engineRef]);
  const standings = [
    { id: 'you', name: player?.username || 'YOU', progress: hud.progress, finished: result?.time },
    ...hud.rivals,
  ].sort((a, b) => (a.finished ?? Infinity) - (b.finished ?? Infinity) || b.progress - a.progress);
  const cls = CLASSES.find((c) => c.id === config.classId)!;
  const touchAction = (action: string) => engineRef.current?.touchAction(action);
  return (
    <div className="race-screen">
      <Scene
        options={options}
        engineRef={engineRef}
        className="race-scene"
        onError={() => {
          setGraphicsError(true);
          onError();
        }}
      />
      <div className="race-top">
        <div className="race-location">
          <Logo compact />
          <div>
            <span>{config.multiplayer ? 'OPEN RACE' : 'SOLO TIME TRIAL'}</span>
            <strong>{config.course.name}</strong>
          </div>
        </div>
        <div className="race-timer">
          <span>RUN TIME</span>
          <strong>{formatTime(hud.time)}</strong>
        </div>
        <div className="race-top-actions">
          <button
            className="icon-button"
            onClick={() => setSound((s) => !s)}
            aria-label={sound ? 'Mute sound effects' : 'Enable sound effects'}
          >
            {sound ? <Volume2 size={19} /> : <VolumeX size={19} />}
          </button>
          <button className="icon-button" onClick={pause} aria-label="Pause race">
            <Pause size={19} />
          </button>
        </div>
      </div>
      <div className="race-course-progress">
        <span>START</span>
        <div>
          <i style={{ width: `${hud.progress * 100}%` }} />
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              className={hud.checkpoint >= i ? 'passed' : ''}
              style={{ left: `${i * 25}%` }}
              key={i}
            />
          ))}
        </div>
        <Flag size={14} />
      </div>
      {!!config.rivals.length && (
        <div className="race-standings">
          <span className="eyebrow">
            {config.multiplayer ? 'RACE POSITIONS' : 'GHOST COMPARISON'}
          </span>
          {standings.map((r, i) => (
            <div key={r.id} className={r.id === 'you' ? 'you' : ''}>
              <span>{String(i + 1).padStart(2, '0')}</span>
              <span>
                {r.name}
                {r.id === 'you' ? ' · YOU' : ''}
              </span>
              <span>
                {r.finished ? formatTime(r.finished) : `${Math.floor(r.progress * 100)}%`}
              </span>
            </div>
          ))}
        </div>
      )}
      {hud.message && !result && (
        <div className="movement-message" key={hud.message}>
          {hud.message}
        </div>
      )}
      {hud.countdown > 0 && !paused && !result && (
        <div className="countdown-overlay">
          <span>FIND YOUR LINE</span>
          <strong key={hud.countdown}>{hud.countdown}</strong>
          <p>Click the course to look around · W to move · Shift to sprint</p>
        </div>
      )}
      {!result && (
        <>
          <div className="race-speed">
            <span>MOMENTUM</span>
            <div>
              <strong>{(hud.speed * 3.6).toFixed(0)}</strong>
              <span>KM/H</span>
            </div>
            <div className="speed-meter">
              {Array.from({ length: 20 }, (_, i) => (
                <i className={(hud.speed / 18) * 20 > i ? 'lit' : ''} key={i} />
              ))}
            </div>
          </div>
          <div className="race-ability">
            <div className={`ability-key ${hud.cooldown ? 'cooling' : ''}`}>
              <kbd>Q</kbd>
              {hud.cooldown > 0 && <span>{Math.ceil(hud.cooldown)}</span>}
            </div>
            <div>
              <span>{cls.name.toUpperCase()}</span>
              <strong>{cls.ability}</strong>
              <small>
                {hud.cooldown ? `Ready in ${Math.ceil(hud.cooldown)}s` : 'ABILITY READY'}
              </small>
            </div>
          </div>
          <div className="race-controls-hint">
            <kbd>SPACE</kbd> JUMP <kbd>C</kbd> SLIDE <kbd>F</kbd> FLIP <kbd>E</kbd> WALL RUN{' '}
            <kbd>P</kbd> PAUSE
          </div>
        </>
      )}
      {!result && !paused && (
        <div className="touch-controls">
          <div
            className="touch-look"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              lookOrigin.current = { x: e.clientX, y: e.clientY };
            }}
            onPointerMove={(e) => {
              if (lookOrigin.current) {
                engineRef.current?.touchLook(
                  e.clientX - lookOrigin.current.x,
                  e.clientY - lookOrigin.current.y,
                );
                lookOrigin.current = { x: e.clientX, y: e.clientY };
              }
            }}
            onPointerUp={() => {
              lookOrigin.current = null;
            }}
            onPointerCancel={() => {
              lookOrigin.current = null;
            }}
          />
          <div
            className="touch-stick"
            ref={stickRef}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              const r = e.currentTarget.getBoundingClientRect();
              stickOrigin.current = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
            }}
            onPointerMove={(e) => {
              if (stickOrigin.current)
                engineRef.current?.touchMove(
                  Math.max(-1, Math.min(1, (stickOrigin.current.y - e.clientY) / 38)),
                  Math.max(-1, Math.min(1, (e.clientX - stickOrigin.current.x) / 38)),
                );
            }}
            onPointerUp={() => {
              stickOrigin.current = null;
              engineRef.current?.touchMove(0, 0);
            }}
            onPointerCancel={() => {
              stickOrigin.current = null;
              engineRef.current?.touchMove(0, 0);
            }}
          >
            <span>MOVE</span>
          </div>
          <div className="touch-actions">
            {[
              ['KeyQ', 'ABILITY'],
              ['KeyC', 'SLIDE'],
              ['Space', 'JUMP'],
              ['KeyF', 'FLIP'],
              ['KeyE', 'WALL'],
              ['KeyX', 'DIVE'],
            ].map(([key, label]) => (
              <button
                key={key}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  if (key === 'KeyC' || key === 'KeyE') engineRef.current?.touchHold(key, true);
                  else touchAction(key);
                }}
                onPointerUp={() => engineRef.current?.touchHold(key, false)}
                onPointerCancel={() => engineRef.current?.touchHold(key, false)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      {paused && !result && (
        <div className="race-overlay">
          <div className="pause-panel">
            <span className="eyebrow">TAKE A BREATH</span>
            <h1>
              STILL IN
              <br />
              THE RUN.
            </h1>
            <p>
              Physics is paused. The run timer keeps going.
              <br />
              In open races, the other runners keep moving.
            </p>
            <button className="button primary full" onClick={pause}>
              <Play size={17} fill="currentColor" />
              BACK TO THE ROOFTOPS
            </button>
            <button className="button secondary full" onClick={onRetry}>
              <RotateCcw size={17} />
              RESTART RUN
            </button>
            <button className="text-button" onClick={onExit}>
              <ArrowLeft size={15} />
              LEAVE THE COURSE
            </button>
          </div>
        </div>
      )}
      {result && (
        <div className="race-overlay">
          <div className="result-panel">
            <div className="result-icon">
              <Trophy size={30} />
            </div>
            <span className="eyebrow">
              {result.pb ? 'A NEW LINE. A NEW PERSONAL BEST.' : 'ANOTHER LINE IN THE BOOKS.'}
            </span>
            <h1>
              THAT’S A RUN<span>.</span>
            </h1>
            <strong className="result-time">{formatTime(result.time)}</strong>
            <span className="result-course">
              {config.course.name} <span>·</span> {cls.name}
            </span>
            <div className="result-stats">
              <div>
                <span>CHECKPOINTS</span>
                <strong>4 / 4</strong>
              </div>
              <div>
                <span>RECOVERIES</span>
                <strong>{result.falls}</strong>
              </div>
              <div>
                <span>CREDITS EARNED</span>
                <strong>
                  <Credits amount={result.reward} />
                </strong>
              </div>
            </div>
            <div className={`result-save ${result.error ? 'failed' : ''}`}>
              {result.saving ? (
                <>
                  <LoaderCircle size={16} className="spin" />
                  Validating your run and saving your ghost…
                </>
              ) : result.saved ? (
                <>
                  <Check size={16} />
                  Run saved. Your ghost is on the leaderboard.
                </>
              ) : result.error ? (
                <>
                  <X size={16} />
                  Saved locally only. {result.error}
                </>
              ) : config.multiplayer ? (
                <>
                  <Flag size={16} />
                  Open races are casual. Leaderboards use solo runs.
                </>
              ) : (
                <>
                  <Ghost size={16} />
                  Practice ghost saved in this browser.{' '}
                  {player
                    ? 'This was an unranked run.'
                    : 'Sign in before your next run to save it online.'}
                </>
              )}
            </div>
            <button className="button primary full" disabled={result.saving} onClick={onRetry}>
              <RotateCcw size={17} />
              ONE MORE RUN
              <ArrowRight size={19} />
            </button>
            <button className="button secondary full" onClick={onExit}>
              <ArrowLeft size={17} />
              BACK TO THE ARENA
            </button>
            {!player && (
              <button className="text-button" onClick={onAuth}>
                Create your runner account
                <ArrowUpRightIcon />
              </button>
            )}
          </div>
        </div>
      )}
      {graphicsError && (
        <div className="race-overlay">
          <div className="pause-panel">
            <h1>3D UNAVAILABLE.</h1>
            <p>
              This browser could not create a WebGL scene. Enable hardware acceleration or try a
              browser with WebGL 2 support.
            </p>
            <button className="button primary" onClick={onExit}>
              BACK TO THE ARENA
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
function ArrowUpRightIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
      <path d="M3 12 12 3M3 3h9v9" stroke="currentColor" fill="none" />
    </svg>
  );
}
