import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { CocinaWorkspace } from '../../src/components/cocina/CocinaWorkspace';
import { MesoneroWorkspace } from '../../src/components/mesonero/MesoneroWorkspace';
import { PinLoginScreen } from '../../src/components/PinLoginScreen';
import { StatusBanner } from '../../src/components/StatusBanner';
import { TicketPreviewModal } from '../../src/components/TicketPreviewModal';
import { LocalPosRepository, POS_STORAGE_KEY } from '../../src/services/posRepository';
import { PosProvider, usePos } from '../../src/store/PosProvider';

function PosTestShell() {
  const { currentUser } = usePos();

  if (!currentUser) {
    return <PinLoginScreen />;
  }

  return (
    <div>
      <StatusBanner />
      {currentUser.role === 'mesonero' && <MesoneroWorkspace />}
      {currentUser.role === 'cocina' && <CocinaWorkspace />}
      {currentUser.role === 'caja_admin' && <div>Caja Admin Stub</div>}
      <TicketPreviewModal />
    </div>
  );
}

function renderWithRepo(repo = new LocalPosRepository()) {
  return {
    repo,
    ...render(
      <PosProvider repository={repo}>
        <PosTestShell />
      </PosProvider>,
    ),
  };
}

async function enterPin(user: ReturnType<typeof userEvent.setup>, pin: string) {
  for (const digit of pin) {
    await user.click(screen.getByRole('button', { name: digit }));
  }
}

