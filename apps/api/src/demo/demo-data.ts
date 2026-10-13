import { calcEstimate, normalizePhone, type OrderType, type RoleCode } from '@hydrocrm/shared';
import type { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../auth/auth.service';
import type { Db } from '../prisma/prisma.service';
import { seedCompany } from '../seed/base';

/**
 * Демо-данные песочницы (ДЕМ-3): правдоподобная картина работы сервиса гидравлики.
 * Все люди и компании вымышлены. Даты считаются от «сейчас», поэтому данные всегда свежие.
 * Генератор детерминированный: при каждом сбросе получается одна и та же картина.
 */

// ---------- Детерминированный генератор ----------
let seed = 20261013;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
const int = (min: number, max: number) => Math.floor(min + rnd() * (max - min + 1));
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const rub = (n: number) => Math.round(n * 100);

/** Сдвиг на рабочее время: демо-события не происходят ночью. */
function workTime(ts: number): Date {
  const d = new Date(ts);
  const h = d.getHours();
  if (h < 9) d.setHours(9 + int(0, 2), int(0, 59));
  if (h >= 19) d.setHours(int(15, 18), int(0, 59));
  const day = d.getDay();
  if (day === 0) d.setDate(d.getDate() - 2);
  if (day === 6) d.setDate(d.getDate() - 1);
  return d;
}

/** ИНН с правильной контрольной суммой. */
function makeInn(len: 10 | 12): string {
  const d = Array.from({ length: len }, (_, i) => (i === 0 ? int(1, 9) : int(0, 9)));
  const check = (coefs: number[]) => (coefs.reduce((s, c, i) => s + c * d[i], 0) % 11) % 10;
  if (len === 10) d[9] = check([2, 4, 10, 3, 5, 9, 4, 6, 8]);
  else {
    d[10] = check([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]);
    d[11] = check([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]);
  }
  return d.join('');
}
const phone = () => normalizePhone(`+7 9${int(10, 99)} ${int(100, 999)} ${int(10, 99)} ${int(10, 99)}`)!;

// ---------- Справочные данные ----------
const STAFF: { name: string; email: string; role: RoleCode; position: string }[] = [
  { name: 'Андрей Соколов', email: 'director', role: 'director', position: 'Директор' },
  { name: 'Елена Ковалёва', email: 'manager', role: 'manager', position: 'Менеджер по продажам' },
  { name: 'Дмитрий Белов', email: 'belov', role: 'manager', position: 'Менеджер по продажам' },
  { name: 'Марина Орлова', email: 'orlova', role: 'manager', position: 'Менеджер сервиса' },
  { name: 'Сергей Петров', email: 'master', role: 'master', position: 'Старший мастер' },
  { name: 'Алексей Кузнецов', email: 'kuznetsov', role: 'master', position: 'Мастер-гидравлик' },
  { name: 'Иван Морозов', email: 'morozov', role: 'master', position: 'Мастер-гидравлик' },
  { name: 'Николай Волков', email: 'volkov', role: 'master', position: 'Выездной мастер' },
  { name: 'Артём Зайцев', email: 'zaitsev', role: 'master', position: 'Мастер-сборщик' },
  { name: 'Ольга Лебедева', email: 'accountant', role: 'accountant', position: 'Бухгалтер' },
  { name: 'Татьяна Никитина', email: 'nikitina', role: 'accountant', position: 'Офис-администратор' },
];

const COMPANIES = [
  { name: 'ООО «СтальПрофиль»', city: 'Екатеринбург', industry: 'металлообработка' },
  { name: 'АО «Металлист-Пресс»', city: 'Челябинск', industry: 'прессовое производство' },
  { name: 'ООО «ТехноЛит»', city: 'Каменск-Уральский', industry: 'литьё под давлением' },
  { name: 'ООО «Агрохолдинг Колос»', city: 'Курган', industry: 'сельхозтехника' },
  { name: 'ООО «СтройМеханизация-96»', city: 'Екатеринбург', industry: 'спецтехника' },
  { name: 'ООО «Уральский завод пластмасс»', city: 'Первоуральск', industry: 'термопластавтоматы' },
  { name: 'АО «ЛесПромРесурс»', city: 'Серов', industry: 'лесозаготовка' },
  { name: 'ООО «Полимер-Форм»', city: 'Тюмень', industry: 'экструзия' },
  { name: 'ООО «ДорСтройТех»', city: 'Пермь', industry: 'дорожная техника' },
  { name: 'ООО «Энергомаш-Сервис»', city: 'Екатеринбург', industry: 'энергетика' },
  { name: 'ООО «КузнечныйДвор»', city: 'Нижний Тагил', industry: 'кузнечно-прессовое' },
  { name: 'ООО «ПищеМашСервис»', city: 'Екатеринбург', industry: 'пищевое оборудование' },
  { name: 'АО «Карьер Северный»', city: 'Асбест', industry: 'горная техника' },
  { name: 'ООО «ЛифтМонтаж»', city: 'Екатеринбург', industry: 'подъёмное оборудование' },
  { name: 'ООО «ТрубоСвар»', city: 'Полевской', industry: 'трубное производство' },
  { name: 'ООО «ВторМетКомплекс»', city: 'Березовский', industry: 'пакетировочные прессы' },
];
const DEALERS = [
  { name: 'ООО «ГидроСнаб-Урал»', city: 'Екатеринбург' },
  { name: 'ООО «Гидравлика Опт»', city: 'Челябинск' },
  { name: 'ООО «ТехПривод Сибирь»', city: 'Тюмень' },
];
const IPS = ['ИП Гарипов Ринат Фаритович', 'ИП Семёнов Павел Игоревич', 'ИП Хасанова Алина Рустемовна', 'ИП Ершов Константин Олегович', 'ИП Тимофеев Виктор Андреевич'];
const PEOPLE = [
  'Смирнов Олег Владимирович',
  'Карпов Денис Сергеевич',
  'Фёдоров Михаил Юрьевич',
  'Данилова Светлана Петровна',
  'Яковлев Роман Алексеевич',
  'Шарипов Ильдар Маратович',
  'Григорьев Евгений Николаевич',
  'Полякова Наталья Викторовна',
];
const CONTACT_NAMES = ['Глебов Антон', 'Рябова Ирина', 'Мельников Юрий', 'Ефимов Станислав', 'Титова Оксана', 'Борисов Вадим', 'Комаров Артур', 'Зуева Кристина', 'Савельев Георгий', 'Носов Леонид'];
const CONTACT_POSITIONS = ['Главный механик', 'Главный инженер', 'Начальник цеха', 'Механик участка', 'Снабженец', 'Энергетик'];

const STATIONS: { name: string; manufacturer: string; model: string; pressure: [number, number]; flow: [number, number]; tank: number[]; power: number[] }[] = [
  { name: 'Гидростанция пресса', manufacturer: 'Bosch Rexroth', model: 'ABPAC-63', pressure: [160, 250], flow: [40, 90], tank: [160, 250, 400], power: [15, 22, 30] },
  { name: 'Маслостанция термопластавтомата', manufacturer: 'Haitian', model: 'MA-1600 HPU', pressure: [140, 175], flow: [60, 110], tank: [250, 400], power: [18.5, 22, 30] },
  { name: 'Насосная станция СНГ', manufacturer: 'Гидросила', model: 'СНГ-40', pressure: [100, 200], flow: [25, 60], tank: [63, 100, 160], power: [5.5, 7.5, 11] },
  { name: 'Гидростанция подъёмника', manufacturer: 'Hydac', model: 'HPU-MINI 2.2', pressure: [120, 180], flow: [4, 12], tank: [10, 20, 40], power: [1.5, 2.2, 3] },
  { name: 'Маслостанция станка', manufacturer: 'Parker', model: 'PV-HPU 016', pressure: [60, 120], flow: [16, 32], tank: [40, 63, 100], power: [3, 4, 5.5] },
  { name: 'Гидростанция манипулятора', manufacturer: 'Danfoss', model: 'OMP-HPU 32', pressure: [180, 210], flow: [30, 50], tank: [100, 160], power: [11, 15] },
  { name: 'Гидростанция пакетировочного пресса', manufacturer: 'Пневмостроймашина', model: 'СГ-160', pressure: [200, 280], flow: [80, 160], tank: [400, 630], power: [37, 45, 55] },
  { name: 'Насосная станция гидроцилиндров', manufacturer: 'Vickers', model: 'PVQ-HPU 20', pressure: [100, 160], flow: [20, 45], tank: [63, 100], power: [5.5, 7.5] },
];

const COMPLAINTS = [
  { title: 'Не набирает рабочее давление', text: 'Давление поднимается только до 90 бар вместо 160, пресс не дожимает.' },
  { title: 'Течь масла по валу насоса', text: 'Под насосом лужа масла, за смену уходит около литра.' },
  { title: 'Перегрев масла', text: 'Через час работы масло греется выше 70 °C, станок встаёт по аварии.' },
  { title: 'Сильный шум и вибрация насоса', text: 'Насос гудит и вибрирует, на манометре скачет стрелка. Подозреваем кавитацию.' },
  { title: 'Не срабатывает распределитель', text: 'Цилиндр не выдвигается, катушку слышно, но золотник не переключается.' },
  { title: 'Загрязнение масла, забит фильтр', text: 'Горит индикатор засорения фильтра, масло тёмное, с металлической взвесью.' },
  { title: 'Порыв РВД, падение давления', text: 'Лопнул шланг высокого давления, после замены давление не держится.' },
  { title: 'Самопроизвольное опускание цилиндра', text: 'Под нагрузкой цилиндр медленно опускается, держит 2–3 минуты.' },
  { title: 'Не запускается электродвигатель', text: 'Двигатель гудит и не крутится, срабатывает автомат.' },
  { title: 'Плановое ТО гидростанции', text: 'Замена масла и фильтров, проверка клапанов и настройка давления.' },
];

const WORKS = [
  { name: 'Диагностика гидростанции', price: 3500, unit: 'шт' },
  { name: 'Разборка и дефектовка насоса', price: 6000, unit: 'шт' },
  { name: 'Ремонт аксиально-поршневого насоса', price: 18000, unit: 'шт' },
  { name: 'Замена уплотнений гидроцилиндра', price: 4500, unit: 'шт' },
  { name: 'Промывка гидросистемы', price: 8000, unit: 'шт' },
  { name: 'Настройка предохранительного клапана', price: 2500, unit: 'шт' },
  { name: 'Замена масла и фильтроэлементов', price: 3000, unit: 'шт' },
  { name: 'Испытания на стенде', price: 4000, unit: 'шт' },
  { name: 'Ремонт распределителя', price: 5500, unit: 'шт' },
  { name: 'Работы мастера', price: 2200, unit: 'ч' },
];
const PARTS = [
  { name: 'Комплект уплотнений насоса НШ-32', price: 1800, cost: 950 },
  { name: 'Насос аксиально-поршневой A10VSO28', price: 145000, cost: 112000 },
  { name: 'Ремкомплект насоса A10VSO28', price: 24500, cost: 16800 },
  { name: 'Фильтроэлемент напорный 0160D010BN4HC', price: 6500, cost: 4100 },
  { name: 'Фильтр сливной MPF 180', price: 4800, cost: 2900 },
  { name: 'Распределитель 4WE6 24В', price: 12800, cost: 8900 },
  { name: 'Катушка распределителя 24В DC', price: 3200, cost: 1900 },
  { name: 'Масло гидравлическое HLP 46, 20 л', price: 5200, cost: 3600 },
  { name: 'РВД 2SN Ду16, 1,5 м', price: 2400, cost: 1300 },
  { name: 'Клапан предохранительный DBDS 10', price: 7300, cost: 4700 },
  { name: 'Манометр 0–250 бар с демпфером', price: 1200, cost: 650 },
  { name: 'Электродвигатель АИР100L4 4 кВт', price: 18500, cost: 13900 },
  { name: 'Муфта насоса с полумуфтами', price: 3900, cost: 2300 },
  { name: 'Теплообменник масло-воздух AKG', price: 28000, cost: 19500 },
  { name: 'Обратный клапан RVP 16', price: 2100, cost: 1200 },
];

const DIAG_COMMENTS = [
  'Разобрали насос: износ блока цилиндров и распределительного диска, задиры на поршнях. Нужен ремкомплект.',
  'Предохранительный клапан залипает, седло изношено. Клапан под замену.',
  'Масло сильно загрязнено, фильтр не меняли больше года. Рекомендую промывку системы.',
  'Манжета вала порвана, вал без выработки — меняем уплотнения, насос живой.',
  'Катушка распределителя в обрыве, золотник ходит нормально. Меняем катушку.',
  'Теплообменник забит пылью и маслом, вентилятор не крутится — отсюда перегрев.',
];
const MANAGER_COMMENTS = [
  'Позвонил клиенту, смету озвучил. Просят скидку 5% — согласовал с руководителем.',
  'Клиент просит ускорить, у них стоит линия. Можно взять в приоритет?',
  'Отправил смету на почту главному механику, ждём ответ до завтра.',
  'Запчасти заказаны у поставщика, обещают поставку через 3 дня.',
  'Клиент заберёт сам в пятницу после обеда.',
];
const MASTER_COMMENTS = [
  'Собрали, выставили давление 160 бар, течей нет. Отдаю на стенд.',
  'На стенде держит давление, температура масла после часа работы 52 °C.',
  'Ждём уплотнения, без них дальше не продвинемся.',
  'Насос промыли, поставили новый фильтроэлемент.',
];

// ---------- Очистка ----------
async function wipe(db: Db) {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (!tables.length) return;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

// ---------- Генерация ----------
export async function seedDemo(db: Db) {
  seed = 20261013;
  await wipe(db);
  const now = Date.now();

  const { company, roles, admin } = await seedCompany(db, {
    name: 'ГидроПрофи (демо)',
    legalName: 'ООО «ГидроПрофи»',
    inn: makeInn(10),
    phone: '+73430000000',
    email: 'service@demo.hydrocrm.ru',
    address: 'г. Екатеринбург, ул. Промышленная, 12',
    admin: { email: 'admin@demo.hydrocrm.ru', password: randomBytes(12).toString('hex'), fullName: 'Администратор песочницы' },
  });
  const companyId = company.id;
  // Администратор песочницы не нужен для входа по ролям — оставляем только для настроек.
  await db.user.update({ where: { id: admin.id }, data: { isActive: false } });

  // Сотрудники
  const pw = await hashPassword(randomBytes(12).toString('hex'));
  const users: Record<string, { id: string; name: string; role: RoleCode }> = {};
  for (const [i, s] of STAFF.entries()) {
    const u = await db.user.create({
      data: {
        companyId,
        email: `${s.email}@demo.hydrocrm.ru`,
        fullName: s.name,
        position: s.position,
        phone: phone(),
        passwordHash: pw,
        lastLoginAt: new Date(now - int(0, 3) * DAY),
        createdAt: new Date(now - (200 - i) * DAY),
        roles: { create: [{ roleId: roles[s.role] }, ...(s.role === 'director' ? [{ roleId: roles.admin }] : [])] },
      },
    });
    users[s.email] = { id: u.id, name: s.name, role: s.role };
  }
  const managers = STAFF.filter((s) => s.role === 'manager').map((s) => users[s.email]);
  const workshopMasters = ['master', 'kuznetsov', 'morozov'].map((k) => users[k]);
  const fieldMaster = users.volkov;
  const assembler = users.zaitsev;
  const director = users.director;

  const sources = await db.leadSource.findMany({ where: { companyId } });
  const source = (name: string) => sources.find((s) => s.name === name)!.id;
  const reasons = await db.rejectReason.findMany({ where: { companyId } });
  const pipelines = await db.pipeline.findMany({ where: { companyId }, include: { stages: { orderBy: { sort: 'asc' } } } });
  const pipeline = (t: OrderType) => pipelines.find((p) => p.orderType === t)!;

  // Клиенты и оборудование
  type ClientRef = { id: string; name: string; managerId: string; address: string; equipment: { id: string; name: string }[]; contactId?: string };
  const clients: ClientRef[] = [];
  const addClient = async (type: 'person' | 'ip' | 'company' | 'dealer', name: string, city: string, eqCount: number) => {
    const manager = pick(managers);
    const isLegal = type !== 'person';
    const street = pick(['Индустриальная', 'Заводская', 'Монтажников', 'Складская', 'Транспортная', 'Машиностроителей']);
    const address = `г. ${city}, ул. ${street}, ${int(1, 120)}`;
    const createdAt = new Date(now - int(30, 400) * DAY);
    const c = await db.client.create({
      data: {
        companyId,
        type,
        name,
        legalName: type === 'company' || type === 'dealer' ? name : type === 'ip' ? name : null,
        inn: type === 'company' || type === 'dealer' ? makeInn(10) : type === 'ip' ? makeInn(12) : null,
        kpp: type === 'company' || type === 'dealer' ? `${int(10, 99)}${int(10, 99)}01001` : null,
        legalAddress: isLegal ? address : null,
        phone: phone(),
        email: isLegal ? `info@${['stal', 'metall', 'tehno', 'agro', 'stroy', 'plast', 'les', 'poly', 'dor', 'energo'][int(0, 9)]}${int(10, 99)}.ru` : null,
        address,
        managerId: manager.id,
        sourceId: source(pick(['Звонок', 'Сайт', 'Рекомендация', 'Повторный клиент', 'Авито', 'Почта'])),
        paymentTermsDays: type === 'dealer' ? 14 : type === 'company' ? pick([0, 0, 7, 10]) : 0,
        pdConsentAt: type === 'person' ? createdAt : null,
        tags: type === 'dealer' ? ['дилер'] : type === 'company' && rnd() > 0.6 ? ['ключевой'] : [],
        createdById: manager.id,
        createdAt,
      },
    });
    const ref: ClientRef = { id: c.id, name, managerId: manager.id, address, equipment: [] };
    if (isLegal) {
      const contact = await db.contact.create({
        data: { clientId: c.id, fullName: pick(CONTACT_NAMES), position: pick(CONTACT_POSITIONS), phone: phone(), isPrimary: true },
      });
      ref.contactId = contact.id;
      if (rnd() > 0.5) await db.contact.create({ data: { clientId: c.id, fullName: pick(CONTACT_NAMES), position: 'Снабженец', phone: phone() } });
    }
    for (let i = 0; i < eqCount; i++) {
      const st = pick(STATIONS);
      const e = await db.equipment.create({
        data: {
          clientId: c.id,
          name: `${st.name}${eqCount > 1 ? ` №${i + 1}` : ''}`,
          manufacturer: st.manufacturer,
          model: st.model,
          serialNumber: `${st.model.replace(/[^A-ZА-Я0-9]/gi, '').slice(0, 4).toUpperCase()}-${int(2014, 2024)}-${int(10000, 99999)}`,
          year: int(2012, 2024),
          pressureBar: int(st.pressure[0], st.pressure[1]),
          flowLpm: int(st.flow[0], st.flow[1]),
          tankVolumeL: pick(st.tank),
          motorPowerKw: pick(st.power),
          voltage: '380 В',
          location: isLegal ? pick(['Цех №1', 'Цех №2', 'Прессовый участок', 'Участок литья', 'Гараж техники']) : null,
          createdAt,
        },
      });
      ref.equipment.push({ id: e.id, name: e.name });
    }
    clients.push(ref);
    return ref;
  };
  for (const c of COMPANIES) await addClient('company', c.name, c.city, int(1, 3));
  for (const d of DEALERS) await addClient('dealer', d.name, d.city, 1);
  for (const p of IPS) await addClient('ip', p, pick(['Екатеринбург', 'Верхняя Пышма', 'Ревда', 'Арамиль']), 1);
  for (const p of PEOPLE) await addClient('person', p, pick(['Екатеринбург', 'Сысерть', 'Берёзовский']), 1);
  const ownStock = await db.client.create({ data: { companyId, type: 'company', name: 'Собственный склад', note: 'Сборка типовых станций на склад', createdAt: new Date(now - 300 * DAY) } });

  // ---------- Заказы ----------
  let orderNo = 0;
  const orderNumbers: Record<number, number> = {};
  const nextOrderNumber = (date: Date) => {
    const y = date.getFullYear();
    orderNumbers[y] = (orderNumbers[y] ?? 0) + 1;
    orderNo++;
    return `З-${y}-${String(orderNumbers[y]).padStart(4, '0')}`;
  };

  interface OrderSpec {
    type: OrderType;
    client: ClientRef | { id: string; name: string; managerId: string; address: string; equipment: { id: string; name: string }[]; contactId?: string };
    stage: string;
    /** Сколько дней назад создан. */
    age: number;
    /** Сколько часов заказ уже на текущем этапе. */
    onStageHours: number;
    masters: { id: string }[];
    optional?: string[];
    title?: string;
    complaint?: string;
    priority?: 'low' | 'normal' | 'high' | 'urgent';
    lostAt?: string;
    warranty?: boolean;
    extraPending?: boolean;
    proposedPending?: boolean;
  }

  const created: { id: string; number: string; type: OrderType; stage: string; managerId: string; clientId: string; masters: string[]; title: string }[] = [];

  async function makeOrder(spec: OrderSpec) {
    const p = pipeline(spec.type);
    const target = p.stages.find((s) => s.code === spec.stage)!;
    const optionalSkip = new Set(['awaiting_unit', 'awaiting_parts', 'estimate', 'contract', 'moved_to_workshop']);
    const lostStage = p.stages.find((s) => s.kind === 'lost')!;
    const pathStages = (upTo: (typeof p.stages)[number]) =>
      p.stages.filter((s) => s.kind === 'open' && s.sort <= upTo.sort && (!optionalSkip.has(s.code) || spec.optional?.includes(s.code) || s.code === upTo.code));
    let path: (typeof p.stages)[number][];
    if (target.kind === 'lost') {
      const lostFrom = p.stages.find((s) => s.code === (spec.lostAt ?? 'estimate'))!;
      path = [...pathStages(lostFrom), lostStage];
    } else if (target.kind === 'won') {
      const lastOpen = [...p.stages].reverse().find((s) => s.kind === 'open')!;
      path = [...pathStages(lastOpen), target];
    } else path = pathStages(target);

    const createdAt = workTime(now - spec.age * DAY);
    const enteredTarget = Math.max(createdAt.getTime() + HOUR, now - spec.onStageHours * HOUR);
    const step = (enteredTarget - createdAt.getTime()) / Math.max(1, path.length - 1);
    // Сдвиг на рабочее время может нарушить порядок — делаем время событий строго возрастающим.
    const times: Date[] = [];
    path.forEach((_, i) => {
      const t = i === 0 ? createdAt : workTime(createdAt.getTime() + step * i);
      const min = i === 0 ? 0 : times[i - 1].getTime() + 20 * 60_000;
      times.push(new Date(Math.min(now - 5 * 60_000, Math.max(t.getTime(), min))));
    });
    const complaint = spec.complaint ? { title: spec.title ?? spec.complaint, text: spec.complaint } : pick(COMPLAINTS);
    const equipment = spec.client.equipment.length ? pick(spec.client.equipment) : null;
    const number = nextOrderNumber(createdAt);
    const manager = spec.client.managerId;
    const reached = (code: string) => path.some((s) => s.code === code);
    const estimateReached = reached('estimate') || reached('calculation') || reached('invoice') || reached('visit_done') || reached('on_site');

    // Смета
    const items: Prisma.OrderItemCreateWithoutOrderInput[] = [];
    if (spec.type === 'assembly_custom' || spec.type === 'assembly_standard') {
      items.push(
        { kind: 'part', name: pick(PARTS.filter((x) => x.price > 10000)).name, quantity: 1, unit: 'шт', priceKop: rub(int(90, 160) * 1000), costKop: rub(int(60, 85) * 1000) },
        { kind: 'part', name: 'Бак 160 л с крышкой и арматурой', quantity: 1, unit: 'шт', priceKop: rub(38000), costKop: rub(24500) },
        { kind: 'part', name: 'Электродвигатель АИР132S4 7,5 кВт', quantity: 1, unit: 'шт', priceKop: rub(31500), costKop: rub(23800) },
        { kind: 'part', name: 'Блок управления с распределителями 4WE10', quantity: 1, unit: 'компл', priceKop: rub(54000), costKop: rub(37000) },
        { kind: 'work', name: 'Сборка гидростанции', quantity: 1, unit: 'шт', priceKop: rub(45000), costKop: rub(12000) },
        { kind: 'work', name: 'Испытания и настройка', quantity: 1, unit: 'шт', priceKop: rub(9000), costKop: rub(2500) },
      );
    } else {
      items.push({ kind: 'work', name: 'Диагностика гидростанции', quantity: 1, unit: 'шт', priceKop: rub(3500), costKop: rub(800) });
      const nWorks = int(1, 3);
      for (let i = 0; i < nWorks; i++) {
        const w = pick(WORKS.slice(1));
        items.push({ kind: 'work', name: w.name, quantity: w.unit === 'ч' ? int(2, 6) : 1, unit: w.unit, priceKop: rub(w.price), costKop: rub(Math.round(w.price * 0.3)) });
      }
      const nParts = int(1, 4);
      for (let i = 0; i < nParts; i++) {
        const prt = pick(PARTS);
        items.push({ kind: 'part', name: prt.name, quantity: prt.price < 3000 ? int(1, 4) : 1, unit: 'шт', priceKop: rub(prt.price), costKop: rub(prt.cost) });
      }
      if (spec.type === 'repair_field') items.push({ kind: 'service', name: 'Выезд специалиста', quantity: 1, unit: 'шт', priceKop: rub(3000), costKop: rub(1200) });
    }
    if (!estimateReached) items.splice(1); // до диагностики в смете только диагностика
    const discount = spec.client.equipment.length && rnd() > 0.8 ? 5 : 0;
    const approvedTotal = calcEstimate(
      items.map((i) => ({ kind: i.kind, status: 'approved', quantity: Number(i.quantity), priceKop: Number(i.priceKop), costKop: Number(i.costKop), discountPercent: 0 })),
      discount,
    );
    if (spec.extraPending) {
      items.push({ kind: 'part', name: 'Обратный клапан RVP 16', quantity: 1, unit: 'шт', priceKop: rub(2100), costKop: rub(1200), isExtra: true });
    }
    if (spec.proposedPending) {
      items.push({ kind: 'part', name: pick(PARTS).name, quantity: 1, unit: 'шт', priceKop: 0, costKop: 0, status: 'proposed', proposedById: spec.masters[0]?.id });
    }
    const totals = calcEstimate(
      items.map((i) => ({ kind: i.kind, status: (i.status as 'approved' | 'proposed') ?? 'approved', quantity: Number(i.quantity), priceKop: Number(i.priceKop), costKop: Number(i.costKop), discountPercent: 0 })),
      discount,
    );
    const approvalPassed = path.some((s) => ['awaiting_parts', 'repair', 'testing', 'ready', 'done', 'visit_done', 'awaiting_payment', 'contract', 'awaiting_prepayment', 'procurement', 'assembly', 'awaiting_payment'].includes(s.code));
    const last = path[path.length - 1];

    const order = await db.order.create({
      data: {
        companyId,
        number,
        type: spec.type,
        stageId: last.id,
        stageChangedAt: times[times.length - 1],
        clientId: spec.client.id,
        contactId: spec.client.contactId,
        equipmentId: spec.type.startsWith('repair') ? equipment?.id : null,
        title:
          spec.title ??
          (spec.type.startsWith('assembly')
            ? spec.complaint ?? 'Сборка гидростанции'
            : `${complaint.title}${equipment ? ` — ${equipment.name.charAt(0).toLowerCase()}${equipment.name.slice(1)}` : ''}`),
        complaint: complaint.text,
        managerId: manager,
        priority: spec.priority ?? (rnd() > 0.85 ? 'high' : 'normal'),
        plannedFinishAt: new Date(createdAt.getTime() + (spec.type.startsWith('assembly') ? int(20, 35) : int(5, 12)) * DAY),
        finishedAt: last.kind !== 'open' ? times[times.length - 1] : null,
        lostReasonId: last.kind === 'lost' ? pick(reasons).id : null,
        lostComment: last.kind === 'lost' ? 'Клиент решил купить новую станцию' : null,
        discountPercent: discount,
        totalKop: totals.totalKop,
        costKop: totals.costKop,
        statusToken: randomBytes(24).toString('base64url'),
        isWarrantyCase: !!spec.warranty,
        createdById: manager,
        createdAt,
        stuckNotifiedAt: new Date(now),
        assignees: { create: spec.masters.map((m, i) => ({ userId: m.id, isLead: i === 0 })) },
        items: { create: items.map((i, idx) => ({ ...i, sort: idx, createdAt })) },
        stageHistory: {
          create: path.map((s, i) => ({
            fromStageId: i ? path[i - 1].id : null,
            toStageId: s.id,
            changedById: s.isProduction && spec.masters[0] ? spec.masters[0].id : manager,
            changedAt: times[i],
            durationHours: i ? Math.round((times[i].getTime() - times[i - 1].getTime()) / HOUR) : null,
          })),
        },
      },
    });

    if (approvalPassed && estimateReached) {
      const approvalAt = times[path.findIndex((s) => ['awaiting_parts', 'repair', 'contract', 'visit_done', 'invoice', 'procurement', 'assembly', 'awaiting_payment', 'testing', 'ready', 'done'].includes(s.code))] ?? times[times.length - 1];
      await db.orderApproval.create({
        data: { orderId: order.id, version: 1, totalKop: approvedTotal.totalKop, method: pick(['phone', 'email', 'signed_doc'] as const), approvedByName: pick(CONTACT_NAMES), approvedAt: approvalAt, createdById: manager },
      });
    }

    // Лента: системные события + живые комментарии
    const comments: Prisma.CommentCreateManyInput[] = [];
    path.forEach((s, i) => {
      comments.push({
        orderId: order.id,
        kind: 'system',
        authorId: i ? (s.isProduction && spec.masters[0] ? spec.masters[0].id : manager) : manager,
        text: i ? `Этап: «${path[i - 1].name}» → «${s.name}»` : 'Заказ создан',
        payload: i ? { event: 'stage', from: path[i - 1].code, to: s.code } : { event: 'created' },
        createdAt: times[i],
      });
      const after = (h: number) =>
        new Date(Math.min(now - 10 * 60_000, Math.max(times[i].getTime() + 15 * 60_000, workTime(times[i].getTime() + h * HOUR).getTime())));
      if (s.code === 'diagnostics' && spec.masters[0] && i < path.length - 1) {
        comments.push({ orderId: order.id, kind: 'comment', authorId: spec.masters[0].id, text: pick(DIAG_COMMENTS), createdAt: after(int(2, 6)) });
      }
      if (s.code === 'estimate' && i <= path.length - 1) {
        comments.push({ orderId: order.id, kind: 'comment', authorId: manager, text: pick(MANAGER_COMMENTS), createdAt: after(int(1, 4)) });
      }
      if ((s.code === 'repair' || s.code === 'testing' || s.code === 'assembly') && spec.masters[0] && rnd() > 0.35) {
        comments.push({ orderId: order.id, kind: 'comment', authorId: spec.masters[0].id, text: pick(MASTER_COMMENTS), createdAt: after(int(2, 8)) });
      }
    });
    await db.comment.createMany({ data: comments });
    created.push({ id: order.id, number, type: spec.type, stage: spec.stage, managerId: manager, clientId: spec.client.id, masters: spec.masters.map((m) => m.id), title: order.title });
    return order;
  }

  const legal = clients.filter((c) => c.equipment.length && !c.name.startsWith('ИП') && !PEOPLE.includes(c.name));
  const anyClient = () => pick(clients);
  const master = () => pick(workshopMasters);

  // Ремонт в цеху — на всех этапах
  const workshop: [string, number, number, Partial<OrderSpec>?][] = [
    ['new', 0.2, 3],
    ['new', 1, 20],
    ['awaiting_unit', 3, 60, { optional: ['awaiting_unit'] }],
    ['accepted', 1, 6],
    ['accepted', 2, 30],
    ['diagnostics', 2, 20],
    ['diagnostics', 4, 70, { proposedPending: true }],
    ['estimate', 4, 20],
    ['estimate', 7, 90],
    ['awaiting_parts', 9, 50, { optional: ['awaiting_parts'] }],
    ['awaiting_parts', 14, 200, { optional: ['awaiting_parts'], priority: 'high' }],
    ['repair', 8, 30],
    ['repair', 10, 70, { extraPending: true }],
    ['repair', 6, 10, { priority: 'urgent' }],
    ['testing', 9, 5],
    ['ready', 11, 20],
    ['ready', 15, 100],
  ];
  for (const [stage, age, hours, extra] of workshop) {
    await makeOrder({ type: 'repair_workshop', client: rnd() > 0.3 ? pick(legal) : anyClient(), stage, age, onStageHours: hours, masters: ['new', 'awaiting_unit'].includes(stage) ? [] : [master()], optional: ['estimate'], ...extra });
  }
  // Завершённые и отказы за последние 3 месяца — для аналитики и истории оборудования
  for (let i = 0; i < 26; i++) {
    const age = int(12, 95);
    await makeOrder({ type: 'repair_workshop', client: rnd() > 0.25 ? pick(legal) : anyClient(), stage: 'done', age, onStageHours: int(24, Math.max(25, (age - 8) * 24)), masters: [master()], optional: ['estimate', ...(rnd() > 0.6 ? ['awaiting_parts'] : [])] });
  }
  for (let i = 0; i < 4; i++) {
    await makeOrder({ type: 'repair_workshop', client: anyClient(), stage: 'cancelled', age: int(10, 60), onStageHours: int(48, 200), masters: [master()], optional: ['estimate'], lostAt: 'estimate' });
  }
  await makeOrder({ type: 'repair_workshop', client: pick(legal), stage: 'diagnostics', age: 1, onStageHours: 8, masters: [users.master], warranty: true, title: 'Гарантия: повторная течь после ремонта', complaint: 'После ремонта месяц назад снова появилась течь по валу насоса.' });

  // Выездной ремонт
  const field: [string, number, number][] = [
    ['new', 0.5, 5],
    ['visit_planned', 1, 20],
    ['visit_planned', 2, 30],
    ['on_site', 0.3, 2],
    ['visit_done', 3, 20],
    ['awaiting_payment', 6, 90],
  ];
  for (const [stage, age, hours] of field) {
    await makeOrder({ type: 'repair_field', client: pick(legal), stage, age, onStageHours: hours, masters: stage === 'new' ? [] : [fieldMaster], optional: ['estimate'] });
  }
  for (let i = 0; i < 9; i++) {
    await makeOrder({ type: 'repair_field', client: pick(legal), stage: 'done', age: int(8, 80), onStageHours: int(24, 300), masters: [fieldMaster] });
  }

  // Сборка под заказ
  const custom: [string, number, number, string][] = [
    ['calculation', 3, 40, 'Гидростанция для пресса 100 т, 200 бар, 63 л/мин'],
    ['quote_sent', 6, 70, 'Маслостанция для линии экструзии, 2 контура'],
    ['awaiting_prepayment', 10, 50, 'Гидростанция подъёмного стола, 160 бар'],
    ['assembly', 18, 100, 'Гидростанция пакетировочного пресса 45 кВт'],
    ['testing', 24, 10, 'Насосная станция для гидроцилиндров кантователя'],
  ];
  for (const [stage, age, hours, title] of custom) {
    await makeOrder({ type: 'assembly_custom', client: pick(legal), stage, age, onStageHours: hours, masters: ['assembly', 'testing'].includes(stage) ? [assembler] : [], title, complaint: `${title}. ТЗ во вложении у менеджера.`, optional: ['contract'] });
  }
  for (let i = 0; i < 4; i++) {
    await makeOrder({ type: 'assembly_custom', client: pick(legal), stage: 'done', age: int(30, 95), onStageHours: int(48, 400), masters: [assembler], title: pick(['Гидростанция для гибочного станка', 'Маслостанция ТПА 250 т', 'Гидростанция манипулятора']), optional: ['contract'] });
  }
  // Сборка типовой
  await makeOrder({ type: 'assembly_standard', client: pick(clients.filter((c) => c.name.includes('Гидро') || c.name.includes('Привод'))), stage: 'assembly', age: 5, onStageHours: 30, masters: [assembler], title: 'Типовая станция СНГ-40, 2 шт' });
  await makeOrder({ type: 'assembly_standard', client: { id: ownStock.id, name: ownStock.name, managerId: director.id, address: '', equipment: [] }, stage: 'invoice', age: 2, onStageHours: 30, masters: [], title: 'Сборка на склад: HPU-MINI 2.2, 3 шт' });
  for (let i = 0; i < 3; i++) {
    await makeOrder({ type: 'assembly_standard', client: pick(clients.filter((c) => c.name.includes('Гидро') || c.name.includes('Привод') || c.name.startsWith('ИП'))), stage: 'done', age: int(15, 70), onStageHours: int(48, 200), masters: [assembler], title: 'Типовая станция HPU-MINI 2.2' });
  }

  for (const [year, last] of Object.entries(orderNumbers)) {
    await db.counter.create({ data: { companyId, key: 'order', year: Number(year), last } });
  }

  // ---------- Выезды ----------
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const at = (dayOffset: number, hour: number, min = 0) => new Date(today.getTime() + dayOffset * DAY + hour * HOUR + min * 60_000);
  const fieldOrders = created.filter((o) => o.type === 'repair_field');
  // Демо-мастер (Сергей Петров) тоже едет на выезд сегодня — чтобы под этой ролью был виден экран «Мой выезд».
  const visitPlan: { stage: string; start: Date; status: 'planned' | 'on_site' | 'done'; result?: 'fixed'; extra?: string }[] = [
    { stage: 'on_site', start: at(0, 9, 30), status: 'on_site' },
    { stage: 'visit_planned', start: at(0, 14, 0), status: 'planned', extra: users.master.id },
    { stage: 'visit_planned', start: at(1, 10, 0), status: 'planned' },
    { stage: 'visit_done', start: at(-3, 11, 0), status: 'done', result: 'fixed' },
    { stage: 'awaiting_payment', start: at(-6, 10, 0), status: 'done', result: 'fixed' },
  ];
  for (const v of visitPlan) {
    const order = fieldOrders.find((o) => o.stage === v.stage && !visitPlan.some((x) => x !== v && false));
    if (!order) continue;
    const client = clients.find((c) => c.id === order.clientId)!;
    await db.visit.create({
      data: {
        companyId,
        orderId: order.id,
        status: v.status,
        plannedStartAt: v.start,
        plannedEndAt: new Date(v.start.getTime() + 3 * HOUR),
        address: client.address,
        contactName: pick(CONTACT_NAMES),
        contactPhone: phone(),
        departedAt: v.status !== 'planned' ? new Date(v.start.getTime() - 50 * 60_000) : null,
        arrivedAt: v.status !== 'planned' ? v.start : null,
        finishedAt: v.status === 'done' ? new Date(v.start.getTime() + 2.5 * HOUR) : null,
        result: v.result,
        report: v.status === 'done' ? 'Заменили РВД и уплотнения цилиндра, выставили давление, проверили под нагрузкой — течей нет.' : null,
        travelKm: v.status === 'done' ? int(15, 90) : null,
        createdById: order.managerId,
        assignees: { create: [{ userId: fieldMaster.id }, ...(v.extra ? [{ userId: v.extra }] : [])] },
      },
    });
    if (v.extra) await db.orderAssignee.create({ data: { orderId: order.id, userId: v.extra } });
    fieldOrders.splice(fieldOrders.indexOf(order), 1);
  }
  // Ещё выезды на неделю — диагностика на объекте у клиентов из цеховых заказов
  await db.visit.create({
    data: {
      companyId,
      orderId: created.find((o) => o.type === 'repair_workshop' && o.stage === 'awaiting_unit')!.id,
      plannedStartAt: at(2, 9, 0),
      plannedEndAt: at(2, 12, 0),
      address: clients[0].address,
      contactName: pick(CONTACT_NAMES),
      contactPhone: phone(),
      createdById: managers[0].id,
      assignees: { create: [{ userId: users.kuznetsov.id }] },
    },
  });

  // ---------- Заявки ----------
  const LEADS: { channel: 'phone' | 'email' | 'site' | 'vk' | 'avito' | 'telegram' | 'manual'; src: string; name: string; text: string; ageH: number; status: 'new' | 'in_progress' | 'rejected' | 'converted'; client?: boolean }[] = [
    { channel: 'site', src: 'Сайт', name: 'Виталий', text: 'Нужен ремонт гидростанции пресса, не держит давление. Можно приехать посмотреть?', ageH: 0.4, status: 'new' },
    { channel: 'phone', src: 'Звонок', name: 'Главный механик', text: 'Течёт насос на маслостанции ТПА, просят срочно — линия стоит.', ageH: 1.5, status: 'new', client: true },
    { channel: 'avito', src: 'Авито', name: 'Руслан', text: 'Сколько стоит перебрать насос НШ-50 на тракторе?', ageH: 3, status: 'new' },
    { channel: 'email', src: 'Почта', name: 'Отдел снабжения', text: 'Просим КП на гидростанцию 15 кВт, 160 бар, бак 160 л. ТЗ во вложении.', ageH: 26, status: 'new' },
    { channel: 'telegram', src: 'Telegram', name: 'Ильдар', text: 'Добрый день! Гидроцилиндр на манипуляторе опускается сам. Делаете?', ageH: 5, status: 'in_progress' },
    { channel: 'phone', src: 'Рекомендация', name: 'Олег Викторович', text: 'Посоветовали вас. Нужна диагностика гидравлики лесовоза.', ageH: 20, status: 'in_progress' },
    { channel: 'vk', src: 'ВКонтакте', name: 'Анна', text: 'Здравствуйте, у вас можно купить фильтр для гидростанции Hydac?', ageH: 50, status: 'rejected' },
    { channel: 'site', src: 'Сайт', name: 'Евгений', text: 'Интересует плановое ТО двух маслостанций на заводе.', ageH: 30, status: 'in_progress', client: true },
    { channel: 'phone', src: 'Повторный клиент', name: 'Механик участка', text: 'Снова шумит насос, который вы ремонтировали весной.', ageH: 70, status: 'converted', client: true },
    { channel: 'avito', src: 'Авито', name: 'Константин', text: 'Нужна сборка гидростанции для дровокола.', ageH: 120, status: 'rejected' },
    { channel: 'email', src: 'Почта', name: 'ООО «Новый Клиент»', text: 'Запрос на ремонт трёх насосов Rexroth A10VSO, сроки?', ageH: 100, status: 'converted' },
    { channel: 'phone', src: 'Звонок', name: 'Дмитрий', text: 'Когда будет готов мой заказ? Звонил на прошлой неделе.', ageH: 8, status: 'rejected' },
  ];
  let leadNo = 0;
  const converted = created.filter((o) => o.type === 'repair_workshop' && ['accepted', 'diagnostics'].includes(o.stage));
  for (const l of LEADS) {
    leadNo++;
    const createdAt = new Date(now - l.ageH * HOUR);
    const client = l.client ? pick(legal) : null;
    const assignee = l.status === 'new' && l.ageH < 2 ? null : client ? client.managerId : pick(managers).id;
    const order = l.status === 'converted' ? converted.shift() : undefined;
    await db.lead.create({
      data: {
        companyId,
        number: `ЗЯ-${createdAt.getFullYear()}-${String(leadNo).padStart(4, '0')}`,
        status: l.status,
        channel: l.channel,
        sourceId: source(l.src),
        clientId: order ? order.clientId : client?.id,
        contactName: l.name,
        phone: l.channel === 'email' ? null : phone(),
        email: l.channel === 'email' ? `zakaz${int(1, 99)}@example.ru` : null,
        description: l.text,
        assigneeId: assignee,
        responseDueAt: new Date(createdAt.getTime() + HOUR),
        firstResponseAt: l.status === 'new' ? null : new Date(createdAt.getTime() + int(10, 50) * 60_000),
        orderId: order?.id,
        rejectReasonId: l.status === 'rejected' ? (l.text.includes('Когда будет готов') ? null : pick(reasons).id) : null,
        isStatusQuestion: l.text.includes('Когда будет готов'),
        overdueNotifiedAt: l.ageH > 2 ? createdAt : null,
        createdAt,
      },
    });
  }
  await db.counter.create({ data: { companyId, key: 'lead', year: new Date(now).getFullYear(), last: leadNo } });

  // ---------- Задачи ----------
  const openOrders = created.filter((o) => !['done', 'cancelled'].includes(o.stage));
  const TASKS: { title: string; who: string; dueH: number | null; order?: (o: (typeof created)[number]) => boolean; priority?: 'high' | 'urgent' }[] = [
    { title: 'Напомнить клиенту о смете', who: 'manager', dueH: -20, order: (o) => o.stage === 'estimate' },
    { title: 'Согласовать доп. работы по обратному клапану', who: 'manager', dueH: 3, order: (o) => o.stage === 'repair' },
    { title: 'Связаться с клиентом по выдаче', who: 'belov', dueH: 5, order: (o) => o.stage === 'ready' },
    { title: 'Выставить счёт на предоплату 50%', who: 'accountant', dueH: 2, order: (o) => o.stage === 'awaiting_prepayment', priority: 'high' },
    { title: 'Уточнить у поставщика срок поставки ремкомплекта', who: 'orlova', dueH: -4, order: (o) => o.stage === 'awaiting_parts', priority: 'high' },
    { title: 'Подготовить стенд под испытания 250 бар', who: 'master', dueH: 6, order: (o) => o.stage === 'testing' },
    { title: 'Сфотографировать шильдик и комплектность', who: 'kuznetsov', dueH: 1, order: (o) => o.stage === 'accepted' },
    { title: 'Проверить предложенные мастером позиции', who: 'manager', dueH: 4, order: (o) => o.stage === 'diagnostics' },
    { title: 'Отправить КП повторно с учётом замечаний', who: 'belov', dueH: 26, order: (o) => o.stage === 'quote_sent' },
    { title: 'Сверить акт по выездам за месяц с ООО «ДорСтройТех»', who: 'accountant', dueH: 48 },
    { title: 'Провести инвентаризацию уплотнений', who: 'nikitina', dueH: 72 },
    { title: 'Планёрка: разобрать застрявшие заказы', who: 'director', dueH: 2 },
    { title: 'Подтвердить скидку 7% для «СтальПрофиля»', who: 'director', dueH: 4, priority: 'high' },
    { title: 'Проверить загрузку мастеров на следующую неделю', who: 'director', dueH: 26 },
    { title: 'Взять с собой РВД Ду16 и манометр', who: 'volkov', dueH: 2 },
    { title: 'Позвонить по оплате выезда', who: 'orlova', dueH: -30, order: (o) => o.stage === 'awaiting_payment' },
  ];
  for (const t of TASKS) {
    const order = t.order ? openOrders.find(t.order) : undefined;
    const assignee = users[t.who];
    await db.task.create({
      data: {
        companyId,
        title: t.title,
        assigneeId: assignee.id,
        authorId: assignee.role === 'master' ? users.master.id : director.id,
        dueAt: t.dueH === null ? null : new Date(now + t.dueH * HOUR),
        priority: t.priority ?? 'normal',
        orderId: order?.id,
        clientId: order?.clientId,
        overdueNotifiedAt: t.dueH !== null && t.dueH < 0 ? new Date(now) : null,
        createdAt: new Date(now - int(1, 3) * DAY),
      },
    });
  }
  // Пара выполненных задач для истории
  for (const who of ['manager', 'kuznetsov']) {
    await db.task.create({
      data: { companyId, title: 'Перезвонить клиенту после выдачи', assigneeId: users[who].id, authorId: director.id, status: 'done', completedAt: new Date(now - DAY), createdAt: new Date(now - 3 * DAY) },
    });
  }

  // ---------- Чат ----------
  const general = await db.chatChannel.findFirstOrThrow({ where: { companyId, type: 'general' } });
  await db.chatMember.createMany({ data: Object.values(users).map((u) => ({ channelId: general.id, userId: u.id, lastReadAt: new Date(now - 2 * HOUR) })) });
  const someOrder = openOrders.find((o) => o.stage === 'awaiting_parts');
  const generalMsgs: [string, string, number][] = [
    ['director', 'Коллеги, с понедельника все обсуждения по заказам — только в ленте заказа. В общем чате — общие вопросы.', 50],
    ['master', 'Принято. Стенд №2 в четверг на поверке, испытания планируйте на стенде №1.', 30],
    ['accountant', 'Напоминаю: акты за прошлый месяц нужно подписать до 5-го числа.', 26],
    ['orlova', `По ${someOrder?.number ?? 'заказу'} поставщик сдвинул поставку ремкомплекта на 2 дня.`, 5],
    ['volkov', 'Сегодня на выезде до обеда, к 15:00 буду в цеху.', 3],
    ['manager', '@Сергей Петров, сможете сегодня глянуть насос, который привезли утром?', 1.2],
    ['master', 'Да, после обеда возьму.', 1],
  ];
  for (const [who, text, hAgo] of generalMsgs) {
    await db.chatMessage.create({ data: { channelId: general.id, authorId: users[who].id, text, createdAt: new Date(now - hAgo * HOUR) } });
  }
  const shop = await db.chatChannel.create({
    data: { companyId, type: 'group', name: 'Цех', createdAt: new Date(now - 100 * DAY), members: { create: [...workshopMasters, assembler, fieldMaster, director].map((u) => ({ userId: u.id, lastReadAt: new Date(now - 6 * HOUR) })) } },
  });
  for (const [who, text, hAgo] of [
    ['master', 'Кто брал динамометрический ключ на 200? Верните на место, пожалуйста.', 8],
    ['zaitsev', 'У меня, сейчас принесу.', 7.8],
    ['morozov', 'Масла HLP 46 осталось 2 канистры, надо заказать.', 4],
  ] as const) {
    await db.chatMessage.create({ data: { channelId: shop.id, authorId: users[who].id, text, createdAt: new Date(now - hAgo * HOUR) } });
  }
  const dm = await db.chatChannel.create({
    data: { companyId, type: 'direct', createdAt: new Date(now - 30 * DAY), members: { create: [{ userId: director.id, lastReadAt: new Date(now - 3 * HOUR) }, { userId: users.manager.id, lastReadAt: new Date(now) }] } },
  });
  await db.chatMessage.create({ data: { channelId: dm.id, authorId: users.manager.id, text: 'Андрей, по «СтальПрофилю» просят скидку 7% за объём — даём?', createdAt: new Date(now - 2 * HOUR) } });

  // ---------- Уведомления ----------
  const notif = (who: string, type: string, title: string, body: string, link: string, hAgo: number, read = false) =>
    db.notification.create({ data: { companyId, userId: users[who].id, type, title, body, link, createdAt: new Date(now - hAgo * HOUR), readAt: read ? new Date(now - hAgo * HOUR + 600_000) : null } });
  const est = openOrders.find((o) => o.stage === 'estimate');
  const stuckOrder = openOrders.find((o) => o.stage === 'awaiting_parts');
  const diag = openOrders.find((o) => o.stage === 'diagnostics');
  if (stuckOrder) await notif('director', 'order_stuck', `${stuckOrder.number} без движения: «Ожидание запчастей»`, stuckOrder.title, `/orders/${stuckOrder.id}`, 2);
  await notif('director', 'lead_overdue', 'Заявка просрочена', 'Просим КП на гидростанцию 15 кВт…', '/leads', 1);
  if (est) await notif('manager', 'stage_changed', `${est.number}: Смета на согласовании`, 'Сергей Петров перевёл заказ из «Диагностика»', `/orders/${est.id}`, 3);
  if (diag) await notif('manager', 'comment_new', `${diag.number}: мастер предложил позицию`, 'Ремкомплект насоса A10VSO28', `/orders/${diag.id}`, 1.5);
  await notif('manager', 'lead_new', 'Новая заявка (Сайт)', 'Нужен ремонт гидростанции пресса…', '/leads', 0.4);
  await notif('master', 'mention', 'Елена Ковалёва упомянула вас в «Общий»', 'Сможете сегодня глянуть насос…', `/chat/${general.id}`, 1.2);
  if (diag) await notif('master', 'order_assigned', `Вы исполнитель заказа ${diag.number}`, diag.title, `/orders/${diag.id}`, 20, true);
  await notif('volkov', 'visit_assigned', 'Выезд сегодня в 14:00', clients[1].address, '/visits', 18);
  await notif('accountant', 'task_assigned', 'Новая задача от Андрей Соколов', 'Выставить счёт на предоплату 50%', '/tasks', 5);

  return {
    users: Object.keys(users).length,
    clients: clients.length + 1,
    orders: orderNo,
    leads: leadNo,
    tasks: TASKS.length + 2,
  };
}
