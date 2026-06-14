import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../lib/logger';

let transporterPromise: Promise<Transporter> | null = null;

/**
 * Lazily builds a nodemailer transport.
 * - If SMTP_* env vars are set, uses that provider.
 * - Otherwise (dev/homologação) creates an Ethereal test account on the fly.
 */
async function getTransporter(): Promise<Transporter> {
  if (transporterPromise) return transporterPromise;

  transporterPromise = (async () => {
    if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) {
      return nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT ?? 587,
        secure: (env.SMTP_PORT ?? 587) === 465,
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      });
    }

    // Dev fallback: Ethereal captures the email and gives a preview URL.
    const testAccount = await nodemailer.createTestAccount();
    logger.info(
      { user: testAccount.user },
      'SMTP not configured — using Ethereal test account (preview URLs will be logged)',
    );
    return nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
  })();

  return transporterPromise;
}

export interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendMail(input: SendMailInput): Promise<void> {
  const transporter = await getTransporter();
  const info = await transporter.sendMail({
    from: env.SMTP_FROM,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html ?? input.text,
  });

  const preview = nodemailer.getTestMessageUrl(info);
  if (preview) {
    logger.info({ to: input.to, preview }, 'Email sent (Ethereal preview available)');
  } else {
    logger.info({ to: input.to, messageId: info.messageId }, 'Email sent');
  }
}

/**
 * Sends the password-reset email. Presents the raw token as a code the user
 * pastes into the app's "Nueva contraseña" screen (the token is only stored
 * hashed on the server). No web reset page exists yet, so we don't link out.
 */
export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  await sendMail({
    to,
    subject: 'Fisko — Código para restablecer tu contraseña',
    text:
      `Recibimos una solicitud para restablecer tu contraseña.\n\n` +
      `Tu código de recuperación es:\n\n${token}\n\n` +
      `Cómo usarlo: abrí la app Fisko → "¿Olvidaste tu contraseña?" → "Ya tengo un código", ` +
      `pegá este código y definí tu nueva contraseña. El código vence en 1 hora.\n\n` +
      `Si no fuiste vos, podés ignorar este mensaje.`,
    html:
      `<p>Recibimos una solicitud para restablecer tu contraseña.</p>` +
      `<p>Tu código de recuperación es:</p>` +
      `<p style="font-family:monospace;font-size:14px;word-break:break-all;` +
      `background:#f2f2f2;padding:12px;border-radius:8px">${token}</p>` +
      `<p>Abrí la app Fisko → <b>"¿Olvidaste tu contraseña?"</b> → <b>"Ya tengo un código"</b>, ` +
      `pegá este código y definí tu nueva contraseña. El código vence en 1 hora.</p>` +
      `<p>Si no fuiste vos, podés ignorar este mensaje.</p>`,
  });
}
