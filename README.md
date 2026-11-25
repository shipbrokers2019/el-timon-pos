# Brisa POS — Sistema Punto de Venta para Restaurante de Playa

Aplicación POS **offline-first** diseñada para operar con **3 tablets Android**, sin computadora en caja y con impresión térmica directa por Wi-Fi (**80 mm ESC/POS**) para un restaurante de playa con **10 mesas** y **18 toldos**.

## Vistas Aisladas por PIN (Demo)

| Estación | PIN Demo | Qué ve y hace | Qué tiene bloqueado |
|---|---:|---|---|
| **Mesonero** (`Carlos` / `María`) | `1111` / `1234` | Solo cuadrícula de **10 Mesas** y **18 Toldos**, toma de pedidos, notas de cocina y botón **Pedir cuenta**. | Caja, cobros, cierre, inventario, recetas, estadísticas y tasa. |
| **Cocina** (`Estación Cocina`) | `2222` | Solo cola FIFO de **comandas entrantes**, alertas de tiempo, `En preparación` → `Listo`, alertas de anulación y **Reimprimir 80mm**. | Precios, cuadrícula de mesas/toldos, caja, inventario y estadísticas. |
| **Caja / Admin** | `0000` | Control completo: cuentas abiertas, cobros en doble moneda (**USD / Bs**), cierre de caja, **inventario por recetas (escandallo)**, **estadísticas**, menú, usuarios e impresora. | Acceso completo. |

## Probar las 3 Tablets en Vivo en el Navegador

1. Instala dependencias (si no lo has hecho):
   ```bash
   npm install
   ```
2. Arranca el servidor local:
   ```bash
   npm run dev
   ```
3. Abre **3 pestañas** en `http://localhost:5173`:
   - Pestaña 1 → inicia sesión con PIN `1111` (**Mesonero**)
   - Pestaña 2 → inicia sesión con PIN `2222` (**Cocina**)
   - Pestaña 3 → inicia sesión con PIN `0000` (**Caja / Admin**)
4. Todo se sincroniza en tiempo real entre pestañas mediante `BroadcastChannel` + `localStorage`. Puedes usar el botón **"Simular corte Wi-Fi"** en la barra superior para probar la cola offline en los toldos de la playa.

## Pruebas y Build de Producción

```bash
npm test        # Ejecuta toda la suite Vitest (dominio, servicios offline/impresora y aislamiento UI)
npm run build   # Compila TypeScript estricto y genera dist/
```

## Conectar Firebase Firestore (Sincronización en Nube entre 3 Tablets)

1. Crea un proyecto en Firebase Console y habilita **Authentication** + **Cloud Firestore**.
2. Copia `.env.example` a `.env` y completa tus credenciales `VITE_FIREBASE_*`.
3. Despliega las reglas de seguridad incluidas en [`firestore.rules`](./firestore.rules) (aíslan por estación `mesonero`, `cocina` y `caja_admin`):
   ```bash
   firebase deploy --only firestore:rules
   ```
4. Aprovisiona cada tablet una vez con su usuario de estación en Firebase Auth (`stationAuth/{uid}` con `{ role: 'mesonero' | 'cocina' | 'caja_admin', active: true }`).

## Empaquetar APK Android con Capacitor e Impresora Wi-Fi 80 mm

1. Genera el proyecto Android y sincroniza el build web:
   ```bash
   npx cap add android
   npm run cap:sync
   ```
2. Abre en Android Studio (`npx cap open android`) para compilar e instalar el APK en las 3 tablets Android.
3. En **Caja / Admin → Configuración → Impresora Wi-Fi 80 mm**, introduce la IP fija local de la impresora térmica (por ejemplo `192.168.1.200`, puerto `9100`) y pulsa **"Imprimir ticket de prueba 80mm"**.
   - El generador binario ESC/POS (`src/domain/escpos.ts`) formatea 48 columnas con corte automático y soporta respaldo directo por red local si se cae internet mientras sigue el Wi-Fi interno.
