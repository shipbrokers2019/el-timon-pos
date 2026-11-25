# Diseño de Sistema POS para Restaurante de Playa

**Fecha:** 2026-11-24  
**Tamaño del trabajo:** Proyecto completo  
**Estado:** Listo para aprobación del usuario (revisión técnica completada)

---

## 1. Propósito y Contexto

Un restaurante de playa con **10 mesas** y **18 toldos en la playa** necesita un sistema de punto de venta (POS) pensado para operar exclusivamente con **3 tablets Android** (sin computadora en caja) y una **impresora térmica de 80 mm conectada directo al Wi-Fi**.

El sistema debe resolver tres realidades críticas del día a día en playa:
1. **Conectividad inestable en la arena:** el Wi-Fi puede fallar en la zona de los 18 toldos; los mesoneros no pueden perder pedidos ni quedarse bloqueados esperando señal.
2. **Separación estricta de roles:** cada estación ve solo lo que necesita para operar sin distracciones ni acceso indebido a datos financieros o de stock.
3. **Cobro en doble moneda venezolana (USD / VES):** precios de referencia en dólares, tasa del día en bolívares, múltiples métodos de pago y pagos combinados con cuadre exacto en el cierre de caja.

---

## 2. Objetivos, No-Objetivos y Anti-Objetivos

### Objetivos
- **Toma de pedidos rápida y tolerante a cortes de Wi-Fi:** los mesoneros toman pedidos en mesas y toldos desde la tablet incluso sin señal; al reconectarse, los pedidos se sincronizan automáticamente entre las 3 tablets y disparan la comanda a cocina.
- **Impresión directa y silenciosa en 80 mm por Wi-Fi:** comandas de cocina (y pre-cuentas / resúmenes de cierre desde caja) impresas vía red local ESC/POS (TCP/IP) sin ventanas del navegador ni PC intermediaria.
- **Tres interfaces estrictamente aisladas por rol:**
  - **Mesonero:** ve *únicamente* la cuadrícula de las 10 mesas y 18 toldos y la toma/seguimiento de pedidos. Sin acceso a caja, cierre, totales del día ni inventario.
  - **Cocina:** ve *únicamente* las comandas entrantes (cola de preparación, estado y reimpresión). Sin acceso a precios, caja, inventario ni cuadrícula de cobro.
  - **Caja / Administrador:** acceso completo a cuadrícula, cuentas abiertas, cobros en doble moneda, cierre de caja, inventario de insumos por recetas, estadísticas de ventas, menú, tasa del día, usuarios y configuración de impresora.
- **Cobro preciso en doble moneda y cierre de caja claro:** USD y bolívares (VES) con tasa del día editable, soporte para Zelle, dólares en efectivo, tarjeta de débito / punto de venta, bolívares en efectivo y pagos mixtos.
- **Probable en navegador desde el día 1:** vista previa e interacción completa en navegador web (con vista previa de ticket 80 mm simulado) y empaquetado como APK Android con Capacitor para las tablets definitivas.

### No-Objetivos (fuera de alcance en esta versión)
- App pública para clientes o pedidos por código QR propio del cliente.
- Integración con máquina fiscal / impresora fiscal homologada SENIAT (los tickets de 80 mm son comandas internas, pre-cuentas y resumen interno de cierre de caja).
- Contabilidad multi-sucursal, nómina o gestión de compras/proveedores avanzada (el inventario cubre control de existencias y disponibilidad por producto).
- Integraciones con plataformas externas de delivery.

### Anti-Objetivos (lo que haría fallar el sistema aunque "funcione")
- Que un mesonero pueda ver ingresos del día, cierre de caja o niveles de inventario.
- Que la tablet de cocina muestre pantallas de cobro, menú administrativo o distraiga con información ajena a las comandas.
- Perder un pedido tomado en el Toldo 18 cuando se cae el Wi-Fi.
- Imprimir comandas duplicadas en cocina cuando una tablet recupera señal o cuando varias tablets sincronizan al mismo tiempo.
- Mostrar diálogos lentos de impresión del sistema Android cada vez que se envía un pedido.
- Que cambiar la tasa del día al día siguiente altere los montos históricos de cierres de caja pasados.

---

## 3. Restricciones Confirmadas

- **Espacio físico:** 2 zonas fijas iniciales: **10 mesas** (`Mesa 1` a `Mesa 10`) y **18 toldos** (`Toldo 1` a `Toldo 18`).
- **Hardware:**
  - **3 tablets** trabajando simultáneamente (aún no compradas; recomendación acordada: tablets Android).
  - **Sin computadora** en caja ni servidor PC en el restaurante.
  - **1 impresora de 80 mm conectada directo al Wi-Fi** (ESC/POS por TCP en red local, típicamente puerto 9100).
