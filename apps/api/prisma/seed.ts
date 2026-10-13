// Первый запуск рабочей системы: компания, роли, воронки, справочники и администратор.
// Запуск: pnpm db:seed. Данные администратора — из SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD.
import { randomBytes } from 'node:crypto';
import { createPrisma } from '../src/prisma/prisma.service';
import { seedCompany } from '../src/seed/base';

async function main() {
  const db = createPrisma();
  if (await db.company.count()) {
    console.log('Компания уже создана — seed пропущен.');
    return;
  }
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@hydrocrm.local';
  const password = process.env.SEED_ADMIN_PASSWORD ?? randomBytes(9).toString('base64url');
  const { company } = await seedCompany(db, {
    name: process.env.SEED_COMPANY_NAME ?? 'Моя компания',
    admin: { email, password, fullName: 'Администратор' },
  });
  console.log(`Компания «${company.name}» создана.`);
  console.log(`Вход: ${email}`);
  if (!process.env.SEED_ADMIN_PASSWORD) console.log(`Временный пароль: ${password} — смените его после входа.`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
