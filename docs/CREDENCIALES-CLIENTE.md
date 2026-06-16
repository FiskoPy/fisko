# Fisko — Credenciales que necesitamos del cliente (Marco 2)

El **núcleo fiscal** de Fisko ya está funcionando (importar facturas electrónicas,
dashboard, reportes PDF/Excel, y **captura automática desde Gmail**). Las
siguientes funciones del Marco 2 dependen de cuentas/llaves que **solo el titular
del negocio puede crear**. Abajo está el paso a paso de cada una.

> Cómo enviarnos cada dato de forma segura: NO los pegues en un chat común.
> Usá un gestor de contraseñas compartido, un PDF protegido, o pasámelos por
> llamada. Una vez configurados, podemos rotarlos.

Estado de cada función:

| Función | Necesita | Estado |
|---|---|---|
| Importar XML manual | — | ✅ Listo |
| Dashboard + reportes PDF/Excel | — | ✅ Listo |
| **Captura por Gmail** (automática) | Contraseña de aplicación de Gmail | ✅ Listo (ver §0) |
| Captura por **Outlook** | App de Azure (OAuth) | ⏳ §1 |
| **OCR** de facturas en papel (foto) | Google Cloud Vision | ⏳ §2 |
| **IA Fiscal** (alertas + estimaciones) | OpenAI API key | ⏳ §3 |
| **Suscripciones** (cobros) | Cuenta Pagopar | ⏳ §4 |
| **Envío por WhatsApp** | Meta WhatsApp Business | ⏳ §5 |

---

## 0. Gmail — captura automática (¡ya se puede usar!)

Esto **no requiere** una cuenta de programador. Funciona con una "contraseña de
aplicación" de la propia casilla de Gmail donde llegan las facturas.

**Requisito:** la cuenta de Gmail debe tener la **Verificación en 2 pasos** activada.

1. Entrá a <https://myaccount.google.com/security>.
2. Activá **Verificación en 2 pasos** (si todavía no está).
3. Entrá a <https://myaccount.google.com/apppasswords>.
4. En "Nombre de la app" escribí `Fisko` y tocá **Crear**.
5. Google muestra una contraseña de **16 letras** (ej. `abcd efgh ijkl mnop`).
6. En la app Fisko: **Perfil → Conectar correo → Conectar casilla**, elegí
   **Gmail**, poné el e-mail y esa contraseña de 16 letras. Listo.

A partir de ahí, "Sincronizar ahora" busca en el correo los XML de facturas
electrónicas (DTE) y los importa solo. Las repetidas se ignoran.

> ⚠️ Importante: la "contraseña de aplicación" da acceso de **solo lectura** al
> correo dentro de Fisko (para leer adjuntos). Se guarda **cifrada**. Podés
> revocarla cuando quieras desde la misma página de Google.

---

## 1. Outlook / Microsoft 365 — captura automática

Las cuentas personales de Outlook **ya no permiten** contraseña de aplicación por
IMAP, así que se conecta vía **OAuth (Microsoft Graph)**. Necesitamos registrar
una aplicación en Azure (gratis):

1. Entrá a <https://portal.azure.com> con la cuenta Microsoft del negocio.
2. Buscá **"Microsoft Entra ID"** → menú **"App registrations"** → **"New registration"**.
3. Nombre: `Fisko`. En "Supported account types" elegí
   **"Accounts in any organizational directory and personal Microsoft accounts"**.
4. **Redirect URI**: tipo *Web* → `https://fisko-szb9.onrender.com/api/v1/email/outlook/callback`
   (te confirmamos la URL exacta al implementar).
5. Creá y copiá el **Application (client) ID** y el **Directory (tenant) ID**.
6. Menú **"Certificates & secrets"** → **"New client secret"** → copiá el **Value**
   (se muestra una sola vez).
7. Menú **"API permissions"** → **Add → Microsoft Graph → Delegated** →
   agregá **`Mail.Read`** y **`offline_access`** → **Grant admin consent**.

**Enviarnos:** Client ID · Tenant ID · Client secret.

---

## 2. Google Cloud Vision — OCR de facturas en papel

Para sacar foto a una factura impresa y extraer los datos.

1. Entrá a <https://console.cloud.google.com>.
2. Creá (o elegí) un proyecto, ej. **"Fisko"**.
3. Menú **"APIs & Services" → "Library"** → buscá **"Cloud Vision API"** → **Enable**.
4. Asegurate de que el proyecto tenga **facturación activada** (Vision tiene una
   capa gratuita mensual; para activarla Google pide una tarjeta).
5. Menú **"APIs & Services" → "Credentials" → "Create credentials" →
   "Service account"**. Nombre: `fisko-ocr`. Rol: **"Cloud Vision API User"**.
6. Entrá a la cuenta de servicio creada → pestaña **"Keys" → "Add key" → "JSON"**.
   Se descarga un archivo `.json`.

**Enviarnos:** el archivo **JSON** de la cuenta de servicio.

---

## 3. OpenAI — IA Fiscal (alertas e estimaciones)

Para los avisos inteligentes (gastos cada 10 días, IVA acumulado, etc.).

1. Entrá a <https://platform.openai.com>.
2. **Settings → Billing** → cargá un saldo inicial (ej. USD 5–10; el uso real es
   de centavos por mes con el modelo económico que usamos).
3. Menú **"API keys" → "Create new secret key"**. Nombre: `Fisko`.
4. Copiá la clave (empieza con `sk-...`; se muestra una sola vez).

**Enviarnos:** la **API key** (`sk-...`).

---

## 4. Pagopar — suscripciones / cobros

Para los planes de suscripción (cobro en guaraníes).

1. Registrá el comercio en <https://www.pagopar.com> (requiere RUC y datos
   bancarios del negocio).
2. Una vez aprobado, en el panel de comercio buscá las credenciales de
   integración: **Public Token / Identificador** y **Private Token / Llave privada**.
3. Confirmanos el **número de cuenta/medio** donde se acreditan los pagos.

**Enviarnos:** Public token · Private token. (Los detalles exactos de la API los
confirmamos con la documentación oficial de Pagopar al implementar.)

---

## 5. Meta — envío de reportes por WhatsApp

Para mandar el PDF/Excel al WhatsApp del usuario.

1. Entrá a <https://business.facebook.com> y creá una **cuenta de Meta Business**.
2. Entrá a <https://developers.facebook.com> → **"Create App"** → tipo **"Business"**.
3. Agregá el producto **"WhatsApp"**.
4. Registrá/elegí un **número de teléfono** para WhatsApp Business (no puede ser
   uno que ya use la app normal de WhatsApp).
5. Copiá: **Phone Number ID**, **WhatsApp Business Account ID** y un
   **Access Token permanente** (System User token).
6. Creá y mandá a aprobar una **plantilla de mensaje** (template) para enviar
   documentos (te pasamos el texto sugerido).

**Enviarnos:** Phone Number ID · WhatsApp Business Account ID · Access Token ·
nombre de la plantilla aprobada.

---

## Resumen rápido para el cliente

- **Ya mismo:** activá la contraseña de aplicación de **Gmail** (§0) y conectala
  en la app — la captura automática de facturas funciona hoy.
- **Cuando puedas:** creá las cuentas de §1–§5 y pasanos las llaves. Cada función
  se va activando a medida que recibimos las credenciales correspondientes.
