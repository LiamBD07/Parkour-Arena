import { useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Check,
  LoaderCircle,
  Mail,
  LockKeyhole,
  UserRound,
  Volume2,
  Crosshair,
  Monitor,
  ShieldCheck,
  ArrowUpRight,
} from 'lucide-react';
import { api, ApiError, type PlayerResponse, type Settings } from '../api';
import { getManagedAuthClient } from '../auth-client';
import type { Player } from '../../shared/game';
import { Modal, Credits } from './Primitives';

export function AuthDialog({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: (player: Player) => void;
}) {
  const [register, setRegister] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [linkLegacy, setLinkLegacy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(e.currentTarget);
    try {
      if (linkLegacy) {
        const { player } = await api<PlayerResponse>('/auth/link-legacy', {
          password: form.get('legacyPassword'),
        });
        onSuccess(player);
        onClose();
        return;
      }
      const client = await getManagedAuthClient();
      if (client) {
        const email = String(form.get('email')).trim();
        const password = String(form.get('password'));
        const result = register
          ? await client.signUp.email({ email, password, name: String(form.get('username')) })
          : await client.signIn.email({ email, password });
        if (result.error)
          throw new Error(result.error.message || 'Neon could not complete sign-in.');
        const session = await client.getSession();
        if (session.error || !session.data?.user)
          throw new Error(
            register
              ? 'Account created. Complete any required email verification, then sign in.'
              : 'A session could not be restored. Please sign in again.',
          );
        const { player } = await api<{ player: Player | null }>('/me');
        if (!player) throw new Error('Your session could not be authorized. Please sign in again.');
        onSuccess(player);
        onClose();
        return;
      }
      const { player } = await api<PlayerResponse>(`/auth/${register ? 'register' : 'login'}`, {
        email: form.get('email'),
        password: form.get('password'),
        ...(register ? { username: form.get('username') } : {}),
      });
      onSuccess(player);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'LINK_LEGACY_ACCOUNT') setLinkLegacy(true);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={register ? 'YOUR NEXT CHAPTER.' : 'WELCOME BACK.'}
      eyebrow="JOIN THE ROOFTOPS"
      onClose={onClose}
    >
      <p className="muted">
        {register
          ? 'A runner name. A new line. A place on the board.'
          : 'Your gear, your ghosts, your next personal best.'}
      </p>
      {!linkLegacy && (
        <div className="segmented">
          <button
            className={register ? 'active' : ''}
            onClick={() => {
              setRegister(true);
              setError('');
            }}
          >
            Create account
          </button>
          <button
            className={!register ? 'active' : ''}
            onClick={() => {
              setRegister(false);
              setError('');
            }}
          >
            Sign in
          </button>
        </div>
      )}
      <form onSubmit={submit} className="auth-form">
        {linkLegacy && (
          <label>
            <span>Previous Parkour Arena password</span>
            <div className="input-wrap">
              <LockKeyhole size={17} />
              <input
                name="legacyPassword"
                type="password"
                required
                maxLength={128}
                autoComplete="current-password"
                placeholder="Link your existing runner and keep your gear"
              />
            </div>
          </label>
        )}
        {!linkLegacy && (
          <>
            {register && (
              <label>
                <span>Runner name</span>
                <div className="input-wrap">
                  <UserRound size={17} />
                  <input
                    name="username"
                    required
                    minLength={3}
                    maxLength={18}
                    pattern="[a-zA-Z0-9_]+"
                    autoComplete="username"
                    placeholder="Your name on the leaderboard"
                  />
                </div>
              </label>
            )}
            <label>
              <span>Email address</span>
              <div className="input-wrap">
                <Mail size={17} />
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                />
              </div>
            </label>
            <label>
              <span>Password</span>
              <div className="input-wrap">
                <LockKeyhole size={17} />
                <input
                  name="password"
                  type="password"
                  required
                  minLength={10}
                  maxLength={128}
                  autoComplete={register ? 'new-password' : 'current-password'}
                  placeholder="At least 10 characters"
                />
              </div>
            </label>
          </>
        )}
        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}
        <button className="button primary full" disabled={busy}>
          {busy ? (
            <LoaderCircle className="spin" size={18} />
          ) : (
            <>
              {linkLegacy ? 'LINK EXISTING RUNNER' : register ? 'CREATE YOUR RUNNER' : 'SIGN IN'}
              <ArrowRight size={18} />
            </>
          )}
        </button>
      </form>
      {register && (
        <div className="signup-reward">
          <Credits amount={500} />
          <span>Starter credits. On the house.</span>
        </div>
      )}
      <p className="fine-print">
        <ShieldCheck size={14} /> Secure sessions · Cosmetics only · No pay-to-win
      </p>
    </Modal>
  );
}
export function ControlsDialog({ onClose }: { onClose: () => void }) {
  const controls = [
    ['W A S D', 'Move · arrow keys also work'],
    ['MOUSE', 'Look · click the course to capture cursor'],
    ['SHIFT', 'Sprint · keep your momentum'],
    ['SPACE', 'Jump · time it near the edge'],
    ['C', 'Slide / crouch · pass under low beams'],
    ['E', 'Wall run · hold near amber grip walls'],
    ['X', 'Dive · tuck into a landing roll'],
    ['F', 'Air flip · finish the rotation for a boost'],
    ['Q', 'Class ability · watch the cooldown'],
    ['P / ESC', 'Pause · timer keeps running'],
  ];
  return (
    <Modal title="FIND YOUR FLOW." eyebrow="THE MOVEMENT MANUAL" onClose={onClose} wide>
      <p className="muted">
        Follow the lime chevrons. Cross every gate. Your fastest line is out there.
      </p>
      <div className="controls-grid">
        {controls.map(([key, desc]) => (
          <div className="control-row" key={key}>
            <kbd>{key}</kbd>
            <span>{desc}</span>
          </div>
        ))}
      </div>
      <div className="tip-box">
        <span>PRO TIP</span>Flip early in your jump. A completed flip boosts your landing; an
        unfinished one costs a little momentum. The hinged orange roof drops shortly after you touch
        it.
      </div>
      <p className="fine-print">
        On touch screens, use the left stick to move, drag the right side to look, and tap the
        action buttons. A keyboard and mouse offer the most control.
      </p>
      <button className="button primary" onClick={onClose}>
        LET’S RUN
        <ArrowRight size={18} />
      </button>
    </Modal>
  );
}
export function SettingsDialog({
  settings,
  onChange,
  onClose,
}: {
  settings: Settings;
  onChange: (settings: Settings) => void;
  onClose: () => void;
}) {
  return (
    <Modal title="YOUR SETUP." eyebrow="ARENA SETTINGS" onClose={onClose}>
      <div className="setting-row">
        <Volume2 />
        <div>
          <strong>Sound effects</strong>
          <p>Checkpoint and finish cues</p>
        </div>
        <button
          role="switch"
          aria-checked={settings.sound}
          aria-label="Sound effects"
          className={`toggle ${settings.sound ? 'on' : ''}`}
          onClick={() => onChange({ ...settings, sound: !settings.sound })}
        >
          <span />
        </button>
      </div>
      <div className="setting-row">
        <Crosshair />
        <div>
          <strong>Look sensitivity</strong>
          <p>{settings.sensitivity.toFixed(1)}×</p>
        </div>
        <input
          aria-label="Look sensitivity"
          type="range"
          min="0.3"
          max="2"
          step="0.1"
          value={settings.sensitivity}
          onChange={(e) => onChange({ ...settings, sensitivity: Number(e.target.value) })}
        />
      </div>
      <div className="setting-row">
        <Monitor />
        <div>
          <strong>Graphics quality</strong>
          <p>Applies to the next scene</p>
        </div>
        <select
          aria-label="Graphics quality"
          value={settings.quality}
          onChange={(e) =>
            onChange({ ...settings, quality: e.target.value as Settings['quality'] })
          }
        >
          <option value="high">High</option>
          <option value="low">Performance</option>
        </select>
      </div>
      <button className="button primary full" onClick={onClose}>
        ALL SET
        <Check size={18} />
      </button>
    </Modal>
  );
}
export function CurrencyDialog({
  enabled,
  onClose,
  signedIn,
  onAuth,
}: {
  enabled: boolean;
  onClose: () => void;
  signedIn: boolean;
  onAuth: () => void;
}) {
  const [busy, setBusy] = useState(''),
    [error, setError] = useState('');
  async function checkout(pack: string) {
    if (!signedIn) {
      onClose();
      onAuth();
      return;
    }
    setBusy(pack);
    setError('');
    try {
      const { url } = await api<{ url: string }>('/payments/checkout', { pack });
      location.assign(url);
    } catch (e) {
      setError((e as Error).message);
      setBusy('');
    }
  }
  return (
    <Modal title="FUEL YOUR STYLE." eyebrow="ARENA CREDITS" onClose={onClose} wide>
      <p className="muted">New looks. Same level playing field. Every item is cosmetic.</p>
      <div className="credit-packs">
        {[
          ['1000', 'ESSENTIAL', ''],
          ['2800', 'RUNNER’S PICK', 'MOST POPULAR'],
          ['6500', 'THE COLLECTION', ''],
        ].map(([pack, name, tag]) => (
          <button
            key={pack}
            className={`credit-pack ${tag ? 'featured' : ''}`}
            disabled={!enabled || !!busy}
            onClick={() => checkout(pack)}
          >
            {tag && <span className="pack-tag">{tag}</span>}
            <span className="eyebrow">{name}</span>
            <Credits amount={Number(pack)} />
            <span>
              {busy === pack ? (
                'Opening checkout…'
              ) : enabled ? (
                <>
                  View price & checkout
                  <ArrowUpRight size={15} />
                </>
              ) : (
                'Purchases not enabled'
              )}
            </span>
          </button>
        ))}
      </div>
      {!enabled && (
        <div className="tip-box">
          <span>EARN IT IN THE ARENA</span>Real-money purchases are not enabled on this server.
          Create an account for 500 starter credits, then earn 100 credits for each of your first 20
          validated solo finishes per day.
        </div>
      )}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      <p className="fine-print">
        <ShieldCheck size={14} /> When enabled, payment is handled by Stripe. Credits arrive after
        payment confirmation.
      </p>
    </Modal>
  );
}
