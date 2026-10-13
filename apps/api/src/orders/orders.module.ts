import { Body, Controller, Delete, Get, HttpCode, Module, Param, Patch, Post, Query } from '@nestjs/common';
import {
  approveEstimateSchema,
  commentSchema,
  orderAssigneesSchema,
  orderCreateSchema,
  orderItemSchema,
  orderItemUpdateSchema,
  orderUpdateSchema,
  PERMISSIONS,
  stageChangeSchema,
  type OrderCreateInput,
  type OrderItemInput,
  type StageChangeInput,
} from '@hydrocrm/shared';
import { z } from 'zod';
import { CurrentUser, Perm } from '../common/decorators';
import type { AuthUser } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { FeedService } from './feed.service';
import { OrdersService } from './orders.service';

const bool = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true');
const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  type: z.string().optional(),
  stageCode: z.string().optional(),
  managerId: z.string().uuid().optional(),
  masterId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  q: z.string().trim().max(200).optional(),
  overdue: bool,
  stuck: bool,
  open: bool,
  mine: bool,
  view: z.enum(['kanban', 'table']).optional(),
});
const commentEdit = z.object({ text: z.string().trim().min(1).max(10000) });

@Controller()
class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly feed: FeedService,
  ) {}

  @Get('orders')
  @Perm(PERMISSIONS.ordersView)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.orders.list(user, q);
  }

  @Get('orders/:id')
  @Perm(PERMISSIONS.ordersView)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.get(user, id);
  }

  @Post('orders')
  @Perm(PERMISSIONS.ordersCreate)
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(orderCreateSchema)) body: OrderCreateInput) {
    return this.orders.create(user, body);
  }

  @Patch('orders/:id')
  @Perm(PERMISSIONS.ordersEdit)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(orderUpdateSchema)) body: z.infer<typeof orderUpdateSchema>) {
    return this.orders.update(user, id, body);
  }

  @Post('orders/:id/assignees')
  @HttpCode(204)
  @Perm(PERMISSIONS.ordersAssign)
  assignees(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(orderAssigneesSchema)) body: z.infer<typeof orderAssigneesSchema>) {
    return this.orders.setAssignees(user, id, body);
  }

  @Post('orders/:id/stage')
  @HttpCode(200)
  @Perm(PERMISSIONS.ordersView)
  stage(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(stageChangeSchema)) body: StageChangeInput) {
    return this.orders.changeStage(user, id, body);
  }

  @Post('orders/:id/items')
  @Perm(PERMISSIONS.ordersView)
  addItem(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(orderItemSchema)) body: OrderItemInput) {
    return this.orders.addItem(user, id, body);
  }

  @Patch('order-items/:id')
  @HttpCode(204)
  @Perm(PERMISSIONS.ordersEditEstimate)
  updateItem(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(orderItemUpdateSchema)) body: Partial<OrderItemInput>) {
    return this.orders.updateItem(user, id, body);
  }

  @Delete('order-items/:id')
  @HttpCode(204)
  @Perm(PERMISSIONS.ordersEditEstimate)
  removeItem(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.removeItem(user, id);
  }

  @Post('orders/:id/approve-estimate')
  @HttpCode(204)
  @Perm(PERMISSIONS.ordersEditEstimate)
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(approveEstimateSchema)) body: z.infer<typeof approveEstimateSchema>) {
    return this.orders.approveEstimate(user, id, body);
  }

  // ---------- Лента ----------
  @Get('orders/:id/comments')
  @Perm(PERMISSIONS.ordersView)
  comments(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.feed.list(user, id);
  }

  @Post('orders/:id/comments')
  @Perm(PERMISSIONS.commentsWrite)
  addComment(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(commentSchema)) body: z.infer<typeof commentSchema>) {
    return this.feed.add(user, id, body.text, body.fileIds);
  }

  @Post('orders/:id/read')
  @HttpCode(204)
  @Perm(PERMISSIONS.ordersView)
  read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.feed.markRead(user, id);
  }

  @Patch('comments/:id')
  @Perm(PERMISSIONS.commentsWrite)
  editComment(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(commentEdit)) body: z.infer<typeof commentEdit>) {
    return this.feed.edit(user, id, body.text);
  }

  @Delete('comments/:id')
  @HttpCode(204)
  @Perm(PERMISSIONS.commentsWrite)
  async deleteComment(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.feed.edit(user, id, null);
  }
}

@Module({ controllers: [OrdersController], providers: [OrdersService, FeedService], exports: [OrdersService, FeedService] })
export class OrdersModule {}