- **Red:** el Wi-Fi puede fallar o interrumpirse en la zona de toldos en la playa.
- **Monedas y pagos:** doble moneda **USD** y **VES (Bs)**; métodos obligatorios: **Zelle**, **Dólares en efectivo**, **Tarjeta de débito / Punto de venta** y **Bolívares en efectivo**.

---

## 4. Enfoques Evaluados y Decisión

Se evaluaron tres arquitecturas antes de diseñar:

1. **Opción 1 (Elegida por el usuario): App web moderna (React + TypeScript) con persistencia offline-first + sincronización en tiempo real en la nube + empaquetado Android (Capacitor APK) con impresión directa Wi-Fi ESC/POS.**
   - *Por qué se eligió:* ofrece impresión directa y silenciosa en 80 mm sin apps puente de terceros, resiste cortes de Wi-Fi en los toldos mediante cola offline local, sincroniza las 3 tablets sin servidor PC y permite probar todo directamente en el navegador durante el desarrollo.
   - *Contrapartida aceptada:* requiere internet en el router del restaurante para sincronizar las 3 tablets entre sí vía la nube (aunque el pedido local nunca se pierde y la impresión funciona sobre el Wi-Fi local).
2. **Opción 2 (Descartada): PWA pura en Chrome + app puente externa en Android (ej. RawBT).**
   - *Por qué se descartó:* depende de configurar y mantener una app puente externa en cada tablet como punto adicional de fallo durante el servicio.
3. **Opción 3 (Descartada): Red 100% local con tablet maestra o mini-servidor local.**
   - *Por qué se descartó:* mayor complejidad de instalación y riesgo de que si se apaga la tablet maestra se detenga la sincronización.

---

## 5. Diseño Funcional y de Roles

### 5.1 Control de Acceso y Vistas por Rol

Al abrir la app, cada dispositivo entra a una pantalla de acceso rápido por **PIN numérico de 4 dígitos** (con opción de fijar la tablet en modo estación, por ejemplo "Estación Cocina", para evitar cambios accidentales).

| Capacidad | Mesonero | Cocina | Caja / Admin |
|---|:---:|:---:|:---:|
| Ver cuadrícula de 10 mesas y 18 toldos | Sí | No | Sí |
| Abrir mesa/toldo y tomar pedidos (rondas) | Sí | No | Sí |
| Enviar comanda a cocina | Sí | No | Sí |
| Ver estado de comandas de sus mesas/toldos | Sí | No | Sí |
| Anular ítems ya enviados a cocina | No (requiere PIN Admin) | No | Sí |
| Ver cola de comandas entrantes y marcar estado | No | Sí | Sí |
| Imprimir / reimprimir comanda 80 mm | Envío automático | Sí (auto + reimpresión) | Sí |
| Ver cuentas completas, cobrar y cerrar mesa/toldo | No | No | Sí |
| Ver y ejecutar Cierre de Caja | No | No | Sí |
| Ver y gestionar Inventario de insumos y Recetas | No | No | Sí |
| Ver Estadísticas y reportes de ventas | No | No | Sí |
| Editar menú, tasa del día, usuarios e impresora | No | No | Sí |

*Nota de seguridad UI:* las rutas, pestañas y consultas de caja e inventario no se renderizan ni se cargan en las sesiones de Mesonero o Cocina (y las reglas de seguridad de la base de datos en la nube reforzarán los permisos por rol).

### 5.2 Vista Mesonero (Solo Cuadrícula + Toma de Pedidos)
- **Cuadrícula dividida en 2 pestañas o secciones claras:** `Mesas (10)` y `Toldos Playa (18)`.
- **Tarjetas grandes con alto contraste** (legibles bajo luz solar en playa, objetivos táctiles amplios):
  - Estados visuales claros: **Libre**, **Ocupada** (muestra tiempo transcurrido y cantidad de comandas activas), **Lista en cocina** (aviso visual cuando cocina marca una comanda lista), **Pendiente de sincronizar** (indicador cuando el pedido se tomó sin Wi-Fi).
