import { CajaLayout } from './components/caja/CajaLayout';
import { CocinaWorkspace } from './components/cocina/CocinaWorkspace';
import { MesoneroWorkspace } from './components/mesonero/MesoneroWorkspace';
import { PinLoginScreen } from './components/PinLoginScreen';
import { StatusBanner } from './components/StatusBanner';
import { TicketPreviewModal } from './components/TicketPreviewModal';
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
  return (
    <PosProvider>
      <AppShell />
    </PosProvider>
  );
}

export default App;
