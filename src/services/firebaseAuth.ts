import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import type { Role } from '../types/pos';
import { getFirebaseEnvConfig, initFirestoreClient } from './firebaseRepository';

const CACHED_STATION_ROLE_PREFIX = 'eltimon_station_role_';

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
  if (!email) return null;
  const lower = email.toLowerCase();
  if (lower.startsWith('cocina@')) return 'cocina';
  if (lower.startsWith('mesonero@')) return 'mesonero';
  if (lower.startsWith('caja@') || lower.startsWith('admin@')) return 'caja_admin';
  return null;
}

function getFirebaseAppInstance() {
  const config = getFirebaseEnvConfig();
  if (!config) {
    return null;
  }
  return getApps().length > 0 ? getApp() : initializeApp(config);
}

export async function resolveStationRole(user: User): Promise<Role | null> {
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
      const db = initFirestoreClient(config);
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
  const app = getFirebaseAppInstance();
  if (!app) {
    onChange({ loading: false, session: null, error: null });
    return () => {};
  }

  const auth = getAuth(app);
  onChange({ loading: true, session: null, error: null });

  return onAuthStateChanged(auth, (user) => {
    if (!user) {
      onChange({ loading: false, session: null, error: null });
      return;
    }

    void resolveStationRole(user).then((role) => {
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
  const app = getFirebaseAppInstance();
  if (!app) {
    throw new Error('Firebase no está configurado en este entorno.');
  }
  const auth = getAuth(app);
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  const role = await resolveStationRole(credential.user);
  if (!role) {
    await signOut(auth);
    throw new Error(
      'Esta cuenta no está autorizada como estación activa (verifica stationAuth en Firestore).',
    );
  }
  return {
    uid: credential.user.uid,
    email: credential.user.email,
    role,
  };
}

export async function signOutStation(): Promise<void> {
  const app = getFirebaseAppInstance();
  if (!app) return;
  await signOut(getAuth(app));
}
