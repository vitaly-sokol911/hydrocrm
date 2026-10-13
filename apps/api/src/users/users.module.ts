import { Body, Controller, Get, Module, Param, Patch, Post } from '@nestjs/common';
import { PERMISSIONS, userCreateSchema, userUpdateSchema, type RoleCode, type UserCreateInput } from '@hydrocrm/shared';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthService, hashPassword } from '../auth/auth.service';
import { AppError } from '../common/app-error';
import { CurrentUser, Perm } from '../common/decorators';
import { currentCompanyId, type AuthUser } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';

const publicUser = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  position: true,
  isActive: true,
  lastLoginAt: true,
  roles: { select: { role: { select: { code: true } } } },
} as const;

type UserRow = { roles: { role: { code: string } }[] } & Record<string, unknown>;
const shape = (u: UserRow) => ({ ...u, roles: u.roles.map((r) => r.role.code as RoleCode) });

@Controller('users')
class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  /** Справочник сотрудников компании: интерфейс по нему подставляет имена ответственных и мастеров. */
  @Get()
  async list() {
    const users = await this.prisma.db.user.findMany({ select: publicUser, orderBy: { fullName: 'asc' } });
    return users.map(shape);
  }

  @Post()
  @Perm(PERMISSIONS.usersManage)
  async create(@Body(new ZodPipe(userCreateSchema)) body: UserCreateInput) {
    if (config.demoMode) throw new AppError('DEMO_RESTRICTED', 'В песочнице нельзя создавать пользователей');
    const db = this.prisma.db;
    if (await db.user.findUnique({ where: { email: body.email } })) {
      throw new AppError('CONFLICT', 'Пользователь с таким email уже есть', [{ field: 'email', reason: 'taken' }]);
    }
    const roles = await db.role.findMany({ where: { code: { in: body.roles } } });
    const user = await db.user.create({
      data: {
        companyId: currentCompanyId(),
        email: body.email,
        fullName: body.fullName,
        phone: body.phone,
        position: body.position,
        passwordHash: await hashPassword(body.password),
        mustChangePassword: true,
        roles: { create: roles.map((r) => ({ roleId: r.id })) },
      },
      select: publicUser,
    });
    await this.audit.log('create', 'user', user.id, { roles: [null, body.roles] });
    return shape(user);
  }

  @Patch(':id')
  @Perm(PERMISSIONS.usersManage)
  async update(
    @Param('id') id: string,
    @CurrentUser() me: AuthUser,
    @Body(new ZodPipe(userUpdateSchema)) body: z.infer<typeof userUpdateSchema>,
  ) {
    const db = this.prisma.db;
    const before = await db.user.findUniqueOrThrow({ where: { id }, include: { roles: { include: { role: true } } } });
    if (body.isActive === false && id === me.id) throw new AppError('VALIDATION_ERROR', 'Нельзя деактивировать самого себя');
    if (config.demoMode && body.roles?.includes('admin')) {
      throw new AppError('DEMO_RESTRICTED', 'В песочнице нельзя назначать администраторов');
    }
    const user = await db.$transaction(async (tx) => {
      if (body.roles) {
        const roles = await tx.role.findMany({ where: { code: { in: body.roles } } });
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userRole.createMany({ data: roles.map((r) => ({ userId: id, roleId: r.id })) });
      }
      return tx.user.update({
        where: { id },
        data: { fullName: body.fullName, phone: body.phone, position: body.position, isActive: body.isActive },
        select: publicUser,
      });
    });
    this.auth.invalidate(id);
    await this.audit.log('update', 'user', id, {
      ...AuditService.diff(before, body),
      ...(body.roles ? { roles: [before.roles.map((r) => r.role.code), body.roles] } : {}),
    });
    return shape(user);
  }
}

@Module({ controllers: [UsersController] })
export class UsersModule {}
