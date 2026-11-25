import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppShell } from '../../src/App';
import { LocalPosRepository } from '../../src/services/posRepository';
import { PosProvider } from '../../src/store/PosProvider';

function renderApp(repo = new LocalPosRepository()) {
  return {
    repo,
    ...render(
      <PosProvider repository={repo}>
        <AppShell />
      </PosProvider>,
    ),
  };
}

async function enterPin(user: ReturnType<typeof userEvent.setup>, pin: string) {
  for (const digit of pin) {
    await user.click(screen.getByRole('button', { name: digit }));
  }
}

describe('Caja / Admin Complete Suite & App Wiring', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('1. Logging in with PIN 0000 (Caja/Admin) shows all 5 admin sections', async () => {
    const user = userEvent.setup({ delay: null });
    renderApp();

    await enterPin(user, '0000');

    expect(
      await screen.findByRole('button', { name: /Cuadrícula y Cobros/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cierre de Caja/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Inventario y Recetas/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Estadísticas/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Configuración/i })).toBeInTheDocument();
    expect(screen.getByText(/1 USD = 52\.50 Bs/i)).toBeInTheDocument();
  });

  it('2. End-to-end mixed payment settlement on Mesa 1 frees Mesa 1 and reflects exact totals in Cierre de Caja', async () => {
    const user = userEvent.setup({ delay: null });
    const repo = new LocalPosRepository();

    await repo.submitComanda({
      locationId: 'mesa-1',
      waiterId: 'user-carlos',
      waiterName: 'Carlos (Mesonero)',
      items: [
        { menuItemId: 'menu-hamburguesa-playera', quantity: 1, notes: '' },
        { menuItemId: 'menu-cerveza-polar', quantity: 1, notes: '' },
      ],
    });
    await repo.requestCheck('mesa-1');

    renderApp(repo);
    await enterPin(user, '0000');

    // Open Mesa 1 account detail (regex avoids matching Mesa 10)
    const mesa1Tile = await screen.findByRole('button', { name: /^Mesa 1\b/i });
    expect(within(mesa1Tile).getByText(/\$12\.76/)).toBeInTheDocument();
    await user.click(mesa1Tile);

    // Open CheckoutModal
    await user.click(await screen.findByRole('button', { name: /Cobrar y Cerrar Cuenta/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByText(/\$11\.00/).length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText(/\$1\.76/).length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText(/\$12\.76/).length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText(/Bs\s*669\.90/).length).toBeGreaterThan(0);

    // Confirm button disabled before payment settles
    const confirmBtn = within(dialog).getByRole('button', {
      name: /Confirmar Cobro y Cerrar/i,
    });
    expect(confirmBtn).toBeDisabled();

    // Add Zelle payment for $6.00
    await user.click(within(dialog).getByRole('button', { name: /^Zelle/i }));
    const amountInput = within(dialog).getByLabelText(/Monto/i);
    await user.clear(amountInput);
    await user.type(amountInput, '6');
    await user.click(within(dialog).getByRole('button', { name: /Agregar pago/i }));

    // Subtotal $11.00 + IVA 16% ($1.76) = $12.76; after $6.00 Zelle remaining is $6.76 / Bs 354.90
    expect(within(dialog).getAllByText(/\$6\.76/).length).toBeGreaterThan(0);

    // Select Débito / Punto de venta and use "Pagar restante"
    await user.click(
      within(dialog).getByRole('button', { name: /Tarjeta de débito \/ Punto de venta/i }),
    );
    await user.click(within(dialog).getByRole('button', { name: /Pagar restante/i }));
    await user.click(within(dialog).getByRole('button', { name: /Agregar pago/i }));

    // Confirm settlement
    expect(confirmBtn).toBeEnabled();
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // Mesa 1 is now Libre
    await waitFor(() => {
      const updatedMesa1 = screen.getByRole('button', { name: /^Mesa 1\b/i });
      expect(within(updatedMesa1).getByText(/Libre/i)).toBeInTheDocument();
    });

    // Navigate to Cierre de Caja and check both methods
    await user.click(screen.getByRole('button', { name: /Cierre de Caja/i }));
    const zelleRow = (await screen.findByText(/^Zelle$/)).closest('tr');
    expect(zelleRow).not.toBeNull();
    expect(within(zelleRow!).getByText(/\$6\.00/)).toBeInTheDocument();

    const debitoRow = screen.getByText(/Débito \/ Punto de venta/i).closest('tr');
    expect(debitoRow).not.toBeNull();
    expect(within(debitoRow!).getByText(/\$6\.76/)).toBeInTheDocument();
    expect(within(debitoRow!).getByText(/Bs\s*354\.90/)).toBeInTheDocument();
  });

  it('3. Inventario y Recetas displays deducted Carne molida stock (4.8 kg) and allows registering a restock entry', async () => {
    const user = userEvent.setup({ delay: null });
    const repo = new LocalPosRepository();

    await repo.submitComanda({
      locationId: 'mesa-2',
      waiterId: 'user-carlos',
      waiterName: 'Carlos (Mesonero)',
      items: [{ menuItemId: 'menu-hamburguesa-playera', quantity: 1, notes: '' }],
    });

    renderApp(repo);
    await enterPin(user, '0000');

    await user.click(await screen.findByRole('button', { name: /Inventario y Recetas/i }));

    // Scope to the Existencias de insumos section (Carne molida also appears in Kardex below)
    const stockSection = (
      await screen.findByRole('heading', { name: /Existencias de insumos/i })
    ).closest('section');
    expect(stockSection).not.toBeNull();

    const carneRow = within(stockSection!).getByText('Carne molida').closest('tr');
    expect(carneRow).not.toBeNull();
    expect(within(carneRow!).getByText(/4\.8\s*kg/i)).toBeInTheDocument();

    // Register restock of +2 kg
    await user.click(within(carneRow!).getByRole('button', { name: /Entrada/i }));
    const qtyInput = await screen.findByLabelText(/Cantidad/i);
    await user.clear(qtyInput);
    await user.type(qtyInput, '2');
    const reasonInput = screen.getByLabelText(/Motivo/i);
    await user.clear(reasonInput);
    await user.type(reasonInput, 'Compra mercado matutino');
    await user.click(screen.getByRole('button', { name: /Guardar movimiento/i }));

    await waitFor(() => {
      const updatedCarneRow = within(stockSection!).getByText('Carne molida').closest('tr');
      expect(within(updatedCarneRow!).getByText(/6\.8\s*kg/i)).toBeInTheDocument();
    });
  });

  it('4. Estadísticas displays sold dish in top-selling dishes and shows Mesas vs Toldos comparison', async () => {
    const user = userEvent.setup({ delay: null });
    const repo = new LocalPosRepository();

    const { order: mesaOrder } = await repo.submitComanda({
      locationId: 'mesa-1',
      waiterId: 'user-carlos',
      waiterName: 'Carlos (Mesonero)',
      items: [{ menuItemId: 'menu-hamburguesa-playera', quantity: 2, notes: '' }],
    });
    await repo.settleOrder(mesaOrder.id, [
      {
        id: 'pay-1',
        method: 'zelle',
        currency: 'USD',
        amountNative: 19.72,
        amountUsd: 19.72,
        amountBs: 1035.3,
        exchangeRate: 52.5,
        paidAt: new Date().toISOString(),
      },
    ]);

    const { order: toldoOrder } = await repo.submitComanda({
      locationId: 'toldo-5',
      waiterId: 'user-maria',
      waiterName: 'María (Mesonera)',
      items: [{ menuItemId: 'menu-ceviche-mixto', quantity: 1, notes: '' }],
    });
    await repo.settleOrder(toldoOrder.id, [
      {
        id: 'pay-2',
        method: 'efectivo_usd',
        currency: 'USD',
        amountNative: 12.76,
        amountUsd: 12.76,
        amountBs: 669.9,
        exchangeRate: 52.5,
        paidAt: new Date().toISOString(),
      },
    ]);

    renderApp(repo);
    await enterPin(user, '0000');

    await user.click(await screen.findByRole('button', { name: /Estadísticas/i }));

    expect(await screen.findByText(/Platos más vendidos/i)).toBeInTheDocument();
    expect(screen.getAllByText('Hamburguesa Playera').length).toBeGreaterThan(0);

    const zoneSection = screen
      .getByRole('heading', { name: /Mesas vs\. Toldos en la playa/i })
      .closest('section');
    expect(zoneSection).not.toBeNull();
    expect(within(zoneSection!).getAllByText(/\$19\.72/).length).toBeGreaterThan(0);
    expect(within(zoneSection!).getAllByText(/\$12\.76/).length).toBeGreaterThan(0);
  });

  it('5. Updating daily exchange rate in Configuración updates displayed rate without altering already-closed orders', async () => {
    const user = userEvent.setup({ delay: null });
    const repo = new LocalPosRepository();

    const { order } = await repo.submitComanda({
      locationId: 'mesa-1',
      waiterId: 'user-carlos',
      waiterName: 'Carlos (Mesonero)',
      items: [{ menuItemId: 'menu-ceviche-mixto', quantity: 1, notes: '' }],
    });
    const closedBefore = await repo.settleOrder(order.id, [
      {
        id: 'pay-closed',
        method: 'efectivo_usd',
        currency: 'USD',
        amountNative: 12.76,
        amountUsd: 12.76,
        amountBs: 669.9,
        exchangeRate: 52.5,
        paidAt: new Date().toISOString(),
      },
    ]);

    renderApp(repo);
    await enterPin(user, '0000');

    await user.click(await screen.findByRole('button', { name: /Configuración/i }));

    const rateInput = await screen.findByLabelText(/Tasa del día \(Bs \/ USD\)/i);
    await user.clear(rateInput);
    await user.type(rateInput, '60');
    await user.click(screen.getByRole('button', { name: /Guardar tasa/i }));

    await waitFor(() => {
      const rateHeaderButton = screen.getByTitle(/Editar tasa del día en Configuración/i);
      expect(within(rateHeaderButton).getByText(/1 USD = 60\.00 Bs/i)).toBeInTheDocument();
    });

    const storedClosed = repo.getState().orders.find((o) => o.id === closedBefore.id);
    expect(storedClosed?.exchangeRate).toBe(52.5);
    expect(storedClosed?.totalBs).toBe(669.9);
  });

  it('6. Caja can print Pre-cuenta 80mm, close preview with Escape, and void an item returning stock to inventory', async () => {
    const user = userEvent.setup({ delay: null });
    const repo = new LocalPosRepository();

    await repo.submitComanda({
      locationId: 'mesa-3',
      waiterId: 'user-carlos',
      waiterName: 'Carlos (Mesonero)',
      items: [{ menuItemId: 'menu-hamburguesa-playera', quantity: 1, notes: '' }],
    });

    // Carne molida was deducted from 5 to 4.8
    expect(
      repo.getState().ingredients.find((i) => i.id === 'ing-carne-molida')?.stock,
    ).toBe(4.8);

    renderApp(repo);
    await enterPin(user, '0000');

    await user.click(await screen.findByRole('button', { name: /^Mesa 3\b/i }));

    // Print Pre-cuenta 80mm and dismiss with Escape key
    await user.click(await screen.findByRole('button', { name: /Imprimir Pre-cuenta 80mm/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(document.getElementById('thermal-ticket-print-area')?.textContent).toContain(
      'PRECUENTA',
    );
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // Void item with restock choice
    await user.click(screen.getByRole('button', { name: /Anular ítem/i }));
    await user.type(screen.getByLabelText(/Motivo de anulación/i), 'Cliente cambió de opinión');
    await user.click(screen.getByRole('button', { name: /Devolver insumos al inventario/i }));
    await user.click(screen.getByRole('button', { name: /Confirmar anulación/i }));

    await waitFor(() => {
      expect(
        repo.getState().ingredients.find((i) => i.id === 'ing-carne-molida')?.stock,
      ).toBe(5);
    });
  });
});