- **Toma de pedido rápida:**
  - Categorías del menú (ej. Platos, Entradas, Bebidas, Cócteles, Extras/Toldo).
  - Productos agotados en inventario aparecen bloqueados como `Agotado` (sin mostrar cantidades numéricas de stock al mesonero).
  - Modificadores/notas libres por ítem (ej. "sin cebolla", "bien frío", "sin hielo") y cantidad con botones `+` / `-`.
  - Un toque en **"Enviar Comanda"** guarda localmente de inmediato, actualiza la mesa/toldo, y encola la impresión/sincronización.
  - Si el mesonero está sin Wi-Fi en la playa, la app muestra un banner discreto ("Sin conexión — pedido guardado, se enviará al recuperar señal") y lo sincroniza automáticamente apenas vuelve la señal.
- **Sin visibilidad financiera global:** el mesonero puede ver el detalle de ítems pedidos en una mesa/toldo (y solicitar pre-cuenta si aplica), pero nunca accede a caja, cobros, reportes ni inventario.

### 5.3 Vista Cocina (Solo Comandas — KDS + Impresión Automática)
- **Pantalla dedicada exclusivamente a comandas entrantes**, ordenadas por orden de llegada (FIFO), con alertas de tiempo transcurrido (ej. verde < 10 min, ámbar 10–20 min, rojo > 20 min).
- Cada tarjeta de comanda muestra:
  - Zona y número en tipografía muy grande (ej. `TOLDO 14` o `MESA 3`).
  - Número secuencial de comanda (`#042`), hora y nombre del mesonero.
  - Lista de ítems con cantidades destacadas y notas de preparación resaltadas.
  - Estado de impresión (`Impresa`, `Imprimiendo...`, `Error de impresora`) + botón grande **"Reimprimir 80mm"**.
  - Botones de flujo simples: **En preparación** → **Listo** (desaparece de activas y pasa a un historial rápido de últimos 30 minutos por si cocina necesita reconsultar o reimprimir).
- **Sin distractores:** no muestra precios, ni cuadrícula de mesas, ni caja, ni inventario.

### 5.4 Vista Caja / Administrador
1. **Cuadrícula y Cuentas Abiertas:**
   - Misma vista de las 10 mesas y 18 toldos, mostrando además el saldo acumulado en **USD** y su equivalente en **Bs** a la tasa del día.
   - Acciones: ver detalle de cuenta, añadir/anular ítems (con motivo registrado), mover mesa/toldo, imprimir **Pre-cuenta (80 mm)** y **Cobrar / Cerrar cuenta**.
2. **Cobro en Doble Moneda y Pagos Combinados (confirmado por el usuario):**
   - **Precios finales todo incluido:** `totalUSD = suma(cantidad × precioUSD)` y `totalBs = totalUSD × tasaDelDia`. Sin IVA adicional, sin 10% de servicio, sin IGTF y sin descuentos/cortesías.
   - **Una sola cuenta por mesa/toldo al momento de cerrar:** no requiere dividir cuenta ni registrar abonos parciales anticipados.
   - Permite registrar uno o varios métodos de pago hasta completar el total (pagos mixtos):
     - **Zelle** (en USD + campo opcional de referencia/titular)
     - **Dólares en efectivo** (en USD)
     - **Tarjeta de débito / Punto de venta** (en Bs, o con conversión automática a USD)
     - **Bolívares en efectivo** (en Bs)
   - Calcula automáticamente el **restante por cobrar** y muestra el **vuelto estimado** en USD y Bs solo como guía visual para el cajero (sin seguimiento contable de moneda del vuelto).
   - Congela la `tasaAplicada` en cada orden cerrada y cada pago registrado para que cambios futuros de tasa no modifiquen el historial.
3. **Cierre de Caja (sencillo basado en ventas cobradas — confirmado por el usuario):**
   - Apertura y cierre de turno/jornada de caja (sin fondo inicial ni registro de retiros/gastos; advierte si quedan mesas o toldos abiertos antes de cerrar, y contabiliza todas las cuentas cobradas dentro del turno).
   - Resumen automático en tiempo real y al cierre:
     - Total ventas del turno (en USD y Bs equivalentes), cantidad de cuentas cerradas y ticket promedio.
     - Desglose exacto por método de pago: total en **Zelle (USD)**, **Efectivo USD**, **Débito / Punto de venta (Bs y equiv. USD)**, **Efectivo Bs (y equiv. USD)**.
     - Notas opcionales de cierre, historial de cierres anteriores y botón para imprimir **Resumen de Cierre (80 mm)**.
