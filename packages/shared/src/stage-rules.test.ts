import { DEFAULT_ROLE_PERMISSIONS } from './permissions';
import type { Permission } from './permissions';
import type { RoleCode } from './enums';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PIPELINES } from './pipelines';
import { checkTransition, type OrderFacts, type StageInfo } from './stage-rules';

const stages = DEFAULT_PIPELINES.repair_workshop.stages.map(
  (s, i): StageInfo => ({ code: s.code, name: s.name, sort: i, kind: s.kind ?? 'open', isProduction: !!s.isProduction }),
);
const st = (code: string) => stages.find((s) => s.code === code)!;
const perms = (role: RoleCode) => new Set<Permission>(DEFAULT_ROLE_PERMISSIONS[role]);

const facts = (patch: Partial<OrderFacts> = {}): OrderFacts => ({
  type: 'repair_workshop',
  hasEquipment: true,
  photoCount: 1,
  approvedItemsCount: 2,
  proposedItemsCount: 0,
  assigneesCount: 1,
  hasApproval: true,
  approvalMatchesTotal: true,
  isAssignee: false,
  ...patch,
});

describe('checkTransition', () => {
  it('приёмка требует оборудование и фото', () => {
    const r = checkTransition({ from: st('new'), to: st('accepted'), facts: facts({ hasEquipment: false, photoCount: 0 }), permissions: perms('manager') });
    expect(r.denied).toEqual([]);
    expect(r.blockers).toHaveLength(2);
  });

  it('ремонт без согласованной сметы блокируется', () => {
    const r = checkTransition({ from: st('estimate'), to: st('repair'), facts: facts({ hasApproval: false }), permissions: perms('manager') });
    expect(r.blockers).toContain('Смета не согласована с клиентом');
  });

  it('мастер двигает свой заказ по производственным этапам', () => {
    const master = perms('master');
    expect(checkTransition({ from: st('accepted'), to: st('diagnostics'), facts: facts({ isAssignee: true }), permissions: master }).denied).toEqual([]);
    expect(checkTransition({ from: st('diagnostics'), to: st('estimate'), facts: facts({ isAssignee: true }), permissions: master }).denied).toEqual([]);
    expect(checkTransition({ from: st('repair'), to: st('testing'), facts: facts({ isAssignee: true }), permissions: master }).denied).toEqual([]);
  });

  it('мастер не может выдать заказ, отказать или двигать чужой заказ', () => {
    const master = perms('master');
    expect(checkTransition({ from: st('ready'), to: st('done'), facts: facts({ isAssignee: true }), permissions: master }).denied).not.toEqual([]);
    expect(checkTransition({ from: st('repair'), to: st('cancelled'), facts: facts({ isAssignee: true, lostReasonId: 'x' }), permissions: master }).denied).not.toEqual([]);
    expect(checkTransition({ from: st('repair'), to: st('testing'), facts: facts({ isAssignee: false }), permissions: master }).denied).not.toEqual([]);
  });

  it('возврат назад только с комментарием', () => {
    const p = perms('manager');
    expect(checkTransition({ from: st('repair'), to: st('diagnostics'), facts: facts(), permissions: p }).denied).toHaveLength(1);
    expect(checkTransition({ from: st('repair'), to: st('diagnostics'), facts: facts(), permissions: p, comment: 'Нашли ещё дефект' }).denied).toEqual([]);
  });

  it('отказ требует причину', () => {
    const p = perms('manager');
    expect(checkTransition({ from: st('estimate'), to: st('cancelled'), facts: facts(), permissions: p }).denied).toContain('Укажите причину отказа');
    expect(checkTransition({ from: st('estimate'), to: st('cancelled'), facts: facts({ lostReasonId: 'r' }), permissions: p }).denied).toEqual([]);
  });

  it('руководитель обходит проверки только с комментарием, менеджер — нет', () => {
    const f = facts({ hasApproval: false });
    const director = checkTransition({ from: st('estimate'), to: st('repair'), facts: f, permissions: perms('director'), override: true, comment: 'Клиент согласовал устно' });
    expect(director.overridden).toBe(true);
    expect(director.blockers).toEqual([]);
    const noComment = checkTransition({ from: st('estimate'), to: st('repair'), facts: f, permissions: perms('director'), override: true });
    expect(noComment.denied).toContain('Чтобы пропустить проверки, напишите комментарий');
    const manager = checkTransition({ from: st('estimate'), to: st('repair'), facts: f, permissions: perms('manager'), override: true, comment: 'x' });
    expect(manager.denied).toContain('Пропустить проверки может только руководитель');
  });

  it('выдача невозможна, если смета изменилась после согласования', () => {
    const r = checkTransition({ from: st('testing'), to: st('ready'), facts: facts({ approvalMatchesTotal: false }), permissions: perms('manager') });
    expect(r.blockers).toContain('Смета изменилась после согласования — согласуйте доп. работы с клиентом');
  });
});
