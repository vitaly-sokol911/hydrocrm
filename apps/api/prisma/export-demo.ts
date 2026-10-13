// Снимок демо-данных для статической демо-сборки (GitHub Pages, без сервера).
// Пересоздаёт демо в локальной БД и сохраняет таблицы в apps/web/public/demo/snapshot.json.
// Пароли, refresh-токены и журнал действий в снимок не попадают.
// Запуск: pnpm --filter @hydrocrm/api export:demo
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPrisma } from '../src/prisma/prisma.service';
import { seedDemo } from '../src/demo/demo-data';

const OUT = resolve(__dirname, '../../web/public/demo/snapshot.json');

function plain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)));
}

async function main() {
  const db = createPrisma();
  await seedDemo(db);
  const users = await db.user.findMany({ where: { isActive: true }, orderBy: { createdAt: 'asc' } });
  const snapshot = {
    exportedAt: new Date().toISOString(),
    company: await db.company.findFirstOrThrow(),
    roles: await db.role.findMany(),
    users: users.map(({ passwordHash, failedLogins, lockedUntil, mustChangePassword, ...u }) => {
      void passwordHash;
      void failedLogins;
      void lockedUntil;
      void mustChangePassword;
      return u;
    }),
    userRoles: await db.userRole.findMany({ where: { userId: { in: users.map((u) => u.id) } } }),
    leadSources: await db.leadSource.findMany(),
    rejectReasons: await db.rejectReason.findMany(),
    pipelines: await db.pipeline.findMany(),
    stages: await db.stage.findMany({ orderBy: { sort: 'asc' } }),
    clients: await db.client.findMany(),
    contacts: await db.contact.findMany(),
    equipment: await db.equipment.findMany(),
    leads: await db.lead.findMany(),
    orders: await db.order.findMany(),
    orderAssignees: await db.orderAssignee.findMany(),
    orderStageHistory: await db.orderStageHistory.findMany({ orderBy: { changedAt: 'asc' } }),
    orderItems: await db.orderItem.findMany(),
    orderApprovals: await db.orderApproval.findMany(),
    visits: await db.visit.findMany(),
    visitAssignees: await db.visitAssignee.findMany(),
    comments: await db.comment.findMany({ orderBy: { createdAt: 'asc' } }),
    tasks: await db.task.findMany(),
    notifications: await db.notification.findMany(),
    chatChannels: await db.chatChannel.findMany(),
    chatMembers: await db.chatMember.findMany(),
    chatMessages: await db.chatMessage.findMany({ orderBy: { createdAt: 'asc' } }),
    counters: await db.counter.findMany(),
  };
  mkdirSync(resolve(OUT, '..'), { recursive: true });
  const json = JSON.stringify(plain(snapshot));
  writeFileSync(OUT, json);
  console.log(`Снимок сохранён: ${OUT} (${(json.length / 1024).toFixed(0)} КБ)`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
