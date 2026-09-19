import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../utils/async-handler';
import { reconcileOrder } from '../subscriptions/subscriptions.service';
import { PLANS } from '../../services/plans';

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
// fiskopy@gmail.com was the original address; Google blocked that account, so
// the client moved to fiskoapp@gmail.com. Both stores check that this contact
// actually receives mail, so a stale default here is a submission failure.
const CONTACTO = process.env.LEGAL_CONTACT_EMAIL ?? 'fiskoapp@gmail.com';

const ACTUALIZADO = '19 de septiembre de 2026';

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
  footer nav { margin-bottom:.5rem; }
  .planes { display:grid; gap:1rem; grid-template-columns:repeat(auto-fit,minmax(14rem,1fr)); margin:1rem 0; }
  .plan { border:1px solid var(--borde); border-radius:12px; padding:1rem 1.1rem; }
  .plan h3 { margin:0 0 .25rem; font-size:1.05rem; }
  .precio { font-size:1.35rem; font-weight:700; margin:0; }
  .precio small { font-size:.8rem; font-weight:400; color:var(--gris); }
  .plan ul { margin:.6rem 0 0; }
</style>
</head>
<body><main>${cuerpo}
<footer><nav><a href="/">Fisko</a> · <a href="/terminos">Términos</a> · <a href="/privacidad">Privacidad</a> · <a href="/eliminar-cuenta">Eliminar cuenta</a></nav>
${EMPRESA} — RUC ${RUC}<br>Contacto: <a href="mailto:${CONTACTO}">${CONTACTO}</a></footer>
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
  <li><strong>Fotos de facturas</strong>, si usás la cámara: la imagen se envía a
      <strong>Google Cloud Vision</strong> y a <strong>OpenAI</strong> únicamente para leerla (los
      datos de la factura, incluidos el emisor, el receptor y los ítems). No la guardamos en
      nuestros servidores: conservamos sólo los datos extraídos. Según las condiciones de sus API,
      ninguno de los dos usa esas imágenes para entrenar sus modelos; OpenAI puede conservarlas
      hasta 30 días para control de abusos y después las elimina.</li>
  <li><strong>Datos de pago:</strong> las suscripciones se cobran a través de <strong>Pagopar</strong>.
      El número de tu tarjeta y demás datos de pago los ingresás en la página de Pagopar y
      <strong>nunca pasan por Fisko</strong>; nosotros recibimos únicamente la confirmación del
      cobro, el plan contratado y el identificador del pedido.</li>
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
  <li>Leer automáticamente las facturas de papel que fotografiás.</li>
  <li>Generar los reportes en PDF y Excel que vos solicitás.</li>
  <li>Mostrarte avisos sobre tu IVA (gasto reciente, saldo acumulado, vencimiento) y una
      <strong>proyección del IVA del mes</strong>. Para redactar esa proyección enviamos a
      <strong>OpenAI</strong> únicamente montos totales por mes, sin tu nombre, RUC, correo ni el
      detalle de ninguna factura.</li>
  <li>Importar automáticamente las facturas que llegan a la casilla que conectaste.</li>
  <li>Enviarte el correo de recuperación de contraseña cuando lo pedís.</li>
</ul>
<p>No usamos tus datos para publicidad, no los vendemos y no los cedemos a terceros con fines
comerciales.</p>

<h2>Dónde se guardan</h2>
<p>Los datos se almacenan en una base de datos gestionada por <strong>Supabase</strong> y la
aplicación se sirve desde <strong>Render</strong>, ambos con servidores en los Estados Unidos; los
correos de recuperación se envían mediante <strong>Brevo</strong>. Para
funciones puntuales intervienen además <strong>Google Cloud Vision</strong> (lectura de fotos),
<strong>OpenAI</strong> (lectura de fotos de facturas y redacción de la proyección de IVA) y
<strong>Pagopar</strong> (cobro de suscripciones, en Paraguay). Esto implica una transferencia
internacional de datos, necesaria para prestar el servicio. Todos actúan únicamente como encargados
del tratamiento por nuestra cuenta y no usan tus datos para fines propios.</p>

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

<h2>Desde la app (inmediato)</h2>
<p>Entrá a <em>Perfil → Eliminar mi cuenta</em> y confirmá. La cuenta, las facturas y las casillas
conectadas se borran en el momento, sin esperar.</p>

<h2>Por correo</h2>
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

    // Ask Pagopar what actually happened rather than trusting only our own row:
    // the webhook can be late or lost, and the person is standing here now.
    // This is also step 3 of Pagopar's staging circuit.
    if (hash) await reconcileOrder(hash).catch(() => undefined);

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

/** "Gs 59.900" — a fixed format, independent of the server's ICU data. */
const gs = (n: number): string =>
  'Gs ' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/**
 * The public front door: what Fisko is, what it costs and how to buy it.
 *
 * Pagopar asked for a "canal de venta" before enabling virtual products and
 * subscriptions, and the root of this host answered a JSON 404 — which is
 * what a payment processor's reviewer would have opened. Prices come from the
 * same catalogue the app and the checkout use, so this page cannot quote a
 * price the checkout does not charge.
 */
