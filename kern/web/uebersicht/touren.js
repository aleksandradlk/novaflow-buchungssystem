// Tours: appointments with an address, sorted by postcode, as Google Maps route links.
// Pure functions (no DOM) – also used by the Node tests.
// The link only opens Google Maps when a staff member clicks it (no API key, nothing is
// loaded from Google beforehand). Opening it sends the addresses to Google – the page says so.

const MAPS = 'https://www.google.com/maps/dir/?api=1';

/** Google Maps allows at most 9 waypoints per route link. */
export const MAX_ZWISCHENSTOPPS = 9;

export function adresseVon(k) {
  const strasse = String(k.strasse || '').trim();
  const plz = String(k.plz || '').trim();
  const ort = String(k.ort || '').trim();
  return strasse && plz && ort ? `${strasse}, ${plz} ${ort}` : '';
}

function schluessel(adresse) {
  return adresse.toLowerCase().replace(/\s+/g, ' ').replace(/str\./g, 'straße');
}

/**
 * buchungen: [{ id, kontakt: { strasse, plz, ort, ... }, ... }]
 * → stops sorted by postcode, town, street; same address = one stop with several bookings.
 */
export function tourPlanen(buchungen) {
  const stopps = new Map();
  for (const b of buchungen) {
    const adresse = adresseVon(b.kontakt || {});
    if (!adresse) continue;
    const key = schluessel(adresse);
    if (!stopps.has(key)) {
      stopps.set(key, {
        adresse,
        plz: String(b.kontakt.plz).trim(),
        ort: String(b.kontakt.ort).trim(),
        strasse: String(b.kontakt.strasse).trim(),
        buchungen: [],
      });
    }
    stopps.get(key).buchungen.push(b);
  }
  const vergleich = (a, b) => a.localeCompare(b, 'de', { numeric: true, sensitivity: 'base' });
  return [...stopps.values()].sort((a, b) => vergleich(a.plz, b.plz) || vergleich(a.ort, b.ort) || vergleich(a.strasse, b.strasse));
}

/**
 * Route links in the given order. start = address of the business.
 * Each link covers up to MAX_ZWISCHENSTOPPS waypoints + destination; the next link starts
 * where the previous one ended.
 */
export function mapsLinks(start, stopps, maxZwischen = MAX_ZWISCHENSTOPPS) {
  const enc = encodeURIComponent;
  const links = [];
  let von = start;
  for (let i = 0; i < stopps.length; i += maxZwischen + 1) {
    const teil = stopps.slice(i, i + maxZwischen + 1).map((s) => s.adresse);
    const ziel = teil[teil.length - 1];
    const zwischen = teil.slice(0, -1);
    let url = `${MAPS}&origin=${enc(von)}&destination=${enc(ziel)}`;
    if (zwischen.length) url += `&waypoints=${zwischen.map(enc).join('%7C')}`;
    url += '&travelmode=driving';
    links.push({ url, von, nach: ziel, stopps: teil.length, ab: i + 1, bis: i + teil.length });
    von = ziel;
  }
  return links;
}
