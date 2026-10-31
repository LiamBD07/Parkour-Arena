import { useCallback, useEffect, useRef, useState } from 'react';
import { getManagedAccessToken } from './auth-client';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleHelp,
  Compass,
  Flag,
  Ghost,
  LayoutGrid,
  LoaderCircle,
  LogOut,
  Map,
  Plus,
  Settings as SettingsIcon,
  ShoppingBag,
  Trophy,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import {
  COURSES,
  CLASSES,
  ITEMS,
  botDuration,
  type ClassId,
  type Course,
  type GhostFrame,
  type LeaderboardEntry,
  type Player,
} from '../shared/game';
import { botReplay } from '../shared/replay';
import { api, readLocal, writeLocal, loadSettings, type Settings } from './api';
import { Logo, Credits, Modal } from './components/Primitives';
import { AuthDialog, ControlsDialog, CurrencyDialog, SettingsDialog } from './components/Dialogs';
import {
  PlayPage,
  MapsPage,
  ClassDialog,
  LeaderboardPage,
  LockerPage,
  ShopPage,
  type LocalRecord,
} from './components/Pages';
import { Race, type RaceConfig } from './components/Race';
import type { ArenaEngine, Rival } from './game/engine';
import { ArenaNetwork, type Match } from './game/network';

type Page = 'play' | 'maps' | 'leaderboard' | 'locker' | 'shop';
const navigation = [
  { id: 'play', label: 'PLAY', icon: Compass },
  { id: 'maps', label: 'COURSES', icon: Map },
  { id: 'leaderboard', label: 'RANKINGS', icon: Trophy },
  { id: 'locker', label: 'LOCKER', icon: UserRound },
  { id: 'shop', label: 'SHOP', icon: ShoppingBag },
] as const;
function initialPage(): Page {
  const h = location.hash.slice(1);
  return navigation.some((n) => n.id === h) ? (h as Page) : 'play';
}
export default function App() {
  const [page, setPage] = useState<Page>(initialPage),
    [player, setPlayer] = useState<Player | null>(null),
    [online, setOnline] = useState(false),
    [booting, setBooting] = useState(true);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [course, setCourse] = useState<Course>(
    () => COURSES.find((c) => c.id === readLocal('pa-course', 'skyline')) || COURSES[0],
  );
  const [classId, setClassId] = useState<ClassId>(() => {
    const saved = readLocal<ClassId>('pa-class', 'runner');
    return CLASSES.some((c) => c.id === saved) ? saved : 'runner';
  });
  const [dialog, setDialog] = useState<
      'auth' | 'controls' | 'settings' | 'credits' | 'class' | null
    >(null),
    [profile, setProfile] = useState(false),
    [toast, setToast] = useState('');
  const [mode, setMode] = useState<'solo' | 'online'>('solo'),
    [busy, setBusy] = useState(false),
    [race, setRace] = useState<RaceConfig | null>(null),
    [queue, setQueue] = useState<{ waiting: number; wait: number } | null>(null);
  const [config, setConfig] = useState({ payments: false, stun: 'stun:stun.l.google.com:19302' });
  const [recordVersion, setRecordVersion] = useState(0);
  const engineRef = useRef<ArenaEngine | null>(null),
    networkRef = useRef<ArenaNetwork | null>(null),
    raceRef = useRef<RaceConfig | null>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useCallback((s: string) => {
    setToast(s);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 6000);
  }, []);
  const closeDialog = useCallback(() => setDialog(null), []);
  const onGraphicsError = useCallback(
    () => notify('3D preview unavailable. The game requires WebGL 2 and hardware acceleration.'),
    [notify],
  );
  const navigate = (p: Page) => {
    setPage(p);
    location.hash = p;
    setProfile(false);
    window.scrollTo(0, 0);
  };
  useEffect(() => {
    const listener = () => setPage(initialPage());
    window.addEventListener('hashchange', listener);
    return () => window.removeEventListener('hashchange', listener);
  }, []);
  useEffect(() => {
    let live = true;
    Promise.all([api<{ player: Player | null }>('/me'), api<typeof config>('/config')])
      .then(([me, cfg]) => {
        if (live) {
          setPlayer(me.player);
          setConfig(cfg);
          setOnline(true);
        }
      })
      .catch(() => {
        if (live) setOnline(false);
      })
      .finally(() => {
        if (live) setBooting(false);
      });
    const params = new URLSearchParams(location.search);
    if (params.get('checkout') === 'success') {
      notify('Checkout complete. Credits arrive after Stripe confirms your payment.');
      setPage('shop');
    }
    if (params.get('checkout') === 'cancelled')
      notify('Checkout cancelled. No credits were purchased.');
    if (params.has('checkout')) {
      params.delete('checkout');
      history.replaceState(
        null,
        '',
        `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`,
      );
    }
    return () => {
      live = false;
      networkRef.current?.close();
      clearTimeout(toastTimer.current);
    };
  }, [notify]);
  // Stripe fulfillment is asynchronous. Refresh the balance after returning from checkout.
  useEffect(() => {
    if (!player || page !== 'shop') return;
    const interval = setInterval(() => {
      api<{ player: Player }>('/me')
        .then((r) => {
          if (r.player) setPlayer(r.player);
        })
        .catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, [player?.id, page]);
  const selectCourse = (c: Course) => {
    setCourse(c);
    writeLocal('pa-course', c.id);
  };
  const selectClass = (id: ClassId) => {
    setClassId(id);
    writeLocal('pa-class', id);
  };
  const changeSettings = (s: Settings) => {
    setSettings(s);
    writeLocal('pa-settings', s);
  };
  const record = readLocal<LocalRecord | null>(`pa-record-${course.id}`, null);
  const startSolo = async (rivals?: Rival[]) => {
    if (busy) return;
    setBusy(true);
    networkRef.current?.close();
    networkRef.current = null;
    let ticket: string | null = null;
    if (player) {
      try {
        ticket = (await api<{ ticket: string }>('/runs/start', { mapId: course.id, classId }))
          .ticket;
      } catch (e) {
        notify(`${(e as Error).message} Starting unranked practice.`);
      }
    }
    const ghost =
      rivals ||
      (record?.frames?.length
        ? [
            {
              id: 'personal-ghost',
              name: 'YOUR PERSONAL BEST',
              color: '#9bddf5',
              frames: record.frames,
            },
          ]
        : []);
    const next: RaceConfig = {
      id: crypto.randomUUID(),
      course,
      classId,
      rivals: ghost,
      ticket,
      multiplayer: false,
    };
    raceRef.current = next;
    setRace(next);
    setBusy(false);
    setDialog(null);
    setProfile(false);
  };
  const startOnline = async () => {
    if (!online) {
      notify('The arena server is offline. You can still practice solo.');
      return;
    }
    let accessToken: string | null;
    try {
      accessToken = await getManagedAccessToken();
    } catch (e) {
      notify((e as Error).message);
      return;
    }
    networkRef.current?.close();
    setQueue({ waiting: 1, wait: 12 });
    const net = new ArenaNetwork(
      course.id,
      classId,
      config.stun,
      {
        onQueue: (waiting, wait) => setQueue({ waiting, wait }),
        onMatch: (match: Match) => {
          const map = COURSES.find((c) => c.id === match.map)!;
          const rivals: Rival[] = match.members
            .filter((m) => m.id !== net.id)
            .map((m, i) => ({
              id: m.id,
              name: `${m.name}${m.bot ? ' · BOT' : ''}`,
              color: ITEMS.find((s) => s.id === m.skin)?.color || '#70c9df',
              live: !m.bot,
              frames: m.bot ? botReplay(map, botDuration(m.mmr, i), i) : undefined,
            }));
          const next: RaceConfig = {
            id: match.room,
            course: map,
            classId,
            rivals,
            ticket: null,
            multiplayer: true,
            startsAt: match.startsAt,
          };
          raceRef.current = next;
          setRace(next);
          setQueue(null);
          setDialog(null);
        },
        onState: (state) => engineRef.current?.updatePeer(state),
        onDisconnect: (id) => {
          engineRef.current?.replaceWithBot(id, botDuration(player?.mmr || 1000));
          notify('A runner disconnected. A bot is taking their line.');
        },
        onError: (message) => {
          notify(message);
          if (raceRef.current?.multiplayer) {
            for (const rival of raceRef.current.rivals)
              if (rival.live)
                engineRef.current?.replaceWithBot(rival.id, botDuration(player?.mmr || 1000));
          } else {
            setQueue(null);
            networkRef.current?.close();
            networkRef.current = null;
          }
        },
      },
      accessToken || undefined,
    );
    networkRef.current = net;
  };
  const start = () => (mode === 'solo' ? void startSolo() : startOnline());
  const exitRace = () => {
    networkRef.current?.close();
    networkRef.current = null;
    raceRef.current = null;
    setRace(null);
    setRecordVersion((v) => v + 1);
  };
  const retryRace = () => {
    const multiplayer = race?.multiplayer;
    exitRace();
    if (multiplayer) startOnline();
    else void startSolo(race?.rivals);
  };
  const raceGhost = async (entry: LeaderboardEntry) => {
    setBusy(true);
    try {
      const ghost = await api<{ replay: GhostFrame[]; username: string }>(`/ghosts/${entry.id}`);
      setBusy(false);
      await startSolo([
        { id: entry.id, name: ghost.username, color: '#a2dbe9', frames: ghost.replay },
      ]);
    } catch (e) {
      notify((e as Error).message);
      setBusy(false);
    }
  };
  const guide = () =>
    startSolo([
      {
        id: 'guide',
        name: 'GUIDE GHOST · BOT',
        color: '#98d6e9',
        frames: botReplay(course, 38000),
      },
    ]);
  const skin = ITEMS.find((i) => i.id === player?.equipped) || ITEMS[0];
  const trail = ITEMS.find((i) => i.id === player?.trail);
  return (
    <>
      {!race && (
        <div className="app-shell">
          <header className="topbar">
            <button
              className="brand-button"
              aria-label="Parkour Arena home"
              onClick={() => navigate('play')}
            >
              <Logo />
            </button>
            <div className="topbar-middle">
              <span className="topbar-divider" />
              <span>
                BREAK YOUR LIMITS<span className="lime">/</span>FIND YOUR FLOW
              </span>
            </div>
            <div className="topbar-right">
              <button
                className="icon-button mobile-settings"
                aria-label="Open settings"
                onClick={() => setDialog('settings')}
              >
                <SettingsIcon size={18} />
              </button>
              <button
                className="balance-button"
                onClick={() => setDialog('credits')}
                aria-label="View credits and credit packs"
              >
                <Credits amount={player?.credits || 0} />
                <span className="balance-plus">
                  <Plus size={13} />
                </span>
              </button>
              <span className="topbar-divider" />
              {booting ? (
                <LoaderCircle size={19} className="spin" />
              ) : player ? (
                <div className="profile-area">
                  <button
                    className="profile-button"
                    onClick={() => setProfile((v) => !v)}
                    aria-expanded={profile}
                  >
                    <span className="avatar">
                      <UserRound size={20} />
                    </span>
                    <span>
                      <strong>{player.username}</strong>
                      <small>ROOFTOP RUNNER</small>
                    </span>
                    <ChevronDown size={14} />
                  </button>
                  {profile && (
                    <div className="profile-menu">
                      <span className="eyebrow">YOUR RUNNER</span>
                      <strong>{player.username}</strong>
                      <p>
                        {player.runs} saved runs · {player.mmr}{' '}
                        {player.runs ? 'estimated skill' : 'provisional skill'}
                      </p>
                      <button onClick={() => navigate('locker')}>
                        <UserRound size={16} />
                        Open locker
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            await api('/auth/logout', {});
                            setPlayer(null);
                            setProfile(false);
                            notify('Signed out. See you on the rooftops.');
                          } catch (e) {
                            notify((e as Error).message);
                          }
                        }}
                      >
                        <LogOut size={16} />
                        Sign out
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <button className="sign-in-button" onClick={() => setDialog('auth')}>
                  <span className="avatar">
                    <UserRound size={19} />
                  </span>
                  <span>JOIN THE ARENA</span>
                  <ArrowUpRight size={15} />
                </button>
              )}
            </div>
          </header>
          <aside className="sidebar">
            <div className="sidebar-nav">
              {navigation.map((n) => (
                <button
                  key={n.id}
                  className={`nav-button ${page === n.id ? 'active' : ''}`}
                  onClick={() => navigate(n.id)}
                  aria-current={page === n.id ? 'page' : undefined}
                >
                  <n.icon size={22} strokeWidth={1.6} />
                  <span>{n.label}</span>
                  {page === n.id && <i />}
                </button>
              ))}
            </div>
            <div className="sidebar-bottom">
              <button className="nav-button" onClick={() => setDialog('controls')}>
                <CircleHelp size={21} strokeWidth={1.6} />
                <span>HOW TO</span>
              </button>
              <button className="nav-button" onClick={() => setDialog('settings')}>
                <SettingsIcon size={21} strokeWidth={1.6} />
                <span>SETTINGS</span>
              </button>
            </div>
          </aside>
          <div className="content-shell">
            <div className="page-topline">
              <div className="breadcrumb">
                <span>THE ARENA</span>
                <ChevronDown size={12} className="breadcrumb-chevron" />
                <strong>{navigation.find((n) => n.id === page)?.label}</strong>
              </div>
              <button className="help-shortcut" onClick={() => setDialog('controls')}>
                <span>NEW TO THE ROOFTOPS?</span>
                <span>
                  LEARN THE MOVES
                  <ArrowUpRight size={13} />
                </span>
              </button>
            </div>
            <main>
              {!online && !booting && (
                <div className="offline-banner">
                  Server unavailable. Solo practice works; accounts and online features need a
                  connection.
                </div>
              )}
              {page === 'play' && (
                <PlayPage
                  course={course}
                  classId={classId}
                  player={player}
                  settings={settings}
                  mode={mode}
                  onMode={setMode}
                  onPlay={start}
                  onMaps={() => navigate('maps')}
                  onClass={() => setDialog('class')}
                  onBoard={() => navigate('leaderboard')}
                  record={record}
                  busy={busy}
                  onGraphicsError={onGraphicsError}
                />
              )}
              {page === 'maps' && (
                <MapsPage
                  course={course}
                  onSelect={selectCourse}
                  onPlay={() => void startSolo()}
                  busy={busy}
                />
              )}
              {page === 'leaderboard' && (
                <LeaderboardPage
                  course={course}
                  onCourse={selectCourse}
                  onRace={raceGhost}
                  onGuide={() => void guide()}
                  record={record}
                />
              )}
              {page === 'locker' && (
                <LockerPage
                  player={player}
                  settings={settings}
                  onAuth={() => setDialog('auth')}
                  onPlayer={setPlayer}
                  onShop={() => navigate('shop')}
                  notify={notify}
                />
              )}
              {page === 'shop' && (
                <ShopPage
                  player={player}
                  onPlayer={setPlayer}
                  onAuth={() => setDialog('auth')}
                  onCredits={() => setDialog('credits')}
                  notify={notify}
                />
              )}
            </main>
            <footer className="footer">
              <div>
                <span className={`live-dot ${online ? '' : 'offline'}`} />
                {booting
                  ? 'CONNECTING TO ARENA'
                  : online
                    ? 'ARENA SYSTEMS ONLINE'
                    : 'OFFLINE PRACTICE'}
                <span className="footer-separator" />
                EARLY ACCESS <span className="version">V 0.1.0</span>
              </div>
              <span>
                STAY RESTLESS. KEEP MOVING.
                <Logo compact />
              </span>
            </footer>
          </div>
        </div>
      )}
      {race && (
        <Race
          key={race.id}
          config={race}
          settings={settings}
          onSettings={changeSettings}
          player={player}
          color={skin.color}
          trailColor={trail?.color}
          onPlayer={setPlayer}
          onExit={exitRace}
          onRetry={retryRace}
          onAuth={() => setDialog('auth')}
          engineRef={engineRef}
          network={networkRef.current}
          onError={onGraphicsError}
        />
      )}
      {dialog === 'auth' && (
        <AuthDialog
          onClose={closeDialog}
          onSuccess={(p) => {
            setPlayer(p);
            setOnline(true);
            notify(`Welcome to the rooftops, ${p.username}.`);
          }}
        />
      )}
      {dialog === 'controls' && <ControlsDialog settings={settings} onClose={closeDialog} />}
      {dialog === 'settings' && (
        <SettingsDialog settings={settings} onChange={changeSettings} onClose={closeDialog} />
      )}
      {dialog === 'credits' && (
        <CurrencyDialog
          enabled={config.payments}
          signedIn={!!player}
          onClose={closeDialog}
          onAuth={() => setDialog('auth')}
        />
      )}
      {dialog === 'class' && (
        <ClassDialog
          abilityKey={settings.bindings.ability}
          selected={classId}
          onSelect={selectClass}
          onClose={closeDialog}
        />
      )}
      {queue && (
        <Modal
          title="FINDING YOUR PEOPLE."
          eyebrow="OPEN RACE · MATCHMAKING"
          onClose={() => {
            networkRef.current?.close();
            networkRef.current = null;
            setQueue(null);
          }}
        >
          <div className="queue-visual">
            <div className="queue-ring" />
            <Users size={37} />
          </div>
          <div className="queue-slots">
            {[0, 1, 2, 3].map((i) => (
              <span className={i < queue.waiting ? 'filled' : ''} key={i}>
                {i < queue.waiting ? <UserRound size={22} /> : <Plus size={19} />}
              </span>
            ))}
          </div>
          <h3 className="queue-count">{queue.waiting} / 4 RUNNERS</h3>
          <p className="muted">
            Matching by region preference and solo skill rating. Bots fill open slots in{' '}
            <strong>{queue.wait}s</strong>. Disconnected runners are replaced by bots.
          </p>
          <div className="tip-box">
            <span>QUICK & CASUAL</span>Direct peer connections when available; server relay when
            needed. Open races don’t affect the solo leaderboard.
          </div>
          <button
            className="button secondary full"
            onClick={() => {
              networkRef.current?.close();
              networkRef.current = null;
              setQueue(null);
            }}
          >
            CANCEL SEARCH
          </button>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <span className="toast-mark" />
          <span>{toast}</span>
          <button onClick={() => setToast('')} aria-label="Dismiss notification">
            <X size={16} />
          </button>
        </div>
      )}
    </>
  );
}
