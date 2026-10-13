import { Body, Controller, Delete, Get, HttpCode, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { clientSchema, contactSchema, equipmentSchema, PERMISSIONS, type ClientInput, type EquipmentInput } from '@hydrocrm/shared';
import { z } from 'zod';
import { CurrentUser, Perm } from '../common/decorators';
import type { AuthUser } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { ClientsService } from './clients.service';

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().trim().max(200).optional(),
  type: z.string().optional(),
  managerId: z.string().uuid().optional(),
  withOpenOrders: z.coerce.boolean().optional(),
  archived: z.coerce.boolean().optional(),
});
const versionQuery = z.object({ version: z.coerce.number().int().optional() });

@Controller()
class ClientsController {
  constructor(private readonly service: ClientsService) {}

  @Get('clients')
  @Perm(PERMISSIONS.clientsView)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(listQuery)) query: z.infer<typeof listQuery>) {
    return this.service.list(user, query);
  }

  @Get('clients/duplicates')
  @Perm(PERMISSIONS.clientsEdit)
  duplicates(@Query() q: { phone?: string; email?: string; inn?: string; excludeId?: string }) {
    return this.service.duplicates(q);
  }

  @Get('clients/:id')
  @Perm(PERMISSIONS.clientsView)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.get(user, id);
  }

  @Post('clients')
  @Perm(PERMISSIONS.clientsEdit)
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(clientSchema)) body: ClientInput) {
    return this.service.create(user, body);
  }

  @Patch('clients/:id')
  @Perm(PERMISSIONS.clientsEdit)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(clientSchema)) body: ClientInput,
    @Query(new ZodPipe(versionQuery)) q: z.infer<typeof versionQuery>,
  ) {
    return this.service.update(user, id, body, q.version);
  }

  @Post('clients/:id/archive')
  @HttpCode(204)
  @Perm(PERMISSIONS.clientsEdit)
  archive(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: { archived?: boolean }) {
    return this.service.archive(user, id, body?.archived !== false);
  }

  @Delete('clients/:id')
  @HttpCode(204)
  @Perm(PERMISSIONS.clientsEdit)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user, id);
  }

  @Post('clients/:id/contacts')
  @Perm(PERMISSIONS.clientsEdit)
  addContact(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(contactSchema)) body: z.infer<typeof contactSchema>) {
    return this.service.addContact(user, id, body);
  }

  @Patch('contacts/:id')
  @Perm(PERMISSIONS.clientsEdit)
  updateContact(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(contactSchema)) body: z.infer<typeof contactSchema>) {
    return this.service.updateContact(user, id, body);
  }

  @Delete('contacts/:id')
  @HttpCode(204)
  @Perm(PERMISSIONS.clientsEdit)
  removeContact(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.removeContact(user, id);
  }

  @Post('clients/:id/equipment')
  @Perm(PERMISSIONS.clientsEdit)
  addEquipment(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(equipmentSchema)) body: EquipmentInput) {
    return this.service.addEquipment(user, id, body);
  }

  @Get('equipment/:id')
  @Perm(PERMISSIONS.clientsView)
  getEquipment(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getEquipment(user, id);
  }

  @Patch('equipment/:id')
  @Perm(PERMISSIONS.clientsEdit)
  updateEquipment(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(equipmentSchema)) body: EquipmentInput) {
    return this.service.updateEquipment(user, id, body);
  }
}

@Module({ controllers: [ClientsController], providers: [ClientsService], exports: [ClientsService] })
export class ClientsModule {}
