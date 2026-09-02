import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../utils/async-handler';

/**
 * Public legal pages, served outside /api/v1 so the URLs read as web pages in
 * the store listings.
 *
 * Both stores require a reachable privacy policy URL, and Google Play also
 * requires a web URL where a user can request account deletion, for any app
 * that lets people create an account.
 */
export const legalRouter = Router();

/** Data controller. Override per deployment if the operating entity changes. */
const EMPRESA = process.env.LEGAL_EMPRESA ?? 'TecBio';
const RUC = process.env.LEGAL_RUC ?? '80175384-8';
const CONTACTO = process.env.LEGAL_CONTACT_EMAIL ?? 'fiskopy@gmail.com';

const ACTUALIZADO = '19 de agosto de 2026';

const page = (titulo: string, cuerpo: string): string => `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titulo} — Fisko</title>
<style>
  :root { color-scheme: light dark; --azul:#14508F; --tinta:#101820; --fondo:#F4F6F9; --borde:#D8DEE7; --gris:#6B7785; }
  @media (prefers-color-scheme: dark) {
    :root { --azul:#7FB6E8; --tinta:#E8ECF1; --fondo:#121820; --borde:#2A3543; --gris:#98A4B3; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--fondo); color:var(--tinta);
         font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  main { max-width:44rem; margin:0 auto; padding:2.5rem 1.25rem 4rem; }
  h1 { color:var(--azul); font-size:1.75rem; line-height:1.2; letter-spacing:-.02em; margin:0 0 .25rem; }
  h2 { color:var(--azul); font-size:1.1rem; margin:2.25rem 0 .5rem; letter-spacing:-.01em; }
  .fecha { color:var(--gris); font-size:.875rem; margin:0 0 2rem; }
  ul { padding-left:1.25rem; }
  li { margin:.35rem 0; }
  code { background:rgba(127,127,127,.15); padding:.1rem .35rem; border-radius:4px; font-size:.9em; }
  a { color:var(--azul); }
  footer { margin-top:3rem; padding-top:1.25rem; border-top:1px solid var(--borde);
           color:var(--gris); font-size:.875rem; }
</style>
</head>
<body><main>${cuerpo}
<footer>${EMPRESA} — RUC ${RUC}<br>Contacto: <a href="mailto:${CONTACTO}">${CONTACTO}</a></footer>
</main></body></html>`;

legalRouter.get('/privacidad', (_req, res) => {
  res.type('html').send(
    page(
      'Política de privacidad',
      `<h1>Política de privacidad</h1>
<p class="fecha">Última actualización: ${ACTUALIZADO}</p>

<p>Fisko es una aplicación de gestión fiscal para contribuyentes paraguayos, operada por
<strong>${EMPRESA}</strong> (RUC ${RUC}). Esta política explica qué datos tratamos, para qué,
y qué derechos tenés sobre ellos, conforme a la <strong>Ley N.º 6.534/2020</strong> de protección
de datos personales.</p>

<h2>Qué datos tratamos</h2>
<ul>
  <li><strong>Cuenta:</strong> nombre, correo electrónico y contraseña. La contraseña se guarda
      siempre con hash (argon2); nadie, incluido nuestro equipo, puede leerla.</li>
  <li><strong>RUC y dígito verificador</strong>, si decidís cargarlos. Son opcionales y sirven para
      distinguir tus ventas de tus compras en los reportes.</li>
  <li><strong>Ingreso con Google</strong>, si lo usás: recibimos tu correo, tu nombre y un
      identificador de cuenta de Google. No accedemos a tus contactos ni a tu Drive.</li>
  <li><strong>Facturas electrónicas (DTE)</strong> que importás: CDC, RUC y nombre del emisor y del
      receptor, fecha, moneda, montos, IVA discriminado (5% y 10%) y el detalle de los ítems.</li>
  <li><strong>Casilla de correo conectada</strong>, si activás la captura automática: la dirección y
      la contraseña de aplicación. Esa contraseña se guarda <strong>cifrada</strong> (AES-256-GCM) y
      se usa únicamente para <strong>leer</strong> los adjuntos XML de facturas. Fisko no envía
      correos desde tu casilla, no borra mensajes y no conserva el contenido de correos que no
      traigan una factura adjunta.</li>
</ul>

<h2>Para qué los usamos</h2>
<ul>
  <li>Autenticarte y mantener tu sesión.</li>
  <li>Calcular tu resumen fiscal: IVA 5% y 10%, crédito y débito, y la estimación de IRP.</li>
  <li>Generar los reportes en PDF y Excel que vos solicitás.</li>
  <li>Importar automáticamente las facturas que llegan a la casilla que conectaste.</li>
  <li>Enviarte el correo de recuperación de contraseña cuando lo pedís.</li>
</ul>
<p>No usamos tus datos para publicidad, no los vendemos y no los cedemos a terceros con fines
comerciales.</p>

<h2>Dónde se guardan</h2>
<p>Los datos se almacenan en una base de datos gestionada por <strong>Render</strong>, con servidores
en los Estados Unidos, y los correos de recuperación se envían mediante <strong>Brevo</strong>. Esto
implica una transferencia internacional de datos, necesaria para prestar el servicio. Ambos
proveedores actúan únicamente como encargados del tratamiento por nuestra cuenta.</p>

<h2>Cuánto tiempo</h2>
<p>Conservamos tus datos mientras tu cuenta esté activa. Si solicitás la eliminación, borramos tu
cuenta, tus facturas importadas y las credenciales de correo guardadas. Tené en cuenta que la
normativa fiscal paraguaya puede obligarte a conservar tus comprobantes por tu cuenta: Fisko es una
herramienta de apoyo y no reemplaza tus obligaciones ante la DNIT.</p>

<h2>Tus derechos</h2>
<p>Podés pedir en cualquier momento acceder a tus datos, corregirlos, exportarlos o eliminarlos, y
desconectar tu casilla de correo desde <em>Perfil → Conectar correo</em>. Para ejercerlos,
escribinos a <a href="mailto:${CONTACTO}">${CONTACTO}</a>.</p>

<h2>Seguridad</h2>
<p>La comunicación entre la aplicación y nuestros servidores viaja siempre cifrada (HTTPS). Las
contraseñas de casillas de correo se guardan cifradas y las de cuenta, con hash. Ningún sistema es
infalible: si detectamos un incidente que afecte tus datos, te lo comunicaremos.</p>

<h2>Menores</h2>
<p>Fisko está dirigida a contribuyentes y no está destinada a menores de 18 años.</p>

<h2>Cambios</h2>
<p>Si modificamos esta política, actualizaremos la fecha del encabezado y, si el cambio es
significativo, te avisaremos dentro de la aplicación.</p>`,
    ),
  );
});

