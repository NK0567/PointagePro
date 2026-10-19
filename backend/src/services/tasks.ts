import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { notify } from '../lib/audit';
import { nextWorkDay } from '../lib/time';

const OPEN = { in: ['TODO', 'IN_PROGRESS'] as ('TODO' | 'IN_PROGRESS')[] };

export const taskInclude = {
  assignee: { select: { id: true, firstName: true, lastName: true, matricule: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.TaskInclude;

/**
 * Report de rattrapage : toute tâche encore ouverte dont la date prévue est passée
 * (employé absent, journée non clôturée…) remonte dans la liste du jour.
 * L'historique et le compteur de reports sont conservés.
 */
export async function carryOverdue(userId: number, today: string) {
  const overdue = await prisma.task.findMany({ where: { assigneeId: userId, status: OPEN, plannedDate: { lt: today } } });
  for (const t of overdue) {
    await prisma.task.update({
      where: { id: t.id },
      data: {
        plannedDate: today,
        carryCount: { increment: 1 },
        history: { create: { action: 'CARRIED', fromValue: t.plannedDate, toValue: today, comment: 'Report automatique (tâche non terminée)' } },
      },
    });
  }
  return overdue.length;
}

export async function createTasksForDay(userId: number, actorId: number, workDate: string, titles: string[]) {
  const clean = [...new Set(titles.map((t) => t.trim()).filter(Boolean))].slice(0, 30);
  const created = [];
  for (const title of clean) {
    created.push(
      await prisma.task.create({
        data: {
          title: title.slice(0, 190),
          assigneeId: userId,
          createdById: actorId,
          plannedDate: workDate,
          originalDate: workDate,
          history: { create: { action: 'CREATED', toValue: workDate, actorId } },
        },
      }),
    );
  }
  return created;
}

/**
 * Clôture de journée : les tâches cochées passent à « Terminée »,
 * toutes les autres tâches ouvertes du jour sont reportées au prochain jour travaillé.
 */
export async function closeDayTasks(userId: number, workDate: string, doneIds: number[], workDays: string) {
  const tasks = await prisma.task.findMany({ where: { assigneeId: userId, plannedDate: workDate, status: OPEN } });
  const target = nextWorkDay(workDate, workDays);
  let done = 0;
  let carried = 0;
  for (const t of tasks) {
    if (doneIds.includes(t.id)) {
      done++;
      await prisma.task.update({
        where: { id: t.id },
        data: {
          status: 'DONE',
          completedAt: new Date(),
          history: { create: { action: 'STATUS', fromValue: t.status, toValue: 'DONE', actorId: userId } },
        },
      });
    } else {
      carried++;
      await prisma.task.update({
        where: { id: t.id },
        data: {
          plannedDate: target,
          carryCount: { increment: 1 },
          history: { create: { action: 'CARRIED', fromValue: workDate, toValue: target, comment: 'Non terminée à la fin de journée' } },
        },
      });
    }
  }
  if (carried > 0) {
    await notify(userId, 'warning', 'Tâches non complétées',
      `${carried} tâche${carried > 1 ? 's' : ''} non terminée${carried > 1 ? 's' : ''} ${carried > 1 ? 'seront ajoutées' : 'sera ajoutée'} à votre liste du ${target.split('-').reverse().join('/')}.`);
  }
  return { done, carried, nextDate: target };
}
