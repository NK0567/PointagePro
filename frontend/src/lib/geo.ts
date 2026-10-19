export interface Position {
  latitude: number;
  longitude: number;
  accuracy: number;
}

/** Position GPS haute précision. Le contrôle définitif est fait par le serveur. */
export function getPosition(timeoutMs = 15000): Promise<Position> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error("La géolocalisation n'est pas disponible sur cet appareil."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }),
      (err) => {
        const messages: Record<number, string> = {
          1: "Autorisez l'accès à votre position dans le navigateur pour pouvoir pointer.",
          2: 'Position introuvable. Activez le GPS et réessayez.',
          3: 'La recherche de position a pris trop de temps. Réessayez à découvert.',
        };
        reject(new Error(messages[err.code] ?? 'Position indisponible.'));
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}