describe('Role Isolation & Core Tablet Flows (Mesonero & Cocina)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('1. PIN 1111 (Mesonero) shows 10 Mesas & 18 Toldos and strictly hides Caja, Inventario, Estadísticas, Configuración, exchange rate, and numeric ingredient stock', async () => {
    const user = userEvent.setup();
    renderWithRepo();

    await enterPin(user, '1111');

    expect(await screen.findByRole('tab', { name: /Mesas \(10\)/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Toldos Playa \(18\)/i })).toBeInTheDocument();

    for (let i = 1; i <= 10; i += 1) {
      expect(screen.getByText(`Mesa ${i}`)).toBeInTheDocument();
    }

    await user.click(screen.getByRole('tab', { name: /Toldos Playa \(18\)/i }));
    for (let i = 1; i <= 18; i += 1) {
      expect(screen.getByText(`Toldo ${i}`)).toBeInTheDocument();
    }

    const bodyText = document.body.textContent ?? '';
    expect(bodyText).not.toMatch(/Cierre de Caja/i);
    expect(bodyText).not.toMatch(/Inventario/i);
    expect(bodyText).not.toMatch(/Estadísticas/i);
    expect(bodyText).not.toMatch(/Configuración/i);
    expect(bodyText).not.toMatch(/52\.5/);
    expect(bodyText).not.toMatch(/Carne molida/i);
    expect(bodyText).not.toMatch(/Pescado pargo/i);
  });

  it('2. Mesonero can open Toldo 14, add Hamburguesa Playera with note "Sin cebolla", send comanda, see Toldo 14 Ocupada, and Agotado items are disabled', async () => {
    const user = userEvent.setup();
    const repo = new LocalPosRepository();
    await repo.toggleMenuOutOfStock('menu-pescado-frito', true);

    renderWithRepo(repo);

    await enterPin(user, '1111');

    await user.click(await screen.findByRole('tab', { name: /Toldos Playa \(18\)/i }));
    await user.click(screen.getByRole('button', { name: /Toldo 14/i }));

    const pescadoBtn = await screen.findByRole('button', { name: /Pescado Frito Completo/i });
    expect(pescadoBtn).toBeDisabled();
    expect(within(pescadoBtn).getByText(/Agotado/i)).toBeInTheDocument();
    expect(within(pescadoBtn).getByText('$14.00')).toBeInTheDocument();

    const hamburguesaBtn = screen.getByRole('button', { name: /Hamburguesa Playera/i });
    expect(within(hamburguesaBtn).getByText('$8.50')).toBeInTheDocument();
    await user.click(hamburguesaBtn);

    const noteInput = screen.getByLabelText(/Nota para Hamburguesa Playera/i);
    await user.type(noteInput, 'Sin cebolla');

    await user.click(screen.getByRole('button', { name: /Enviar Comanda/i }));

    await waitFor(() => {
      const toldo14Tile = screen.getByRole('button', { name: /Toldo 14/i });
      expect(within(toldo14Tile).getByText(/Ocupada/i)).toBeInTheDocument();
    });

    const bodyText = document.body.textContent ?? '';
    expect(bodyText).not.toMatch(/4\.8\s*kg/i);
    expect(bodyText).not.toMatch(/Carne molida/i);
  });

  it('3. PIN 2222 (Cocina) shows ONLY Toldo 14 comanda with "Sin cebolla" (no prices, no floor grid, no Caja/Inventario), advances En preparación -> Listo, and Reimprimir 80mm opens preview', async () => {
    const user = userEvent.setup();
    const repo = new LocalPosRepository();

    await repo.submitComanda({
      locationId: 'toldo-14',
      waiterId: 'user-carlos',
      waiterName: 'Carlos (Mesonero)',
      items: [{ menuItemId: 'menu-hamburguesa-playera', quantity: 1, notes: 'Sin cebolla' }],
    });

    renderWithRepo(repo);

    await enterPin(user, '2222');

    // Auto-print triggers TicketPreviewModal on Cocina login; dismiss it first
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cerrar' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    expect(screen.getByText(/TOLDO 14/i)).toBeInTheDocument();
    expect(screen.getByText(/Hamburguesa Playera/i)).toBeInTheDocument();
    expect(screen.getByText(/Sin cebolla/i)).toBeInTheDocument();

    const bodyText = document.body.textContent ?? '';
    expect(bodyText).not.toContain('$8.50');
    expect(bodyText).not.toMatch(/Mesas \(10\)/i);
    expect(bodyText).not.toMatch(/Toldos Playa \(18\)/i);
    expect(bodyText).not.toMatch(/Cierre de Caja/i);
    expect(bodyText).not.toMatch(/Inventario/i);

    await user.click(screen.getByRole('button', { name: /Reimprimir 80mm/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Imprimir navegador \(80mm\)/i })).toBeInTheDocument();
    expect(document.getElementById('thermal-ticket-print-area')?.textContent).toContain('TOLDO 14');
    await user.click(screen.getByRole('button', { name: 'Cerrar' }));

    await user.click(screen.getByRole('button', { name: /En preparación/i }));
    await user.click(await screen.findByRole('button', { name: /Marcar Listo/i }));

    await user.click(screen.getByRole('button', { name: /Historial \(30 min\)/i }));
    expect(await screen.findByText(/TOLDO 14/i)).toBeInTheDocument();
  });

  it('4. A round with only non-kitchen items (Cerveza Polar Pilsen) does NOT appear in Cocina queue', async () => {
    const user = userEvent.setup();
    const repo = new LocalPosRepository();

    await repo.submitComanda({
      locationId: 'mesa-3',
      waiterId: 'user-carlos',
      waiterName: 'Carlos (Mesonero)',
      items: [{ menuItemId: 'menu-cerveza-polar', quantity: 3, notes: 'Bien frías' }],
    });

    expect(localStorage.getItem(POS_STORAGE_KEY)).toBeTruthy();

    renderWithRepo(repo);

    await enterPin(user, '2222');

    expect(await screen.findByText(/No hay comandas pendientes en cocina/i)).toBeInTheDocument();
    expect(screen.queryByText(/Cerveza Polar Pilsen/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/MESA 3/i)).not.toBeInTheDocument();
  });

  it('5. Invalid PIN shows error and station lock restricts login to locked role', async () => {
    const user = userEvent.setup();
    renderWithRepo();

    await enterPin(user, '9999');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'PIN inválido o usuario inactivo',
    );

    // Lock tablet to Cocina
    await user.click(screen.getByRole('button', { name: /Fijar esta tablet como estación/i }));
    await user.click(screen.getByRole('button', { name: 'Cocina' }));

    // Mesonero PIN 1111 is rejected when locked to Cocina
    await enterPin(user, '1111');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'PIN inválido o usuario inactivo',
    );

    // Cocina PIN 2222 succeeds
    await enterPin(user, '2222');
    expect(await screen.findByText(/Pantalla de Cocina \(KDS\)/i)).toBeInTheDocument();
  });

  it('6. Offline simulation in Mesonero flags Pendiente Wi-Fi and Pedir cuenta transitions to Por cobrar', async () => {
    const user = userEvent.setup();
    renderWithRepo();

    await enterPin(user, '1111');

    await user.click(await screen.findByRole('button', { name: /Simular corte Wi-Fi/i }));
    expect(screen.getByText(/Sin Wi-Fi — Modo Offline/i)).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Toldos Playa \(18\)/i }));
    await user.click(screen.getByRole('button', { name: /Toldo 2/i }));

    expect(
      screen.getByText(/Sin Wi-Fi: el pedido se guardará en esta tablet y se enviará al recuperar señal/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Hamburguesa Playera/i }));
    await user.click(screen.getByRole('button', { name: /Enviar Comanda/i }));

    await waitFor(() => {
      const toldo2Tile = screen.getByRole('button', { name: /Toldo 2/i });
      expect(within(toldo2Tile).getByText(/Pendiente Wi-Fi/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Pedir cuenta/i }));

    await waitFor(() => {
      const toldo2Tile = screen.getByRole('button', { name: /Toldo 2/i });
      expect(within(toldo2Tile).getByText(/Por cobrar/i)).toBeInTheDocument();
    });
  });

  it('7. Cocina displays ANULACIÓN — NO PREPARAR alert card when an item is voided and lets kitchen confirm it', async () => {
    const user = userEvent.setup();
    const repo = new LocalPosRepository();

    const { order } = await repo.submitComanda({
      locationId: 'mesa-4',
      waiterId: 'user-carlos',
      waiterName: 'Carlos (Mesonero)',
      items: [{ menuItemId: 'menu-ceviche-mixto', quantity: 1, notes: '' }],
    });
    await repo.voidOrderItem(order.id, order.items[0].id, 'merma', 'Cliente canceló', {
      id: 'user-admin',
      name: 'Administrador / Caja',
    });

    renderWithRepo(repo);

    await enterPin(user, '2222');

    // Dismiss auto-print dialog
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cerrar' }));

    expect(screen.getByText(/ANULACIÓN — NO PREPARAR/i)).toBeInTheDocument();
    expect(screen.getByText(/Cliente canceló/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Confirmar anulación/i }));
    await waitFor(() => {
      expect(screen.queryByText(/ANULACIÓN — NO PREPARAR/i)).not.toBeInTheDocument();
    });
  });

  it('8. Pre-factura generated by Caja is delivered to Mesonero to show to the customer without exposing Caja or Inventario', async () => {
    const user = userEvent.setup();
    const repo = new LocalPosRepository();

    const { order } = await repo.submitComanda({
      locationId: 'toldo-14',
      waiterId: 'user-carlos',
      waiterName: 'Carlos (Mesonero)',
      items: [
        { menuItemId: 'menu-hamburguesa-playera', quantity: 2, notes: 'Sin cebolla' },
        { menuItemId: 'menu-cerveza-polar', quantity: 2, notes: 'Bien frías' },
      ],
    });
    // Caja/Admin generates the pre-factura for Toldo 14
    await repo.createPreCuentaPrintJob(order.id);

    renderWithRepo(repo);
    await enterPin(user, '1111');

    await user.click(await screen.findByRole('tab', { name: /Toldos Playa \(18\)/i }));

    const toldo14Tile = screen.getByRole('button', { name: /Toldo 14/i });
    expect(within(toldo14Tile).getByText(/Pre-factura lista/i)).toBeInTheDocument();

    await user.click(toldo14Tile);

    const showBtn = await screen.findByRole('button', { name: /Mostrar al cliente/i });
    await user.click(showBtn);

    const dialog = await screen.findByRole('dialog', { name: /Pre-factura/i });
    expect(within(dialog).getByText(/Toldo 14/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/Hamburguesa Playera/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/Cerveza Polar Pilsen/i)).toBeInTheDocument();
    // 2 * $8.50 + 2 * $2.50 = Subtotal $22.00 + IVA 16% ($3.52) = Total $25.52 / Bs 1339.80
    expect(within(dialog).getByText('$22.00')).toBeInTheDocument();
    expect(within(dialog).getByText(/IVA \(16%\)/i)).toBeInTheDocument();
    expect(within(dialog).getByText('$3.52')).toBeInTheDocument();
    expect(within(dialog).getByText('$25.52')).toBeInTheDocument();
    expect(within(dialog).getByText(/Bs\s*1339\.80/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/Documento informativo no fiscal/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /Pre-factura/i })).not.toBeInTheDocument();
    });

    const bodyText = document.body.textContent ?? '';
    expect(bodyText).not.toMatch(/Cierre de Caja/i);
    expect(bodyText).not.toMatch(/Inventario/i);
    expect(bodyText).not.toMatch(/Estadísticas/i);
  });

  it('9. Changing forcedStationRole immediately signs out a mismatched PIN user so a tab can never render Cocina under another station role', async () => {
    const user = userEvent.setup();
    const repo = new LocalPosRepository();

    const { rerender } = render(
      <PosProvider repository={repo} forcedStationRole="cocina">
        <PosTestShell />
      </PosProvider>,
    );

    // Log in with Cocina PIN 2222 while station is locked to Cocina
    await enterPin(user, '2222');
    expect(await screen.findByText(/Pantalla de Cocina \(KDS\)/i)).toBeInTheDocument();

    // Simulate Firebase station role switching to mesonero (e.g., cross-tab auth change)
    rerender(
      <PosProvider repository={repo} forcedStationRole="mesonero">
        <PosTestShell />
      </PosProvider>,
    );

    // CocinaWorkspace MUST immediately disappear and return to PIN login locked to Mesonero
    await waitFor(() => {
      expect(screen.queryByText(/Pantalla de Cocina \(KDS\)/i)).not.toBeInTheDocument();
    });
    expect(screen.getByText(/Ingresa tu PIN de 4 dígitos/i)).toBeInTheDocument();
  });

  it('10. When Cocina marks a comanda lista, Mesonero immediately sees the top ¡Orden lista en cocina! notification banner and can confirm delivery', async () => {
    const user = userEvent.setup();
    const repo = new LocalPosRepository();

    const { comanda } = await repo.submitComanda({
      locationId: 'mesa-1',
      waiterId: 'user-carlos',
      waiterName: 'Carlos (Mesonero)',
      items: [{ menuItemId: 'menu-pescado-frito', quantity: 2, notes: '' }],
    });
    expect(comanda).not.toBeNull();
    await repo.updateComandaStatus(comanda!.id, 'lista');

    renderWithRepo(repo);
    await enterPin(user, '1111');

    const banner = await screen.findByRole('status');
    expect(within(banner).getByText(/¡Orden lista en cocina!/i)).toBeInTheDocument();
    expect(within(banner).getByRole('button', { name: 'Mesa 1' })).toBeInTheDocument();

    await user.click(within(banner).getByRole('button', { name: /Confirmar entrega/i }));
    await waitFor(() => {
      expect(screen.queryByText(/¡Orden lista en cocina!/i)).not.toBeInTheDocument();
    });
  });

  it('11. Settling an order clears Pre-factura so a freed table never shows a previous cycle pre-factura in Mesonero', async () => {
    const user = userEvent.setup();
    const repo = new LocalPosRepository();

    const { order } = await repo.submitComanda({
      locationId: 'mesa-1',
      waiterId: 'user-carlos',
      waiterName: 'Carlos (Mesonero)',
      items: [{ menuItemId: 'menu-pescado-frito', quantity: 1, notes: '' }],
    });
    await repo.createPreCuentaPrintJob(order.id);
    await repo.settleOrder(order.id, [
      {
        id: 'pay-1',
        method: 'efectivo_usd',
        currency: 'USD',
        amountNative: order.totalUsd,
        amountUsd: order.totalUsd,
        amountBs: order.totalBs,
        exchangeRate: order.exchangeRate,
        paidAt: new Date().toISOString(),
      },
    ]);

    renderWithRepo(repo);
    await enterPin(user, '1111');

    const mesa1Tile = await screen.findByRole('button', { name: /^Mesa 1\b/i });
    expect(within(mesa1Tile).getByText(/Libre/i)).toBeInTheDocument();
    expect(within(mesa1Tile).queryByText(/Pre-factura lista/i)).not.toBeInTheDocument();

    await user.click(mesa1Tile);
    expect(screen.queryByText(/Pre-factura enviada por Caja/i)).not.toBeInTheDocument();
  });
});
