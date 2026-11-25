import { useEffect, useState } from 'react';
import { CajaLayout } from './components/caja/CajaLayout';
import { CocinaWorkspace } from './components/cocina/CocinaWorkspace';
import { FirebaseStationGate } from './components/FirebaseStationGate';
import { MesoneroWorkspace } from './components/mesonero/MesoneroWorkspace';
import { PinLoginScreen } from './components/PinLoginScreen';
import { StatusBanner } from './components/StatusBanner';
import { TicketPreviewModal } from './components/TicketPreviewModal';
import {
  subscribeStationAuth,
  type FirebaseStationSession,
} from './services/firebaseAuth';
import { isFirebaseConfigured } from './services/firebaseRepository';
import { PosProvider, usePos } from './store/PosProvider';

export function AppShell() {
  const { currentUser } = usePos();

  if (!currentUser) {
    return (
      <>
        <PinLoginScreen />
        <TicketPreviewModal />
      </>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <StatusBanner />
      {currentUser.role === 'mesonero' && <MesoneroWorkspace />}
      {currentUser.role === 'cocina' && <CocinaWorkspace />}
      {currentUser.role === 'caja_admin' && <CajaLayout />}
      <TicketPreviewModal />
    </div>
  );
}

export function App() {
  const firebaseEnabled = isFirebaseConfigured();
  const [authState, setAuthState] = useState<{
    loading: boolean;
    session: FirebaseStationSession | null;
    error: string | null;
  }>({
    loading: firebaseEnabled,
    session: null,
    error: null,
  });

  useEffect(() => {
    if (!firebaseEnabled) {
      return;
    }
    return subscribeStationAuth(setAuthState);
  }, [firebaseEnabled]);

  if (firebaseEnabled) {
    if (authState.loading) {
      return (
        <main className="min-h-screen bg-[#FAF8F4] text-[#0F2A36] flex items-center justify-center p-6">
          <p className="text-sm font-bold text-[#0F2A36]/75">
            Conectando estación con El Timón Restaurante...
          </p>
        </main>
      );
    }

    if (!authState.session) {
      return <FirebaseStationGate externalError={authState.error} />;
    }

    return (
      <PosProvider forcedStationRole={authState.session.role}>
        <AppShell />
      </PosProvider>
    );
  }

  return (
    <PosProvider>
      <AppShell />
    </PosProvider>
  );
}

export default App;