legalRouter.get('/eliminar-cuenta', (_req, res) => {
  res.type('html').send(
    page(
      'Eliminar tu cuenta',
      `<h1>Eliminar tu cuenta y tus datos</h1>
<p class="fecha">Última actualización: ${ACTUALIZADO}</p>

<p>Podés pedir la eliminación de tu cuenta de Fisko y de todos los datos asociados en cualquier
momento. No hace falta ningún trámite presencial.</p>

<h2>Cómo pedirlo</h2>
<ul>
  <li>Escribí a <a href="mailto:${CONTACTO}">${CONTACTO}</a> desde
      <strong>la misma dirección de correo con la que te registraste</strong>, con el asunto
      <code>Eliminar mi cuenta Fisko</code>.</li>
  <li>Confirmamos la baja dentro de los <strong>30 días</strong> y te respondemos cuando esté hecha.</li>
</ul>

<h2>Qué se elimina</h2>
<ul>
  <li>Tu cuenta: nombre, correo, contraseña y RUC.</li>
  <li>Todas las facturas que importaste, con sus ítems.</li>
  <li>Las casillas de correo conectadas y sus credenciales cifradas.</li>
</ul>
<p>La eliminación es definitiva: los datos no se pueden recuperar después.</p>

<h2>Si sólo querés desconectar tu correo</h2>
<p>No hace falta borrar la cuenta. Entrá a <em>Perfil → Conectar correo</em> y tocá el ícono de
papelera junto a la casilla. Eso elimina la credencial guardada y detiene la captura automática,
conservando las facturas que ya importaste.</p>`,
    ),
  );
});

/**
 * Where Pagopar sends the payer after checkout.
 *
 * Pagopar requires the configured URL to carry the literal "($hash)" segment,
 * which it substitutes with the order hash. That is a gift: with the hash we
 * can look the order up and tell the customer what actually happened, instead
 * of a generic "thanks" that is right half the time.
 *
 * Still worded carefully around timing — the webhook is what credits the
 * subscription, and the browser can land here before it arrives.
 */
legalRouter.get(
  '/pago/resultado/:hash?',
  asyncHandler(async (req, res) => {
    const hash = (req.params as { hash?: string }).hash;
    const sub = hash
      ? await prisma.subscription.findFirst({ where: { hashPedido: hash } })
      : null;

    const paid = sub?.status === 'active';
    const body = paid
      ? `<h1>Tu plan está activo</h1>
<p class="fecha">Pago confirmado.</p>
<p>Ya podés cerrar esta página y volver a la app Fisko. Vas a ver tu plan
actualizado en <em>Perfil</em>.</p>`
      : `<h1>Pago recibido</h1>
<p class="fecha">Estamos esperando la confirmación de Pagopar.</p>
<p>Cerrá esta página y <strong>volvé a la app Fisko</strong>. La activación
puede tardar un par de minutos: Pagopar nos avisa apenas confirma el cobro.</p>

<h2>¿Y si no se completó?</h2>
<p>Si el cobro no salió, no se activa ningún plan y no se te cobra nada.
Podés intentarlo de nuevo desde la app.</p>`;

    res.type('html').send(page(paid ? 'Plan activo' : 'Pago recibido', body));
  }),
);
