/* Données de démonstration — NE PAS exécuter en production. */
import { PrismaClient, type EventType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { addDays, isoWeekday, localToUtc, workDateOf } from '../src/lib/time';

const prisma = new PrismaClient();

async function main() {
  await prisma.$transaction([
    prisma.taskHistory.deleteMany(), prisma.task.deleteMany(), prisma.notification.deleteMany(),
    prisma.correctionRequest.deleteMany(), prisma.punchRejection.deleteMany(), prisma.attendanceEvent.deleteMany(),
    prisma.authenticator.deleteMany(), prisma.terminalDevice.deleteMany(), prisma.auditLog.deleteMany(),
    prisma.user.updateMany({ data: { managerId: null } }), prisma.user.deleteMany(), prisma.site.deleteMany(),
  ]);

  const site = await prisma.site.create({
    data: {
      name: 'Entrepôt principal', address: 'Zone industrielle de Bonabéri, Douala',
      latitude: 4.0712, longitude: 9.6858, radiusM: 150, maxAccuracyM: 80,
      startTime: '08:00', endTime: '17:00', lateToleranceMin: 10, workDays: '1,2,3,4,5,6', maxBreaks: 2,
    },
  });
  const office = await prisma.site.create({
    data: { name: 'Bureau Akwa', address: 'Boulevard de la Liberté, Akwa, Douala', latitude: 4.0483, longitude: 9.7043, radiusM: 100, startTime: '08:30', endTime: '17:30' },
  });

  const pwd = await bcrypt.hash('Admin@2026', 11);
  const pin = await bcrypt.hash('1234', 10);
  const admin = await prisma.user.create({
    data: { matricule: 'ADM-0001', firstName: 'Admin', lastName: 'Principal', email: 'admin@pointagepro.cm', passwordHash: pwd, role: 'SUPER_ADMIN', status: 'ACTIVE', jobTitle: 'Administrateur', department: 'Direction', siteId: office.id },
  });
  await prisma.user.create({
    data: { matricule: 'AGT-0001', firstName: 'Agent', lastName: 'Pointage', email: 'agent@pointagepro.cm', passwordHash: await bcrypt.hash('Agent@2026', 11), role: 'AGENT', status: 'ACTIVE', jobTitle: 'Agent de pointage', department: 'Ressources humaines', siteId: site.id },
  });
  const chef = await prisma.user.create({
    data: { matricule: 'CHF-0001', firstName: 'Chef', lastName: 'Équipe', email: 'chef@pointagepro.cm', passwordHash: await bcrypt.hash('Chef@2026', 11), role: 'CHEF', status: 'ACTIVE', jobTitle: "Chef d'équipe", department: 'Logistique', siteId: site.id },
  });

  const people = [
    ['Mamadou', 'Diop', 'Technicien', 'Maintenance', 2],
    ['Awa', 'Sow', 'Comptable', 'Finance', 12],
    ['Ibrahima', 'Fall', 'Agent de saisie', 'Logistique', 5],
    ['Fatou', 'Ba', 'Commerciale', 'Ventes', 18],
    ['Ousmane', 'Ndiaye', 'Magasinier', 'Logistique', 0],
  ] as const;

  const today = workDateOf(new Date());
  const employees = [];
  for (let i = 0; i < people.length; i++) {
    const [firstName, lastName, jobTitle, department] = people[i];
    employees.push(
      await prisma.user.create({
        data: {
          matricule: `EMP-${String(i + 1).padStart(4, '0')}`, firstName, lastName, jobTitle, department,
          role: 'EMPLOYE', status: 'ACTIVE', siteId: site.id, managerId: chef.id, pinHash: pin,
          // Code permettant d'enregistrer l'empreinte sur un téléphone (valable 30 jours)
          inviteCode: `DEMO${i + 1}${'ABCDE'[i]}${'XYZWK'[i]}2`, inviteExpiresAt: new Date(Date.now() + 30 * 86400_000),
        },
      }),
    );
  }
  // Un employé en attente d'enrôlement (exemple de flux d'invitation)
  await prisma.user.create({
    data: { matricule: 'EMP-0006', firstName: 'Paul', lastName: 'Mbarga', jobTitle: 'Chauffeur', department: 'Logistique', role: 'EMPLOYE', status: 'INVITED', siteId: site.id, inviteCode: 'BIENVENU', inviteExpiresAt: new Date(Date.now() + 7 * 86400_000) },
  });

  // Historique : 6 derniers jours ouvrés (hors aujourd'hui)
  const ev = (userId: number, type: EventType, workDate: string, hhmm: string) => ({
    userId, siteId: site.id, type, workDate, occurredAt: localToUtc(workDate, hhmm), source: 'MOBILE' as const,
    latitude: site.latitude + 0.0003, longitude: site.longitude - 0.0002, accuracyM: 18, distanceM: 40,
  });
  const jitter = (base: string, spread: number, seed: number) => {
    const [h, m] = base.split(':').map(Number);
    const t = h * 60 + m + ((seed * 37) % (spread * 2 + 1)) - spread;
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  };
  let d = today;
  let n = 0;
  const taskTitles = ['Vérifier les machines', 'Contrôler les stocks', 'Nettoyer la zone B', 'Préparer le rapport', 'Réception des fournitures', 'Inventaire du rayon C'];
  while (n < 6) {
    d = addDays(d, -1);
    if (isoWeekday(d) === 7) continue;
    n++;
    for (let i = 0; i < employees.length; i++) {
      const e = employees[i];
      if ((n + i) % 7 === 3) continue; // absence occasionnelle
      const seed = n * 10 + i;
      const arrival = (n + i) % 5 === 0 ? jitter('08:25', 10, seed) : jitter('07:58', 6, seed);
      await prisma.attendanceEvent.createMany({
        data: [
          ev(e.id, 'ARRIVAL', d, arrival),
          ev(e.id, 'BREAK_START', d, jitter('12:10', 8, seed)),
          ev(e.id, 'BREAK_END', d, jitter('13:10', 8, seed)),
          ev(e.id, 'DEPARTURE', d, jitter('17:35', 12, seed)),
        ],
      });
      for (let k = 0; k < 2; k++) {
        await prisma.task.create({
          data: {
            title: taskTitles[(i + k + n) % taskTitles.length], assigneeId: e.id, createdById: e.id,
            plannedDate: d, originalDate: d, status: 'DONE', completedAt: localToUtc(d, '17:00'),
            history: { create: [{ action: 'CREATED', toValue: d, actorId: e.id }, { action: 'STATUS', fromValue: 'TODO', toValue: 'DONE', actorId: e.id }] },
          },
        });
      }
    }
  }

  // Aujourd'hui : tâches préparées par le chef + une tâche reportée d'hier
  for (let i = 0; i < employees.length; i++) {
    await prisma.task.create({
      data: {
        title: taskTitles[(i + 2) % taskTitles.length], priority: i === 0 ? 'HIGH' : 'NORMAL', assigneeId: employees[i].id, createdById: chef.id,
        plannedDate: today, originalDate: today, history: { create: { action: 'CREATED', toValue: today, actorId: chef.id } },
      },
    });
  }
  const yesterday = addDays(today, -1);
  await prisma.task.create({
    data: {
      title: 'Préparer le rapport mensuel', assigneeId: employees[0].id, createdById: employees[0].id,
      plannedDate: yesterday, originalDate: yesterday, status: 'IN_PROGRESS', comment: 'En attente des chiffres de la comptabilité',
      history: { create: { action: 'CREATED', toValue: yesterday, actorId: employees[0].id } },
    },
  });

  await prisma.correctionRequest.create({
    data: { userId: employees[2].id, workDate: yesterday, type: 'DEPARTURE', requestedTime: '17:40', reason: 'Batterie du téléphone déchargée au moment de pointer la sortie.' },
  });
  await prisma.notification.create({ data: { userId: admin.id, level: 'info', title: 'Bienvenue sur PointagePro', body: 'Commencez par vérifier la position et le rayon de vos sites de travail.' } });

  console.log('Données de démonstration créées.');
  console.log('  Super-admin : admin@pointagepro.cm / Admin@2026');
  console.log('  Agent       : agent@pointagepro.cm / Agent@2026');
  console.log('  Chef        : chef@pointagepro.cm / Chef@2026');
  console.log('  Employés EMP-0001…0005 : PIN kiosque 1234, codes d\'enrôlement DEMO1AX2…DEMO5EK2');
  console.log('  Invitation EMP-0006 : BIENVENU');
}

main().finally(() => prisma.$disconnect());
