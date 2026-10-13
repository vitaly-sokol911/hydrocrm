// Демо-данные для песочницы (ДЕМ-3). ВНИМАНИЕ: полностью очищает базу. Запуск: pnpm db:demo
import { createPrisma } from '../src/prisma/prisma.service';
import { seedDemo } from '../src/demo/demo-data';

async function main() {
  const db = createPrisma();
  const started = Date.now();
  const stats = await seedDemo(db);
  console.log(`Демо-данные созданы за ${((Date.now() - started) / 1000).toFixed(1)} с:`, stats);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
