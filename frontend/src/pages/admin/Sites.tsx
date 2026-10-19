import L from 'leaflet';
import { Crosshair, MapPin, Pencil, Plus } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { api, type Site } from '../../api';
import { isAdmin, useAuth } from '../../auth';
import { PageTitle } from '../../components/AdminLayout';
import { Alert, Badge, Button, Card, Field, Modal, Spinner } from '../../components/ui';
import { getPosition } from '../../lib/geo';

// Icône de marqueur intégrée (évite les chemins d'images cassés de Leaflet avec Vite)
const pin = L.divIcon({
  className: '',
  html: '<div style="width:28px;height:28px;border-radius:50% 50% 50% 0;background:#1d4ed8;transform:rotate(-45deg);border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)"></div>',
  iconSize: [28, 28],
  iconAnchor: [14, 28],
});

const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function Recenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => { map.setView([lat, lng], Math.max(map.getZoom(), 16)); }, [lat, lng, map]);
  return null;
}

function ClickToPlace({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

export function Sites() {
  const { user } = useAuth();
  const admin = isAdmin(user?.role);
  const [sites, setSites] = useState<Site[] | null>(null);
  const [editing, setEditing] = useState<Site | 'new' | null>(null);
  const load = () => api.get<Site[]>('/admin/sites').then(setSites);
  useEffect(() => { load(); }, []);

  if (!sites) return <Spinner />;
  const center: [number, number] = sites[0] ? [sites[0].latitude, sites[0].longitude] : [4.0511, 9.7679];

  return (
    <>
      <PageTitle
        title="Géolocalisation des sites"
        subtitle="Lieux de service, rayon autorisé et horaires. Un employé ne peut pointer que dans la zone de son site."
        action={admin && <Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> Nouveau site</Button>}
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card className="overflow-hidden p-2">
          <MapContainer center={center} zoom={13} style={{ height: 520 }} scrollWheelZoom>
            <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {sites.map((s) => (
              <span key={s.id}>
                <Marker position={[s.latitude, s.longitude]} icon={pin} />
                <Circle center={[s.latitude, s.longitude]} radius={s.radiusM} pathOptions={{ color: s.active ? '#1d4ed8' : '#94a3b8', fillOpacity: 0.15 }} />
              </span>
            ))}
          </MapContainer>
        </Card>
        <div className="space-y-4">
          {sites.map((s) => (
            <div key={s.id} className="card p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="flex items-center gap-2 font-semibold text-slate-900"><MapPin className="h-4 w-4 text-brand-700" /> {s.name}</p>
                  {s.address && <p className="mt-0.5 text-sm text-slate-500">{s.address}</p>}
                </div>
                {admin && <button onClick={() => setEditing(s)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={`Modifier ${s.name}`}><Pencil className="h-4 w-4" /></button>}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge tone="blue">Rayon {s.radiusM} m</Badge>
                <Badge>{s.startTime} – {s.endTime}</Badge>
                <Badge>Tolérance {s.lateToleranceMin} min</Badge>
                <Badge>{s.workDays.split(',').map((d) => DAYS[Number(d) - 1]).join(' ')}</Badge>
                <Badge tone="violet">{s._count?.users ?? 0} employé(s)</Badge>
                {!s.active && <Badge tone="red">Inactif</Badge>}
              </div>
              <p className="mt-2 text-xs tabular-nums text-slate-400">{s.latitude.toFixed(5)}, {s.longitude.toFixed(5)}</p>
            </div>
          ))}
        </div>
      </div>
      {editing && <SiteForm initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </>
  );
}

function SiteForm({ initial, onClose, onSaved }: { initial: Site | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: initial?.name ?? '', address: initial?.address ?? '',
    latitude: initial?.latitude ?? 4.0511, longitude: initial?.longitude ?? 9.7679,
    radiusM: initial?.radiusM ?? 100, maxAccuracyM: initial?.maxAccuracyM ?? 80,
    startTime: initial?.startTime ?? '08:00', endTime: initial?.endTime ?? '17:00',
    lateToleranceMin: initial?.lateToleranceMin ?? 10, workDays: initial?.workDays ?? '1,2,3,4,5',
    maxBreaks: initial?.maxBreaks ?? 2, active: initial?.active ?? true, timezone: initial?.timezone ?? 'Africa/Douala',
  });
  const [error, setError] = useState('');
  const days = new Set(f.workDays.split(',').map(Number));

  const toggleDay = (d: number) => {
    const next = new Set(days);
    if (next.has(d)) next.delete(d); else next.add(d);
    setF({ ...f, workDays: [...next].sort().join(',') });
  };

  async function here() {
    try {
      const p = await getPosition();
      setF({ ...f, latitude: p.latitude, longitude: p.longitude });
    } catch (e) { setError((e as Error).message); }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const body = { ...f, radiusM: Number(f.radiusM), maxAccuracyM: Number(f.maxAccuracyM), lateToleranceMin: Number(f.lateToleranceMin), maxBreaks: Number(f.maxBreaks), latitude: Number(f.latitude), longitude: Number(f.longitude) };
      if (initial) await api.put(`/admin/sites/${initial.id}`, body); else await api.post('/admin/sites', body);
      onSaved();
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <Modal open onClose={onClose} title={initial ? `Modifier « ${initial.name} »` : 'Nouveau site de travail'} wide>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nom du site" required><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
          <Field label="Adresse"><input className="input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="label mb-0">Position — cliquez sur la carte pour placer le site</span>
            <Button type="button" size="sm" variant="secondary" onClick={here}><Crosshair className="h-3.5 w-3.5" /> Ma position</Button>
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <MapContainer center={[f.latitude, f.longitude]} zoom={16} style={{ height: 300 }}>
              <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <Recenter lat={f.latitude} lng={f.longitude} />
              <ClickToPlace onPick={(lat, lng) => setF((x) => ({ ...x, latitude: lat, longitude: lng }))} />
              <Marker position={[f.latitude, f.longitude]} icon={pin} />
              <Circle center={[f.latitude, f.longitude]} radius={Number(f.radiusM) || 0} pathOptions={{ color: '#1d4ed8', fillOpacity: 0.15 }} />
            </MapContainer>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <input className="input text-xs tabular-nums" type="number" step="any" value={f.latitude} onChange={(e) => setF({ ...f, latitude: Number(e.target.value) })} aria-label="Latitude" />
            <input className="input text-xs tabular-nums" type="number" step="any" value={f.longitude} onChange={(e) => setF({ ...f, longitude: Number(e.target.value) })} aria-label="Longitude" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Rayon autorisé (m)" hint="Adapté à la taille du site et à la précision GPS"><input className="input" type="number" min={20} max={5000} value={f.radiusM} onChange={(e) => setF({ ...f, radiusM: Number(e.target.value) })} /></Field>
          <Field label="Précision GPS max (m)"><input className="input" type="number" min={10} max={500} value={f.maxAccuracyM} onChange={(e) => setF({ ...f, maxAccuracyM: Number(e.target.value) })} /></Field>
          <Field label="Début"><input className="input" type="time" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} /></Field>
          <Field label="Fin"><input className="input" type="time" value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} /></Field>
          <Field label="Tolérance retard (min)"><input className="input" type="number" min={0} max={120} value={f.lateToleranceMin} onChange={(e) => setF({ ...f, lateToleranceMin: Number(e.target.value) })} /></Field>
          <Field label="Pauses max / jour"><input className="input" type="number" min={0} max={6} value={f.maxBreaks} onChange={(e) => setF({ ...f, maxBreaks: Number(e.target.value) })} /></Field>
          <div className="sm:col-span-2">
            <span className="label">Jours travaillés</span>
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((d, i) => (
                <button type="button" key={d} onClick={() => toggleDay(i + 1)} className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${days.has(i + 1) ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600'}`}>{d}</button>
              ))}
            </div>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Site actif</label>
        <div className="flex justify-end gap-3"><Button type="button" variant="secondary" onClick={onClose}>Annuler</Button><Button type="submit">Enregistrer</Button></div>
      </form>
    </Modal>
  );
}
