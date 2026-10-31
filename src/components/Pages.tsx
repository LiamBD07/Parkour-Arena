import { keyLabel } from '../game/controls';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Flag,
  Footprints,
  Ghost,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  MapPin,
  Medal,
  Play,
  Rotate3D,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Trophy,
  Users,
  Wind,
  Zap,
} from 'lucide-react';
import {
  CLASSES,
  COURSES,
  ITEMS,
  formatTime,
  type ClassId,
  type Course,
  type GhostFrame,
  type LeaderboardEntry,
  type Player,
} from '../../shared/game';
import { api, type Settings, type PlayerResponse } from '../api';
import { Scene, SectionTitle, Credits, ArrowLink, Modal } from './Primitives';

export interface LocalRecord {
  time: number;
  frames: GhostFrame[];
  classId: ClassId;
  date: string;
}
export function ClassIcon({ id, size = 24 }: { id: ClassId; size?: number }) {
  return id === 'runner' ? (
    <Wind size={size} />
  ) : id === 'traceur' ? (
    <Footprints size={size} />
  ) : (
    <Rotate3D size={size} />
  );
}
export function RunnerArt({
  color,
  id = 'runner',
  className = '',
}: {
  color: string;
  id?: string;
  className?: string;
}) {
  return (
    <svg className={`runner-art ${className}`} viewBox="0 0 220 300" aria-hidden="true">
      <defs>
        <linearGradient id={`suit-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#748084" />
          <stop offset=".4" stopColor="#37464b" />
          <stop offset="1" stopColor="#172329" />
        </linearGradient>
        <linearGradient id={`light-${id}`}>
          <stop stopColor={color} />
          <stop offset="1" stopColor={color} stopOpacity=".3" />
        </linearGradient>
      </defs>
      <ellipse cx="112" cy="282" rx="57" ry="10" fill="#050b0e" opacity=".4" />
      <g fill={`url(#suit-${id})`} stroke="#7b8b8d" strokeOpacity=".25">
        <path d="m91 44 3-17 18-8 19 8 4 21-9 18-23-1z" />
        <path d="m80 74 22-11h25l21 14-7 69-19 19-30-9-18-37z" />
        <path d="m82 77-16 5-16 48 11 10 17-30zm-32 54-5 44 15 8 8-39zm92-53 18 10 10 44-16 7-15-35zm13 58 6 43 16-5-3-43z" />
        <path d="m86 150 27 10-7 55-22 3-8-17zm29 10 26-12 7 55-20 14-14-5z" />
        <path d="m83 214 23-1-8 47-16 6-8-10zm44 0 20-12 5 54-14 9-10-7z" />
        <path d="m82 257 16 1 9 17-5 7H70l-1-10zm55 0 16-3 10 18-1 7-30 3-3-10z" />
      </g>
      <g fill={`url(#light-${id})`}>
        <path d="m94 40 33-4 2 6-31 6zM80 80l8 1-8 29-6-1zm56 1 7-1 5 31-7 1zM93 119l40-3-2 5-37 4zm-42 38 14 5-2 5-13-5zm110 2 14-3 1 5-14 3zM79 224l23-3-1 5-23 3zm50-1 20-5 1 6-20 5z" />
      </g>
      <path d="m99 29 24-2 4 8-31 5z" fill="#102026" />
      <path d="m95 86 32-3 8 23-39 7z" fill="#16272d" />
      <path d="m101 91 17-2-7 12h-8zm16 12 7-12 6 11z" fill={color} opacity=".85" />
      <path d="m89 146 43 1-9 12-28-4z" fill="#102026" />
    </svg>
  );
}
interface PlayPageProps {
  course: Course;
  classId: ClassId;
  player: Player | null;
  settings: Settings;
  mode: 'solo' | 'online';
  onMode: (m: 'solo' | 'online') => void;
  onPlay: () => void;
  onMaps: () => void;
  onClass: () => void;
  onBoard: () => void;
  record: LocalRecord | null;
  busy: boolean;
  onGraphicsError: () => void;
}
export function PlayPage({
  course,
  classId,
  player,
  settings,
  mode,
  onMode,
  onPlay,
  onMaps,
  onClass,
  onBoard,
  record,
  busy,
  onGraphicsError,
}: PlayPageProps) {
  const character = CLASSES.find((c) => c.id === classId)!;
  const skin = ITEMS.find((i) => i.id === player?.equipped) || ITEMS[0];
  const scene = useMemo(
    () => ({ mode: 'menu' as const, course, color: skin.color, quality: settings.quality }),
    [course, skin.color, settings.quality],
  );
  return (
    <div className="play-page page-enter">
      <section className="hero">
        <Scene options={scene} className="hero-scene" onError={onGraphicsError} />
        <div className="hero-shade" />
        <div className="hero-grid" />
        <div className="hero-topline">
          <span>
            <span className="live-dot" /> SEASON 01 <span className="slash">/</span> THE ASCENT
          </span>
          <span className="hero-coordinates">35° 53′ N &nbsp; 14° 30′ E</span>
        </div>
        <div className="hero-copy">
          <div className="hero-kicker">
            <span /> NO LIMITS. JUST YOUR LINE.
          </div>
          <h1>
            THE CITY
            <br />
            IS YOUR
            <br />
            <em>PLAYGROUND.</em>
          </h1>
          <p>
            Chase your ghost. Own the skyline.
            <br />
            Make the impossible your fastest route.
          </p>
          <button className="button primary hero-cta" disabled={busy} onClick={onPlay}>
            {busy ? (
              <LoaderCircle className="spin" size={21} />
            ) : (
              <Play size={18} fill="currentColor" />
            )}
            <span>{mode === 'solo' ? 'START YOUR RUN' : 'FIND A RACE'}</span>
            <ArrowRight size={22} />
          </button>
          <span className="hero-cta-note">
            {mode === 'solo'
              ? 'SOLO TIME TRIAL · YOUR PACE. YOUR RECORD.'
              : 'OPEN RACE · 4 RUNNERS · BOTS FILL OPEN SLOTS'}
          </span>
        </div>
        <div className="hero-scene-label">
          <div className="scene-cross">+</div>
          <div>
            <span>BUILT FOR THE ROOFTOPS</span>
            <strong>ONE MORE RUN.</strong>
          </div>
          <span className="label-line" />
        </div>
        <div className="hero-bottom">
          <div className="mode-tabs">
            <button className={mode === 'solo' ? 'active' : ''} onClick={() => onMode('solo')}>
              <Ghost size={17} />
              <span>SOLO TIME TRIAL</span>
              <span className="mode-indicator" />
            </button>
            <button className={mode === 'online' ? 'active' : ''} onClick={() => onMode('online')}>
              <Users size={17} />
              <span>OPEN RACE</span>
              <span className="mini-tag">BETA</span>
            </button>
          </div>
          <span className="hero-build">
            MOVEMENT IS FREEDOM <ArrowUpRight size={15} />
          </span>
        </div>
      </section>
      <div className="home-section-heading">
        <span>YOUR NEXT MOVE</span>
        <span>
          THE ROOFTOPS ARE WAITING <span className="lime">↗</span>
        </span>
      </div>
      <div className="home-cards">
        <button className={`home-map-card map-art ${course.id}`} onClick={onMaps}>
          <div className="map-card-shade" />
          <span className="eyebrow">SELECTED COURSE</span>
          <span className="map-card-bottom">
            <span>
              <small>{course.district}</small>
              <strong>{course.name}</strong>
              <span className="map-card-tags">
                <span>{course.difficulty}</span>
                <span>
                  <Flag size={11} />
                  {course.distance} M
                </span>
              </span>
            </span>
            <span className="square-arrow">
              <ArrowUpRight size={23} />
            </span>
          </span>
        </button>
        <button className="home-runner-card" onClick={onClass}>
          <span className="eyebrow">
            YOUR CLASS <ChevronDown size={13} />
          </span>
          <div className="home-class-icon">
            <ClassIcon id={classId} size={37} />
          </div>
          <div>
            <h3>{character.name}</h3>
            <span className="muted">{character.ability}</span>
          </div>
          <span className="class-bottom">
            <kbd>{keyLabel(settings.bindings.ability)}</kbd>
            <span>{character.role}</span>
            <ArrowUpRight size={16} />
          </span>
        </button>
        <div className="home-record-card">
          <span className="eyebrow">
            THE ONLY WAY IS UP <Trophy size={14} />
          </span>
          <span className="record-caption">
            {record ? 'YOUR LOCAL BEST' : 'YOUR NEXT PERSONAL BEST'}
          </span>
          <strong className="record-time">
            {record ? formatTime(record.time) : 'MAKE YOUR MARK.'}
          </strong>
          <p>
            {record
              ? `${course.name} · ${CLASSES.find((c) => c.id === record.classId)?.name}`
              : 'Every legend starts with a first run.'}
          </p>
          <ArrowLink onClick={onBoard}>EXPLORE THE LEADERBOARD</ArrowLink>
        </div>
      </div>
      <div className="home-note">
        <ShieldMark />
        <span>SKILL SETS THE PACE.</span>
        <span>Cosmetics change your look. Never your performance.</span>
      </div>
    </div>
  );
}
function ShieldMark() {
  return (
    <svg width="15" height="17" viewBox="0 0 15 17" fill="none" aria-hidden="true">
      <path d="m7.5 1 6 2.5V8c0 4-6 7-6 7S1.5 12 1.5 8V3.5L7.5 1Z" stroke="currentColor" />
      <path d="m4.5 8 2 2 4-4" stroke="currentColor" />
    </svg>
  );
}
export function MapsPage({
  course,
  onSelect,
  onPlay,
  busy,
}: {
  course: Course;
  onSelect: (c: Course) => void;
  onPlay: () => void;
  busy: boolean;
}) {
  return (
    <div className="page-content page-enter">
      <SectionTitle eyebrow="THREE DISTRICTS. ENDLESS POSSIBILITIES." title="PICK YOUR LINE">
        <span className="count-pill">03 COURSES</span>
      </SectionTitle>
      <div className="maps-grid">
        {COURSES.map((map, i) => (
          <button
            className={`course-card ${course.id === map.id ? 'selected' : ''}`}
            key={map.id}
            onClick={() => onSelect(map)}
          >
            <div className={`course-image map-art ${map.id}`}>
              <span className="course-number">0{i + 1}</span>
              <span className="course-selection">
                {course.id === map.id ? (
                  <>
                    <Check size={13} />
                    SELECTED
                  </>
                ) : (
                  <ArrowUpRight size={18} />
                )}
              </span>
              <div className="map-card-shade" />
              <span className="course-image-title">
                {map.name.split(' ')[0]}
                <br />
                {map.name.split(' ').slice(1).join(' ')}
              </span>
            </div>
            <div className="course-info">
              <span className="eyebrow">{map.district}</span>
              <h2>{map.name}</h2>
              <p>{map.description}</p>
              <div>
                <span>
                  <Flag size={14} />
                  {map.distance} m
                </span>
                <span>
                  <Layers3 size={14} />
                  {map.difficulty}
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>
      <div className="course-launch">
        <div>
          <span className="eyebrow">READY WHEN YOU ARE</span>
          <h3>
            {course.name}
            <span> Solo time trial</span>
          </h3>
        </div>
        <button className="button primary" disabled={busy} onClick={onPlay}>
          {busy ? (
            <LoaderCircle className="spin" size={18} />
          ) : (
            <Play size={16} fill="currentColor" />
          )}
          RUN THIS COURSE
          <ArrowRight size={19} />
        </button>
      </div>
      <div className="tip-box">
        <span>EXPLORE THE MOVEMENT</span>Amber walls support wall running. Duck beneath low beams.
        Jump off hinged roofs before they drop. The fastest route rewards a little creativity.
      </div>
    </div>
  );
}
export function ClassDialog({
  abilityKey,
  selected,
  onSelect,
  onClose,
}: {
  abilityKey: string;
  selected: ClassId;
  onSelect: (id: ClassId) => void;
  onClose: () => void;
}) {
  return (
    <Modal title="BUILT DIFFERENT." eyebrow="CHOOSE YOUR RUNNER CLASS" onClose={onClose} wide>
      <p className="muted">
        Three ways to find your flow. Every class is free. Shared movement speed; different tactical
        abilities.
      </p>
      <div className="classes-grid">
        {CLASSES.map((c) => (
          <button
            key={c.id}
            className={`class-card ${selected === c.id ? 'selected' : ''}`}
            style={{ '--class-color': c.color } as React.CSSProperties}
            onClick={() => onSelect(c.id)}
          >
            <ClassIcon id={c.id} size={38} />
            <span className="eyebrow">{c.role}</span>
            <h3>{c.name}</h3>
            <p>{c.description}</p>
            <div className="class-ability">
              <kbd>{keyLabel(abilityKey)}</kbd>
              <span>
                {c.ability}
                <small>{c.cooldown}s cooldown</small>
              </span>
            </div>
            <div className="class-bars">
              {['BURST', 'WALLS', 'AIRTIME'].map((s, i) => (
                <div key={s}>
                  <span>{s}</span>
                  <span className="stat-bar">
                    <i style={{ width: `${c.stats[i]}%` }} />
                  </span>
                </div>
              ))}
            </div>
            <span className="class-selected">
              {selected === c.id ? (
                <>
                  <Check size={15} />
                  SELECTED
                </>
              ) : (
                'SELECT CLASS'
              )}
            </span>
          </button>
        ))}
      </div>
      <p className="fine-print">
        Bars describe ability specialties, not separate base movement attributes.
      </p>
      <button className="button primary" onClick={onClose}>
        LOCK IT IN
        <ArrowRight size={18} />
      </button>
    </Modal>
  );
}
export function LeaderboardPage({
  course,
  onCourse,
  onRace,
  onGuide,
  record,
}: {
  course: Course;
  onCourse: (c: Course) => void;
  onRace: (entry: LeaderboardEntry) => void;
  onGuide: () => void;
  record: LocalRecord | null;
}) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]),
    [filter, setFilter] = useState(''),
    [busy, setBusy] = useState(true),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setBusy(true);
    setError('');
    api<{ entries: LeaderboardEntry[] }>(
      `/leaderboard?map=${course.id}${filter ? `&class=${filter}` : ''}`,
    )
      .then((r) => {
        if (live) setEntries(r.entries);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [course.id, filter]);
  return (
    <div className="page-content page-enter">
      <SectionTitle
        eyebrow="GOOD RUNNERS CHASE TIMES. GREAT RUNNERS CHASE GHOSTS."
        title="THE LEADERBOARD"
      >
        <span className="count-pill">
          <Trophy size={14} />
          SOLO RECORDS
        </span>
      </SectionTitle>
      <div className="board-filters">
        <div className="pill-tabs">
          {COURSES.map((c) => (
            <button
              key={c.id}
              className={course.id === c.id ? 'active' : ''}
              onClick={() => onCourse(c)}
            >
              {c.name}
            </button>
          ))}
        </div>
        <label className="filter-select">
          <SlidersHorizontal size={15} />
          <select
            aria-label="Filter leaderboard by class"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">All classes</option>
            {CLASSES.map((c) => (
              <option value={c.id} key={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="board-table">
        <div className="board-head">
          <span>RANK</span>
          <span>RUNNER</span>
          <span>CLASS</span>
          <span>TIME</span>
          <span>RACE THE GHOST</span>
        </div>
        {busy ? (
          <div className="empty-state">
            <LoaderCircle className="spin" />
            <h3>Finding the fastest lines…</h3>
          </div>
        ) : error ? (
          <div className="empty-state">
            <h3>THE BOARD IS UNAVAILABLE.</h3>
            <p>{error}</p>
          </div>
        ) : !entries.length ? (
          <div className="empty-state">
            <div className="empty-icon">
              <Trophy size={35} />
            </div>
            <span className="eyebrow">AN OPEN ROOFTOP. AN OPEN RECORD.</span>
            <h3>BE THE FIRST TO SET THE PACE.</h3>
            <p>
              No times on this course yet. Sign in and finish a solo run
              <br />
              to claim a place on the board.
            </p>
            <button className="button secondary" onClick={onGuide}>
              <Ghost size={16} />
              PRACTICE WITH A GUIDE GHOST
              <ArrowRight size={17} />
            </button>
          </div>
        ) : (
          entries.map((e, i) => (
            <div className="board-row" key={e.id}>
              <span className={`rank rank-${i + 1}`}>
                {i < 3 ? <Medal size={21} /> : String(i + 1).padStart(2, '0')}
              </span>
              <span className="board-runner">
                <span
                  className="runner-avatar"
                  style={{ color: ITEMS.find((s) => s.id === e.skin)?.color }}
                >
                  <ClassIcon id={e.classId} size={21} />
                </span>
                <strong>{e.username}</strong>
              </span>
              <span className="board-class">{CLASSES.find((c) => c.id === e.classId)?.name}</span>
              <span className="board-time">{formatTime(e.time)}</span>
              <button
                className="ghost-button"
                onClick={() => onRace(e)}
                aria-label={`Race ${e.username}'s ghost`}
              >
                <Ghost size={16} />
                <span>RACE GHOST</span>
                <ArrowUpRight size={16} />
              </button>
            </div>
          ))
        )}
      </div>
      <div className="leaderboard-note">
        <Ghost size={23} />
        <div>
          <strong>THE PERFECT RIVAL NEVER LOGS OFF.</strong>
          <p>
            Race a recorded run from the leaderboard. Solo finishes are checked for timing, movement
            limits and checkpoint order.
          </p>
        </div>
        {record && (
          <span className="local-pb">
            <span>LOCAL PB</span>
            {formatTime(record.time)}
          </span>
        )}
      </div>
    </div>
  );
}
export function LockerPage({
  player,
  settings,
  onAuth,
  onPlayer,
  onShop,
  notify,
}: {
  player: Player | null;
  settings: Settings;
  onAuth: () => void;
  onPlayer: (p: Player) => void;
  onShop: () => void;
  notify: (s: string) => void;
}) {
  const [selected, setSelected] = useState(player?.equipped || 'standard'),
    [tab, setTab] = useState('skin'),
    [busy, setBusy] = useState(false);
  const item = ITEMS.find((i) => i.id === selected) || ITEMS[0];
  const skin =
    item.kind === 'skin' ? item : ITEMS.find((i) => i.id === player?.equipped) || ITEMS[0];
  const trailColor =
    item.kind === 'trail' ? item.color : ITEMS.find((i) => i.id === player?.trail)?.color;
  const scene = useMemo(
    () => ({ mode: 'locker' as const, color: skin.color, trailColor, quality: settings.quality }),
    [skin.color, trailColor, settings.quality],
  );
  const owned = player?.owned.includes(item.id) || item.id === 'standard';
  const equipped =
    item.kind === 'skin' ? (player?.equipped || 'standard') === item.id : player?.trail === item.id;
  async function equip() {
    if (!player) {
      onAuth();
      return;
    }
    setBusy(true);
    try {
      const r = await api<PlayerResponse>('/locker/equip', { itemId: item.id });
      onPlayer(r.player);
      notify(`${item.name} equipped.`);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page-content page-enter">
      <SectionTitle eyebrow="YOUR RUNNER. YOUR SIGNATURE." title="THE LOCKER">
        <span className="count-pill">{player?.owned.length || 1} ITEMS OWNED</span>
      </SectionTitle>
      <div className="locker-layout">
        <div className="locker-preview">
          <Scene options={scene} />
          <div className="locker-vignette" />
          <span className="eyebrow locker-preview-label">
            RUNNER PREVIEW <span className="live-dot" />
          </span>
          <div className="locker-character-label">
            <span className="rarity" style={{ color: item.color }}>
              {item.rarity} {item.kind.toUpperCase()}
            </span>
            <h2>{item.name}</h2>
            <span>LOOK GOOD. MOVE BETTER.</span>
          </div>
          <span className="preview-watermark">PA / 01</span>
        </div>
        <div className="locker-inventory">
          <div className="pill-tabs">
            <button
              className={tab === 'skin' ? 'active' : ''}
              onClick={() => {
                setTab('skin');
                setSelected(player?.equipped || 'standard');
              }}
            >
              OUTFITS
            </button>
            <button
              className={tab === 'trail' ? 'active' : ''}
              onClick={() => {
                setTab('trail');
                setSelected('lime-trail');
              }}
            >
              TRAILS
            </button>
          </div>
          <div className="inventory-grid">
            {ITEMS.filter((i) => i.kind === tab).map((i) => (
              <button
                className={`inventory-item ${selected === i.id ? 'selected' : ''}`}
                key={i.id}
                onClick={() => setSelected(i.id)}
              >
                {i.kind === 'skin' ? (
                  <RunnerArt color={i.color} id={`locker-${i.id}`} />
                ) : (
                  <div className="trail-art" style={{ '--trail': i.color } as React.CSSProperties}>
                    <span />
                    <span />
                    <span />
                  </div>
                )}
                {!(player?.owned.includes(i.id) || i.id === 'standard') && (
                  <LockKeyhole className="item-lock" size={13} />
                )}
                <span>{i.name}</span>
                {(player?.equipped || 'standard') === i.id || player?.trail === i.id ? (
                  <Check className="item-equipped" size={13} />
                ) : null}
              </button>
            ))}
          </div>
          <div className="selected-item">
            <span className="eyebrow">
              {owned ? 'IN YOUR COLLECTION' : 'AVAILABLE IN THE SHOP'}
            </span>
            <h3>{item.name}</h3>
            <p>{item.description}</p>
            <button
              className={`button ${equipped ? 'secondary' : 'primary'} full`}
              disabled={busy || equipped}
              onClick={owned ? equip : onShop}
            >
              {equipped ? (
                <>
                  <Check size={17} />
                  EQUIPPED
                </>
              ) : owned ? (
                'EQUIP COSMETIC'
              ) : (
                <>
                  <ShoppingBag size={16} />
                  VISIT THE SHOP
                </>
              )}
            </button>
            {tab === 'trail' && player?.trail && (
              <button
                className="text-button"
                onClick={async () => {
                  try {
                    const r = await api<PlayerResponse>('/locker/equip', { itemId: null });
                    onPlayer(r.player);
                    notify('Trail removed.');
                  } catch (e) {
                    notify((e as Error).message);
                  }
                }}
              >
                Remove equipped trail
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
export function ShopPage({
  player,
  onPlayer,
  onAuth,
  onCredits,
  notify,
}: {
  player: Player | null;
  onPlayer: (p: Player) => void;
  onAuth: () => void;
  onCredits: () => void;
  notify: (s: string) => void;
}) {
  const [selected, setSelected] = useState<(typeof ITEMS)[number] | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function purchase() {
    if (!player) {
      setSelected(null);
      onAuth();
      return;
    }
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      const r = await api<PlayerResponse>('/shop/purchase', { itemId: selected.id });
      onPlayer(r.player);
      notify(`${selected.name} added to your locker.`);
      setSelected(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page-content page-enter">
      <SectionTitle eyebrow="A NEW LOOK FOR YOUR NEXT LINE." title="STREET SUPPLY">
        <button className="button secondary" onClick={onCredits}>
          <Credits amount={player?.credits || 0} />
          <span>GET CREDITS</span>
          <ArrowUpRight size={17} />
        </button>
      </SectionTitle>
      <div className="shop-banner">
        <div>
          <span className="eyebrow">THE ROOFTOP COLLECTION / 001</span>
          <h2>
            LESS NOISE.
            <br />
            <em>MORE PRESENCE.</em>
          </h2>
          <p>Technical silhouettes. Unmistakable style.</p>
          <span className="shop-banner-tag">
            <Sparkles size={13} />
            100% COSMETIC. ALWAYS.
          </span>
        </div>
        <RunnerArt color="#82c9ff" id="shop-hero" />
        <span className="shop-banner-word">CARBON</span>
      </div>
      <div className="home-section-heading">
        <span>THE COLLECTION</span>
        <span>PERMANENT CATALOGUE · NO FOMO</span>
      </div>
      <div className="shop-grid">
        {ITEMS.filter((i) => i.price).map((i) => (
          <button
            className={`shop-item ${i.rarity.toLowerCase()}`}
            key={i.id}
            onClick={() => {
              setSelected(i);
              setError('');
            }}
            style={{ '--item-color': i.color } as React.CSSProperties}
          >
            <div className="shop-item-art">
              <span className="rarity">{i.rarity}</span>
              {i.kind === 'skin' ? (
                <RunnerArt color={i.color} id={`shop-${i.id}`} />
              ) : (
                <div className="trail-art" style={{ '--trail': i.color } as React.CSSProperties}>
                  <span />
                  <span />
                  <span />
                </div>
              )}
              <span className="shop-item-open">
                <ArrowUpRight size={17} />
              </span>
            </div>
            <div className="shop-item-info">
              <span>{i.kind === 'skin' ? 'RUNNER OUTFIT' : 'MOVEMENT TRAIL'}</span>
              <h3>{i.name}</h3>
              <div>
                {player?.owned.includes(i.id) ? (
                  <span className="owned-tag">
                    <Check size={13} />
                    OWNED
                  </span>
                ) : (
                  <Credits amount={i.price} small />
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
      <div className="tip-box">
        <span>PLAY YOUR WAY</span>Earn credits from validated solo finishes. Purchases only affect
        appearance. All three classes and every course are free.
      </div>
      {selected && (
        <Modal
          title={selected.name.toUpperCase()}
          eyebrow={`${selected.rarity} · ${selected.kind.toUpperCase()}`}
          onClose={() => {
            if (!busy) setSelected(null);
          }}
        >
          <div
            className="purchase-preview"
            style={{ '--item-color': selected.color } as React.CSSProperties}
          >
            {selected.kind === 'skin' ? (
              <RunnerArt color={selected.color} id="purchase" />
            ) : (
              <div
                className="trail-art"
                style={{ '--trail': selected.color } as React.CSSProperties}
              >
                <span />
                <span />
                <span />
              </div>
            )}
          </div>
          <p className="muted">{selected.description}</p>
          <div className="purchase-price">
            <span>ONE-TIME COSMETIC UNLOCK</span>
            <Credits amount={selected.price} />
          </div>
          {error && (
            <div className="error-message" role="alert">
              {error}
            </div>
          )}
          <button
            className="button primary full"
            disabled={busy || player?.owned.includes(selected.id)}
            onClick={purchase}
          >
            {busy ? (
              <LoaderCircle size={18} className="spin" />
            ) : player?.owned.includes(selected.id) ? (
              <>
                <Check size={17} />
                ALREADY IN YOUR LOCKER
              </>
            ) : (
              <>
                <ShoppingBag size={17} />
                {player ? 'UNLOCK COSMETIC' : 'SIGN IN TO UNLOCK'}
                <ArrowRight size={18} />
              </>
            )}
          </button>
          <p className="fine-print">Spend earned or purchased credits. No gameplay advantage.</p>
        </Modal>
      )}
    </div>
  );
}
