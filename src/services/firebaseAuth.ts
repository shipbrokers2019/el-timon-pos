import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import type { Role } from '../types/pos';
import {
  clearTabStation,
  getFirebaseEnvConfig,
  getStationFirebaseApp,
  initFirestoreClient,
  readActiveStationKey,
  rememberStationKey,
  stationKeyFromEmail,
  type StationKey,
} from './firebaseRepository';

const CACHED_STATION_ROLE_PREFIX = 'eltimon_station_role_';

/** Station slot this page subscribed to on load (switching slots requires one reload). */
let subscribedStationKey: StationKey | null = null;

export interface FirebaseStationSession {
  uid: string;
  email: string | null;
  role: Role;
}

function getCachedRole(uid: string): Role | null {
  if (typeof localStorage === 'undefined') return null;
  const val = localStorage.getItem(`${CACHED_STATION_ROLE_PREFIX}${uid}`);
  if (val === 'mesonero' || val === 'cocina' || val === 'caja_admin') {
    return val;
  }
  return null;
}

function setCachedRole(uid: string, role: Role): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(`${CACHED_STATION_ROLE_PREFIX}${uid}`, role);
}

function inferRoleFromEmail(email: string | null): Role | null {
  const key = stationKeyFromEmail(email);
  if (key === 'cocina') return 'cocina';
  if (key === 'mesonero') return 'mesonero';
  if (key === 'caja') return 'caja_admin';
  return null;
}

function getStationAuth(key: StationKey) {
  const config = getFirebaseEnvConfig();
  if (!config) return null;
  return getAuth(getStationFirebaseApp(config, key));
}

export async function resolveStationRole(
  user: User,
  key: StationKey | null = readActiveStationKey(),
): Promise<Role | null> {
  // 1. Prefer custom claim if set
  try {
    const tokenResult = await user.getIdTokenResult();
    const claimRole = tokenResult.claims.role;
    if (
      claimRole === 'mesonero' ||
      claimRole === 'cocina' ||
      claimRole === 'caja_admin'
    ) {
      setCachedRole(user.uid, claimRole);
      return claimRole;
    }
  } catch {
    // Offline fallback below
  }

  // 2. Read /stationAuth/{uid} document from Firestore (uses persistent cache offline too)
  const config = getFirebaseEnvConfig();
  if (config) {
    try {
      const db = initFirestoreClient(config, key);
      const snap = await getDoc(doc(db, 'stationAuth', user.uid));
      if (snap.exists()) {
        const data = snap.data() as { role?: unknown; active?: unknown };
        if (
          data.active === true &&
          (data.role === 'mesonero' ||
            data.role === 'cocina' ||
            data.role === 'caja_admin')
        ) {
          setCachedRole(user.uid, data.role);
          return data.role;
        }
        return null;
      }
    } catch {
      // Fall back to locally cached role when completely offline
    }
  }

  return getCachedRole(user.uid) ?? inferRoleFromEmail(user.email);
}

export function subscribeStationAuth(
  onChange: (state: {
    loading: boolean;
    session: FirebaseStationSession | null;
    error: string | null;
  }) => void,
): () => void {
  const key = readActiveStationKey();
  subscribedStationKey = key;
  const auth = key ? getStationAuth(key) : null;
  if (!auth) {
    onChange({ loading: false, session: null, error: null });
    return () => {};
  }

  onChange({ loading: true, session: null, error: null });

  return onAuthStateChanged(auth, (user) => {
    if (!user) {
      onChange({ loading: false, session: null, error: null });
      return;
    }

    void resolveStationRole(user, key).then((role) => {
      if (!role) {
        onChange({
          loading: false,
          session: null,
          error:
            'Esta cuenta no tiene un rol de estación activo en Firestore (stationAuth).',
        });
        return;
      }
      onChange({
        loading: false,
        session: { uid: user.uid, email: user.email, role },
        error: null,
      });
    });
  });
}

export async function signInStation(
  email: string,
  password: string,
): Promise<FirebaseStationSession> {
  const key = stationKeyFromEmail(email) ?? readActiveStationKey() ?? 'caja';
  const auth = getStationAuth(key);
  if (!auth) {
    throw new Error('Firebase no está configurado en este entorno.');
  }
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  const role = await resolveStationRole(credential.user, key);
  if (!role) {
    await signOut(auth);
    throw new Error(
      'Esta cuenta no está autorizada como estación activa (verifica stationAuth en Firestore).',
    );
  }
  rememberStationKey(key);
  if (key !== subscribedStationKey && typeof window !== 'undefined') {
    // This tab switched to a different station slot: reload once so App subscribes to it.
    window.location.reload();
  }
  return {
    uid: credential.user.uid,
    email: credential.user.email,
    role,
  };
}

/**
 * Leaves the station in THIS tab only (other tabs on the same station stay signed in)
 * and returns to the station activation screen.
 */
export function switchStationInThisTab(): void {
  clearTabStation();
  if (typeof window !== 'undefined') {
    window.location.reload();
  }
}

/** Fully signs out the station account currently used by this tab. */
export async function signOutStation(): Promise<void> {
  const key = readActiveStationKey();
  const auth = key ? getStationAuth(key) : null;
  if (!auth) return;
  await signOut(auth);
}