4. **Inventario de Insumos y Recetas (Escandallo):**
   - **Catálogo de insumos / ingredientes:** cada materia prima o producto almacenable se registra con unidad de medida (`g`, `kg`, `ml`, `L`, `unidad`), stock actual, umbral de stock bajo, costo unitario opcional (en USD) y registro de movimientos (kardex: ventas, reposiciones, mermas y anulaciones).
   - **Recetas de 1 nivel por plato del menú (decisión propuesta):** cada ítem del menú vincula directamente una lista de insumos y cantidades exactas (ej. *Hamburguesa* = `200 g carne` + `1 unidad pan` + `30 g queso`; *Cerveza* = `1 unidad cerveza`). Las variantes con distinta receta (ej. *Hamburguesa Doble*) se manejan como ítems propios en el menú; las notas de comanda (ej. *"sin cebolla"*) son texto libre informativo para cocina y no alteran el descuento automático; no se incluyen sub-recetas intermedias en esta versión.
   - **Descuento automático al enviar comanda (decisión propuesta):** los insumos se descuentan de forma idempotente (por `comandaId`) apenas se confirma/sincroniza la comanda, manteniendo el stock al día durante todo el servicio aunque un toldo tarde horas en cerrar su cuenta.
   - **Anulación con elección de destino (decisión propuesta):** si Caja/Admin anula un ítem ya enviado a cocina, Cocina recibe alerta inmediata en pantalla y un ticket breve `*** ANULACIÓN ***` en 80 mm, y Caja elige en un toque si los insumos se **devuelven al inventario** (si aún no se preparó) o se registran como **merma** (si ya se cocinó).
   - **Manejo seguro en hora pico (decisión propuesta):** si un insumo llega a cero o baja del mínimo, Caja/Admin recibe alerta inmediata de stock bajo/negativo y puede activar el bloqueo **"Agotado"** para los mesoneros (por defecto, los insumos no bloquean automáticamente la venta salvo que el plato se marque como agotado, para evitar detener el servicio si llegó mercancía que aún no se cargó al sistema — configurable por producto).
   - **Ajustes manuales:** entradas de compra/reposición, salidas por merma y ajuste de conteo físico con motivo registrado.
5. **Estadísticas y Reportes (solo Caja/Admin):**
   - Filtro de período rápido: **Hoy**, **Últimos 7 días**, **Últimos 30 días** y **Rango personalizado**.
   - **Platos y bebidas más vendidos (Top productos):** ranking por unidades vendidas y por monto facturado (USD), más los menos vendidos para optimizar la carta.
   - **Ventas por zona (Mesas vs. Toldos en la playa):** comparación de ingresos, cantidad de cuentas y ticket promedio entre el área de mesas y los 18 toldos.
   - **Horas pico y tendencia diaria:** gráfica de ventas por hora del día y por día de la semana para planificar personal y compras.
   - **Desglose por método de pago y moneda:** proporción y montos en Zelle, efectivo USD, débito/punto de venta y efectivo Bs.
   - **Desempeño por mesonero:** número de comandas/cuentas atendidas y ventas generadas por cada mesonero.
   - **Consumo de insumos (por recetas):** ingredientes más consumidos en el período y proyección rápida de reposición para compras.
6. **Configuración (solo Admin):**
   - **Tasa del día (Bs por 1 USD)** con fecha/hora de última actualización visible en caja.
   - **Menú, recetas y precios** (crear/editar categorías, productos, precio en USD, receta de insumos asociada y si se imprime en cocina o no).
   - **Usuarios y PINs** (crear/desactivar mesoneros, estación cocina y cajeros/admins).
   - **Impresora Wi-Fi 80 mm:** configurar IP local (ej. `192.168.1.200`), puerto (por defecto `9100`), nombre del restaurante en encabezado, modo de impresión (impresión automática desde estación Cocina o desde la tablet emisora) y botón **"Imprimir ticket de prueba"**.

---

## 6. Arquitectura Técnica (Opción 1)

### 6.1 Decisiones de Arquitectura (Propuestas del Diseñador)
> Las siguientes decisiones técnicas son propuestas concretas para implementar la Opción 1 elegida por el usuario y se pueden ajustar si el usuario prefiere otra herramienta:

- **Frontend y app móvil:** React + TypeScript + Vite + Tailwind CSS, empaquetada para Android con **Capacitor**.
- **Sincronización y persistencia offline:**
  - **Capa de datos desacoplada (Repository Pattern)** con dos modos:
    1. **Modo Nube en Tiempo Real (Producción):** Firebase Firestore con persistencia offline nativa en IndexedDB (`persistentLocalCache`). Las 3 tablets leen y escriben en caché local al instante y Firestore sincroniza cambios automáticamente al recuperar señal.
    2. **Modo Local / Demo (Desarrollo y pruebas inmediatas):** almacenamiento en IndexedDB/localStorage + `BroadcastChannel` para simular sincronización multi-pestaña (Mesonero + Cocina + Caja abiertos en el mismo navegador) sin requerir credenciales externas para probar toda la app.