legalRouter.get('/', (_req, res) => {
  const planes = PLANS.map((p) => {
    const precio =
      p.priceGs != null
        ? `${gs(p.priceGs)} <small>por mes</small>`
        : p.id === 'gratis'
          ? 'Sin costo'
          : 'A convenir';
    const items = p.features.map((f) => `<li>${f}</li>`).join('');
    return `<div class="plan"><h3>${p.name}</h3><p class="precio">${precio}</p><ul>${items}</ul></div>`;
  }).join('\n');

  res.type('html').send(
    page(
      'Gestión fiscal para Paraguay',
      `<h1>Fisko</h1>
<p class="fecha">Tu gestión fiscal en Paraguay, sin planillas.</p>

<p>Fisko reúne tus facturas electrónicas y de papel, calcula tu IVA 5% y 10% y te arma los
reportes para tu declaración. Es una aplicación móvil operada por <strong>${EMPRESA}</strong>
(RUC ${RUC}).</p>

<h2>Qué hace</h2>
<ul>
  <li>Importa sola las facturas electrónicas (XML del SIFEN) que te llegan al correo.</li>
  <li>Lee las facturas de papel a partir de una foto.</li>
  <li>Te muestra el IVA 5% y 10%, tus ventas y compras, y una estimación del IRP.</li>
  <li>Genera reportes en PDF y Excel, listos para compartir con tu contador.</li>
  <li>Te avisa sobre tu IVA acumulado y su vencimiento.</li>
</ul>

<h2>Planes</h2>
<div class="planes">
${planes}
</div>
<p>Precios mensuales, en guaraníes. El plan Gratis no pide tarjeta.</p>

<h2>Cómo contratar</h2>
<ol>
  <li>Descargá la app Fisko y creá tu cuenta.</li>
  <li>En <em>Perfil → Mi plan</em>, elegí el plan.</li>
  <li>Pagás en la página segura de <strong>Pagopar</strong>, con los medios de pago que ofrece.
      Tus datos de pago no pasan por Fisko.</li>
  <li>El plan se activa al confirmarse el pago y dura un mes. No hay débito automático.</li>
</ol>
<p>Detalles de cobro, cancelación y reembolsos en los
<a href="/terminos">términos y condiciones</a>.</p>

<h2>Descargar</h2>
<p>Fisko está en su etapa final de pruebas. Muy pronto en Google Play y en la App Store.</p>`,
    ),
  );
});

/**
 * Terms of service, including billing, cancellation and refunds — what a
 * payment processor checks before enabling subscriptions, and what the stores
 * expect to find for a paid app.
 *
 * The renewal wording follows the implementation: a payment credits one month
 * and nothing is charged again automatically (see creditPaidOrder). If that
 * ever changes, this page must change with it.
 */
legalRouter.get('/terminos', (_req, res) => {
  res.type('html').send(
    page(
      'Términos y condiciones',
      `<h1>Términos y condiciones</h1>
<p class="fecha">Última actualización: ${ACTUALIZADO}</p>

<p>Estos términos regulan el uso de Fisko, aplicación de gestión fiscal operada por
<strong>${EMPRESA}</strong> (RUC ${RUC}). Al crear una cuenta los aceptás.</p>

<h2>El servicio</h2>
<p>Fisko organiza tus comprobantes, calcula el IVA y genera reportes a partir de los datos que vos
cargás o que importamos de tu correo. Es una herramienta de apoyo: <strong>no es asesoría contable
ni tributaria</strong> y no reemplaza tus obligaciones ante la DNIT ni el trabajo de tu contador.
Revisá siempre los montos antes de usarlos en una declaración.</p>

<h2>Tu cuenta</h2>
<p>Sos responsable de la información que cargás y de mantener tu contraseña en reserva. Podés
<a href="/eliminar-cuenta">eliminar tu cuenta</a> cuando quieras.</p>

<h2>Planes y precios</h2>
<p>El plan Gratis no tiene costo. Los planes pagos se cobran por mes, en guaraníes, al precio
publicado en la aplicación y en <a href="/">nuestra página</a> al momento de contratar.</p>

<h2>Pagos</h2>
<p>Los cobros los procesa <strong>Pagopar</strong>. Ingresás tus datos de pago en su plataforma;
Fisko no los recibe ni los guarda.</p>

<h2>Duración y renovación</h2>
<p>Cada pago habilita el plan por <strong>un mes</strong> desde que se confirma.
<strong>No hay débito automático</strong>: para continuar, volvés a pagar desde la app. Si no lo
hacés, la cuenta pasa al plan Gratis y tus facturas se conservan.</p>

<h2>Cancelación</h2>
<p>Como no hay renovación automática, no hace falta cancelar nada: basta con no volver a pagar. El
plan sigue activo hasta el final del mes ya pagado.</p>

<h2>Reembolsos</h2>
<ul>
  <li>Si pagaste y el plan <strong>no se activó</strong>, o se te cobró <strong>dos veces</strong>
      por el mismo período, te devolvemos el importe.</li>
  <li>Fuera de esos casos, no se reembolsan meses ya iniciados.</li>
  <li>Para pedirlo, escribinos a <a href="mailto:${CONTACTO}">${CONTACTO}</a> dentro de los
      30 días del cobro, con el comprobante de Pagopar.</li>
</ul>

<h2>Disponibilidad</h2>
<p>Hacemos lo posible por mantener Fisko disponible y sus cálculos correctos, pero pueden existir
interrupciones o errores de lectura, por ejemplo en fotos de facturas. Revisá los datos
importados.</p>

<h2>Cambios</h2>
<p>Si cambiamos estos términos o los precios, lo avisaremos en la aplicación antes de que se
apliquen a un nuevo período.</p>`,
    ),
  );
});
