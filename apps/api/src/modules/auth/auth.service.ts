import { randomBytes, createHash } from 'node:crypto';
import argon2 from 'argon2';
import type { User } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { AppError } from '../../errors/app-error';
import { isValidRucDv } from '../../utils/ruc';
import { verifyGoogleIdToken } from '../../services/google';
import { sendPasswordResetEmail } from '../../services/mailer';
import { issueTokenPair, verifyRefreshToken, type TokenPair } from './tokens';
import type {
  ForgotPasswordInput,
  GoogleInput,
  LoginInput,
  RefreshInput,
  RegisterInput,
  ResetPasswordInput,
} from './auth.schemas';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  ruc: string | null;
  rucDv: number | null;
  emailVerified: boolean;
  createdAt: Date;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    ruc: user.ruc,
    rucDv: user.rucDv,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
  };
}

interface AuthResult {
  user: PublicUser;
  tokens: TokenPair;
}

function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function register(input: RegisterInput): Promise<AuthResult> {
  // RUC validation: if a RUC is provided, its check digit must be present and valid.
  if (input.ruc) {
    if (input.rucDv === undefined) {
      throw AppError.badRequest('rucDv is required when ruc is provided');
    }
    if (!isValidRucDv(input.ruc, input.rucDv)) {
      throw AppError.badRequest('Invalid RUC check digit (dDVEmi)');
    }
  }

  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw AppError.conflict('Email already registered');
  }

  const passwordHash = await argon2.hash(input.password);
  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash,
      ruc: input.ruc ?? null,
      rucDv: input.ruc ? (input.rucDv ?? null) : null,
    },
  });

  return { user: toPublicUser(user), tokens: issueTokenPair(user) };
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user || !user.passwordHash) {
    throw AppError.unauthorized('Invalid credentials');
  }

  const ok = await argon2.verify(user.passwordHash, input.password);
  if (!ok) {
    throw AppError.unauthorized('Invalid credentials');
  }

  return { user: toPublicUser(user), tokens: issueTokenPair(user) };
}

export async function googleAuth(input: GoogleInput): Promise<AuthResult> {
  const profile = await verifyGoogleIdToken(input.idToken);

  // Upsert: match by googleId first, then by email (link accounts).
  let user = await prisma.user.findFirst({
    where: { OR: [{ googleId: profile.googleId }, { email: profile.email }] },
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        email: profile.email,
        name: profile.name,
        googleId: profile.googleId,
        emailVerified: profile.emailVerified,
      },
    });
  } else if (!user.googleId) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        googleId: profile.googleId,
        emailVerified: user.emailVerified || profile.emailVerified,
      },
    });
  }

  return { user: toPublicUser(user), tokens: issueTokenPair(user) };
}

export async function refresh(input: RefreshInput): Promise<TokenPair> {
  const payload = verifyRefreshToken(input.refreshToken);
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });

  if (!user || user.tokenVersion !== payload.tokenVersion) {
    throw AppError.unauthorized('Refresh token is no longer valid');
  }

  return issueTokenPair(user);
}

/**
 * Always resolves without revealing whether the email exists (anti-enumeration).
 * When the user exists and has a password, a reset email is sent.
 */
export async function forgotPassword(input: ForgotPasswordInput): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user || !user.passwordHash) {
    logger.info({ email: input.email }, 'forgot-password requested for unknown/google-only account');
    return;
  }

  const rawToken = randomBytes(32).toString('hex');
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashResetToken(rawToken),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    },
  });

  // Fire-and-forget: email delivery must not block the HTTP response nor leak
  // existence via timing/failures. Errors are logged, never surfaced.
  void sendPasswordResetEmail(user.email, rawToken).catch((err) => {
    logger.error({ err, userId: user.id }, 'Failed to send password reset email');
  });
}

export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  const tokenHash = hashResetToken(input.token);
  const record = await prisma.passwordResetToken.findFirst({
    where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
  });

  if (!record) {
    throw AppError.badRequest('Invalid or expired reset token');
  }

  const passwordHash = await argon2.hash(input.newPassword);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      // Bump tokenVersion to invalidate existing refresh tokens after reset.
      data: { passwordHash, tokenVersion: { increment: 1 } },
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
  ]);
}

/** Invalidates all refresh tokens for the user by bumping tokenVersion. */
export async function logout(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
  });
}

export async function getMe(userId: string): Promise<PublicUser> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw AppError.notFound('User not found');
  }
  return toPublicUser(user);
}
