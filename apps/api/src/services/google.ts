import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env';
import { AppError } from '../errors/app-error';

export interface GoogleProfile {
  googleId: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

const client = env.GOOGLE_CLIENT_ID ? new OAuth2Client(env.GOOGLE_CLIENT_ID) : null;

/**
 * Verifies a Google ID token and returns the user's profile.
 * Throws if Google sign-in is not configured or the token is invalid.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
  if (!client || !env.GOOGLE_CLIENT_ID) {
    throw AppError.badRequest('Google sign-in is not configured on this server');
  }

  let payload;
  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    throw AppError.unauthorized('Invalid Google ID token');
  }

  if (!payload?.sub || !payload.email) {
    throw AppError.unauthorized('Google token missing required claims');
  }

  return {
    googleId: payload.sub,
    email: payload.email,
    name: payload.name ?? payload.email.split('@')[0] ?? 'User',
    emailVerified: payload.email_verified ?? false,
  };
}