- **Modelo de autenticación y aislamiento real por rol (decisión propuesta):**
  - En producción con Firebase, cada tablet se aprovisiona una sola vez con su **credencial de estación** (`mesonero`, `cocina` o `caja-admin`) en Firebase Auth, de modo que `firestore.rules` bloquea a nivel de base de datos que las tablets de Mesonero o Cocina lean o escriban colecciones de caja, cierres, inventario o estadísticas.
  - Encima de la estación, el **PIN de 4 dígitos** identifica rápido qué mesonero/cajero está operando (incluso offline) y permite autorizar anulaciones en Caja.
  - El descuento automático de insumos por receta y la consolidación de estadísticas se ejecutan desde la estación Caja/Admin o Cloud Function idempotente al recibir nuevas comandas, garantizando que Mesonero jamás necesite permisos sobre `inventory`.
- **Enrutamiento de ítems fuera de cocina y solicitud de cuenta (decisión propuesta):**
  - Los ítems marcados como **"no va a cocina"** (ej. cervezas frías de cava o alquiler de toldo) no aparecen en la pantalla de Cocina ni generan ticket de cocina; si una ronda contiene solo ítems fuera de cocina, se suma directo a la cuenta y descuenta inventario sin distraer a Cocina.
  - Cuando un mesonero presiona **"Pedir cuenta"** en una mesa/toldo, cambia el estado visual a **Por cobrar** para avisar a Caja (Caja imprime la pre-cuenta y realiza el cobro).
- **Impresión directa 80 mm Wi-Fi (ESC/POS) sin duplicados ni colisiones (decisión propuesta):**
  - Generador de comandos binarios **ESC/POS** para papel térmico de 80 mm (48 columnas, texto doble altura para número de mesa/toldo, corte automático de papel).
  - En **Android (Capacitor):** envío por socket TCP crudo al `IP:9100` de la impresora en el Wi-Fi local mediante un plugin Capacitor TCP/ESC-POS.
  - En **Navegador web:** modal/vista previa exacta del ticket de 80 mm (más opción de `window.print()` con CSS `@page { size: 80mm auto; }`) para validar el formato en pruebas.
  - **Cola serializada y respaldo ante caída de internet:** como hay una sola impresora Wi-Fi para comandas, pre-cuentas y cierres, la **tablet de Cocina** actúa por defecto como coordinadora principal de impresión serializada (evitando colisiones TCP en el puerto 9100) usando un `printJobId` idempotente (`pending -> printing -> printed | failed`). Si se cae el internet de la calle pero sigue el Wi-Fi local, la tablet emisora detecta la desconexión de la nube y hace **respaldo automático directo por LAN** a la impresora marcando el trabajo como `printedLocally` para que Cocina no lo duplique cuando regrese internet.
- **Resolución de conflictos offline en mesas/toldos:**
  - Cada comanda es un documento independiente (append-only) asociado a una `ordenId` abierta de la mesa/toldo. Así, si dos mesoneros (o uno offline y otro online) añaden pedidos al mismo toldo, las comandas se **suman** sin sobrescribirse nunca.

### 6.2 Formato de Comanda 80 mm (Esquema Visual)

```text
================================================
          *** COMANDA #042 ***
================================================
  TOLDO 14 (Playa)        Hora: 13:24
  Mesonero: Carlos        Ronda #2
------------------------------------------------
  2x Pescado Frito Completo
     >> Sin ensalada, extra tostones
  3x Cerveza Polar Pilsen
     >> Bien frías
  1x Ceviche Mixto
------------------------------------------------
  [Impreso: 13:24:05]
================================================
```

---

## 7. Decisiones Abiertas / Dejadas al Constructor

Se dejan al constructor (a menos que el usuario indique lo contrario):
- Estructura exacta de carpetas, componentes React y gestión de estado interno.
- Esquema detallado de colecciones Firestore y reglas de seguridad (`firestore.rules`).
- Diseño visual detallado (paleta fresca de restaurante de playa con alto contraste para exteriores, iconografía y layout responsive para tablets 8"–11" en horizontal y vertical).
- Menú de ejemplo inicial (platos playeros y bebidas) precargable para demostración y pruebas.
- Estrategia de pruebas unitarias (cálculos de doble moneda, pagos combinados, vuelto, descuento de inventario, generador ESC/POS, lógica offline y permisos por rol).
