import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import type { Permission, RoleCode } from '@hydrocrm/shared';
import { createHash, randomBytes } from 'node:crypto';
import { AppError } from '../common/app-error';
import type { AuthUser } from '../common/request-context';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const USER_CACHE_MS = 60_000;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export const hashPassword = (password: string) => hash(password, { algorithm: 2 /* argon2id */ });

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

@Injectable()
export class AuthService {
  private readonly cache = new Map<string, { user: AuthUser; at: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /** АРХ-11: проверка пароля, блокировка после 5 неудачных попыток на 15 минут. */
  async login(email: string, password: string, meta: { ip?: string; userAgent?: string }): Promise<IssuedTokens> {
    const db = this.prisma.db;
    const user = await db.user.findUnique({ where: { email } });
    const invalid = new AppError('UNAUTHORIZED', 'Неверный email или пароль');
    if (!user || !user.isActive) throw invalid;
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError('ACCOUNT_LOCKED', 'Слишком много неудачных попыток. Попробуйте через 15 минут');
    }
    const ok = await verify(user.passwordHash, password).catch(() => false);
    if (!ok) {
      const failed = user.failedLogins + 1;
      await db.user.update({
        where: { id: user.id },
        data: {
          failedLogins: failed >= MAX_FAILED ? 0 : failed,
          lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
        },
      });
      await db.auditLog.create({
        data: { companyId: user.companyId, userId: user.id, action: 'login_failed', entityType: 'user', entityId: user.id, ip: meta.ip },
      });
      throw invalid;
    }
    return this.signIn(user.id, user.companyId, meta);
  }

  /** Вход в песочнице без пароля (ДЕМ-2). */
  async demoLogin(role: RoleCode, meta: { ip?: string; userAgent?: string }): Promise<IssuedTokens> {
    if (!config.demoMode) throw new AppError('FORBIDDEN', 'Вход по ролям доступен только в песочнице');
    const user = await this.prisma.db.user.findFirst({
      where: { isActive: true, roles: { some: { role: { code: role } } } },
      orderBy: { createdAt: 'asc' },
    });
    if (!user) throw new AppError('NOT_FOUND', 'В песочнице нет пользователя с такой ролью');
    return this.signIn(user.id, user.companyId, meta);
  }

  private async signIn(userId: string, companyId: string, meta: { ip?: string; userAgent?: string }) {
    const db = this.prisma.db;
    await db.user.update({ where: { id: userId }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    await db.auditLog.create({ data: { companyId, userId, action: 'login', entityType: 'user', entityId: userId, ip: meta.ip } });
    return this.issue(userId, companyId, meta);
  }

  private async issue(userId: string, companyId: string, meta: { ip?: string; userAgent?: string }): Promise<IssuedTokens> {
    const accessToken = await this.jwt.signAsync({ sub: userId, cid: companyId }, { expiresIn: config.accessTtlSec });
    const refreshToken = randomBytes(48).toString('base64url');
    const refreshExpiresAt = new Date(Date.now() + config.refreshTtlDays * 86_400_000);
    await this.prisma.db.refreshToken.create({
      data: { userId, tokenHash: sha256(refreshToken), expiresAt: refreshExpiresAt, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 300) },
    });
    return { accessToken, refreshToken, refreshExpiresAt };
  }

  /** АРХ-12: ротация refresh-токена. Повторное использование отозванного токена отзывает все сессии пользователя. */
  async refresh(token: string | undefined, meta: { ip?: string; userAgent?: string }): Promise<IssuedTokens> {
    const unauthorized = new AppError('UNAUTHORIZED', 'Сессия истекла, войдите снова');
    if (!token) throw unauthorized;
    const db = this.prisma.db;
    const row = await db.refreshToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    if (!row) throw unauthorized;
    if (row.revokedAt) {
      await db.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw unauthorized;
    }
    if (row.expiresAt < new Date() || !row.user.isActive) throw unauthorized;
    await db.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    return this.issue(row.userId, row.user.companyId, meta);
  }

  async logout(token: string | undefined) {
    if (!token) return;
    await this.prisma.db.refreshToken.updateMany({ where: { tokenHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async changePassword(userId: string, current: string, next: string) {
    if (config.demoMode) throw new AppError('DEMO_RESTRICTED', 'В песочнице пароли не меняются');
    const db = this.prisma.db;
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verify(user.passwordHash, current).catch(() => false))) {
      throw new AppError('VALIDATION_ERROR', 'Текущий пароль указан неверно', [{ field: 'currentPassword', reason: 'invalid' }]);
    }
    await db.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next), mustChangePassword: false } });
    this.invalidate(userId);
  }

  /** Пользователь по access-токену. Права берутся из БД с кешем на минуту (API-11). */
  async authenticate(accessToken: string): Promise<AuthUser> {
    let payload: { sub: string; cid: string };
    try {
      payload = await this.jwt.verifyAsync(accessToken);
    } catch {
      throw new AppError('UNAUTHORIZED', 'Требуется вход');
    }
    const cached = this.cache.get(payload.sub);
    if (cached && Date.now() - cached.at < USER_CACHE_MS) return cached.user;
    const user = await this.prisma.db.user.findUnique({
      where: { id: payload.sub },
      include: { roles: { include: { role: true } } },
    });
    if (!user || !user.isActive) throw new AppError('UNAUTHORIZED', 'Требуется вход');
    const auth: AuthUser = {
      id: user.id,
      companyId: user.companyId,
      fullName: user.fullName,
      email: user.email,
      roles: user.roles.map((r) => r.role.code as RoleCode),
      permissions: new Set(user.roles.flatMap((r) => r.role.permissions as Permission[])),
    };
    this.cache.set(user.id, { user: auth, at: Date.now() });
    return auth;
  }

  invalidate(userId?: string) {
    if (userId) this.cache.delete(userId);
    else this.cache.clear();
  }
}
