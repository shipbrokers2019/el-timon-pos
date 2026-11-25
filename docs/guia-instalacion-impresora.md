# Guía de Instalación en Sitio — El Timón POS

Guía paso a paso para dejar operando las tablets y la impresora térmica de 80 mm en el restaurante.

---

## 1. Conectar la impresora al mismo router que las tablets

- **Opción recomendada (cable Ethernet):** conecta un cable LAN desde la impresora directo a un puerto LAN del router del restaurante (más estable frente a interferencias de Wi-Fi).
- **Opción Wi-Fi:** une la impresora a la **misma red Wi-Fi** que usan las tablets de Caja, Cocina y Mesoneros.
- **Importante:** verifica que la impresora y todas las tablets estén en el mismo rango de IP (por ejemplo, todos `192.168.1.x` o todos `192.168.0.x`).

---

## 2. Sacar el ticket Self-Test para ver la IP y MAC

1. Apaga la impresora térmica con su interruptor físico.
2. Mantén presionado el botón **FEED**.
3. Sin soltar **FEED**, enciende la impresora y espera ~3 segundos hasta que imprima; luego suelta.
4. Anota del ticket impreso:
   - **IP Address** (ej. `192.168.1.105`)
   - **MAC Address** (ej. `00:11:22:33:44:55`)
   - **Port** (estándar: **`9100`**)

---

## 3. Asignar una IP fija en el router

Evita que la impresora cambie de IP cuando se vaya y regrese la electricidad.

1. Desde un teléfono o PC conectado al Wi-Fi del restaurante, abre en el navegador la dirección del router (`http://192.168.0.1` o `http://192.168.1.1`; el usuario y clave están en la etiqueta debajo del router).
2. Entra en **DHCP → Reserva de direcciones** (*Address Reservation* / *Static IP* / *DHCP Binding*).
3. Agrega una reserva nueva:
   - **MAC Address:** la del ticket Self-Test del Paso 2.
   - **IP fija:** una IP alta del mismo rango (ej. `192.168.1.200` si el router es `192.168.1.1`, o `192.168.0.200` si es `192.168.0.1`).
4. Guarda en el router, reinicia la impresora y repite el **Paso 2** para confirmar que ya tomó la IP fija.

---

## 4. Configurar la impresora en El Timón POS (desde Caja)

1. Abre [https://el-timon-restaurante.web.app](https://el-timon-restaurante.web.app) en la tablet de **Caja / Admin** (PIN `0000`).
2. Entra a **Configuración → Impresora Wi-Fi 80 mm**.
3. Completa los campos:
   - **Encabezado del restaurante:** nombre del local.
   - **Dirección IP LAN:** la IP fija asignada en el Paso 3 (ej. `192.168.1.200`).
   - **Puerto TCP:** `9100`.
4. Deja marcadas las casillas:
   - `[x]` **Auto-imprimir comandas desde estación Cocina**
   - `[x]` **Respaldo directo LAN sin internet**
5. Pulsa **Guardar impresora**.

---

## 5. Puente RawBT en tablets Android (mientras usen Chrome)

Mientras usen la app desde Chrome (antes de compilar el APK nativo con Capacitor), instala **RawBT** únicamente en la tablet de **Caja** y la de **Cocina** (las de Mesoneros no imprimen):

1. Instala **RawBT Print Service** desde Google Play Store.
2. Abre RawBT → **Configuración (engranaje)** o menú **☰**:
   - **Método de conexión (*Connection method*):** `Ethernet / Wi-Fi` (IP / Network).
   - **IP (*Printer IP*):** la misma IP fija del Paso 3 (ej. `192.168.1.200`).
   - **Puerto (*Port*):** `9100`.
   - **Ancho de papel (*Paper width*):** `80mm` (48 caracteres).
   - **Corte automático (*Cut*):** activado (si la impresora tiene guillotina).
3. Pulsa **Test / Prueba** dentro de RawBT para confirmar que imprime.
4. En **Ajustes de Android → Impresión** (o *Conexiones → Más ajustes de conexión → Impresión*), activa **RawBT Print Service**.

---

## 6. Probar alineación desde El Timón POS

1. En **Caja → Configuración → Impresora Wi-Fi 80 mm**, pulsa **Imprimir ticket de prueba 80mm**.
2. En la vista previa, pulsa **Imprimir navegador (80mm)**.
3. En la parte superior de la pantalla de impresión de Android, selecciona **RawBT** (Chrome lo recordará después) y toca **Imprimir**.
4. Verifica en el ticket físico:
   - Las líneas `====` y `----` salen rectas en un solo renglón (48 columnas exactas).
   - Aparece centrado `48 COLUMNAS - CONEXION OK`.
   - Hace corte de papel al final.

---

## Referencia rápida de estaciones y control de acceso

- **URL en vivo:** [https://el-timon-restaurante.web.app](https://el-timon-restaurante.web.app)
- **Repositorio GitHub:** [https://github.com/shipbrokers2019/el-timon-pos](https://github.com/shipbrokers2019/el-timon-pos)

| Estación | Correo de activación | `role` en `stationAuth` | PINs iniciales |
|---|---|---|---|
| **Caja / Admin** | `caja@eltimon.pos` | `caja_admin` | `0000` |
| **Mesoneros** | `mesonero@eltimon.pos` | `mesonero` | `1111` (Carlos) · `1234` (María) |
| **Cocina** | `cocina@eltimon.pos` | `cocina` | `2222` |

### Cómo pausar o revocar acceso al restaurante
En **Firebase Console → Firestore → `stationAuth`**, cambia el campo `active` a `false` en los documentos de las estaciones (o deshabilita los usuarios en **Firebase Authentication → Usuarios**). En cuanto las tablets tengan conexión a internet, las reglas de seguridad bloquean el acceso de inmediato.
