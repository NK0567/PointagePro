import type { DailyRow } from '../api';
import { Badge } from './ui';

export function DayStatusBadge({ status }: { status: DailyRow['status'] }) {
  switch (status) {
    case 'PRESENT': return <Badge tone="green" dot>Présent</Badge>;
    case 'DONE': return <Badge tone="blue" dot>Journée terminée</Badge>;
    case 'LATE': return <Badge tone="red" dot>En retard</Badge>;
    case 'ON_BREAK': return <Badge tone="amber" dot>En pause</Badge>;
    case 'ABSENT': return <Badge tone="red">Absent</Badge>;
    case 'NOT_YET': return <Badge tone="slate">Pas encore arrivé</Badge>;
    default: return <Badge tone="slate">Repos</Badge>;
  }
}
