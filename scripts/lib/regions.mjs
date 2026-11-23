// Geofabrik-Länderauszüge für ganz Deutschland (16 Bundesländer). Land (Kürzel) ist durch den Auszug bekannt.
// Reihenfolge = Verarbeitungsreihenfolge im Merge: die Stadtstaaten zuerst. Geofabrik liefert "Brandenburg (mit Berlin)"
// und "Niedersachsen (mit Bremen)"; doppelte OSM-Objekte (gleiche Typ+ID) werden beim Zusammenführen verworfen,
// das erste Vorkommen gewinnt (Stadtstaat).
const G = 'https://download.geofabrik.de/europe/germany/';
const sub = (id) => `${G}${id}/${id}-latest.osm.pbf`;
export const REGIONS = {
  berlin: { name: 'Berlin', state: 'BE', url: sub('berlin'), overpassArea: 'area["ISO3166-2"="DE-BE"]', wholeAreaIsCity: true },
  hamburg: { name: 'Hamburg', state: 'HH', url: sub('hamburg'), overpassArea: 'area["ISO3166-2"="DE-HH"]', wholeAreaIsCity: true },
  bremen: { name: 'Bremen', state: 'HB', url: sub('bremen'), overpassArea: 'area["ISO3166-2"="DE-HB"]', wholeAreaIsCity: false },
  'baden-wuerttemberg': { name: 'Baden-Württemberg', state: 'BW', url: sub('baden-wuerttemberg'), overpassArea: 'area["ISO3166-2"="DE-BW"]' },
  bayern: { name: 'Bayern', state: 'BY', url: sub('bayern'), overpassArea: 'area["ISO3166-2"="DE-BY"]' },
  brandenburg: { name: 'Brandenburg', state: 'BB', url: sub('brandenburg'), overpassArea: 'area["ISO3166-2"="DE-BB"]' },
  hessen: { name: 'Hessen', state: 'HE', url: sub('hessen'), overpassArea: 'area["ISO3166-2"="DE-HE"]' },
  'mecklenburg-vorpommern': { name: 'Mecklenburg-Vorpommern', state: 'MV', url: sub('mecklenburg-vorpommern'), overpassArea: 'area["ISO3166-2"="DE-MV"]' },
  niedersachsen: { name: 'Niedersachsen', state: 'NI', url: sub('niedersachsen'), overpassArea: 'area["ISO3166-2"="DE-NI"]' },
  'nordrhein-westfalen': { name: 'Nordrhein-Westfalen', state: 'NW', url: sub('nordrhein-westfalen'), overpassArea: 'area["ISO3166-2"="DE-NW"]' },
  'rheinland-pfalz': { name: 'Rheinland-Pfalz', state: 'RP', url: sub('rheinland-pfalz'), overpassArea: 'area["ISO3166-2"="DE-RP"]' },
  saarland: { name: 'Saarland', state: 'SL', url: sub('saarland'), overpassArea: 'area["ISO3166-2"="DE-SL"]' },
  sachsen: { name: 'Sachsen', state: 'SN', url: sub('sachsen'), overpassArea: 'area["ISO3166-2"="DE-SN"]' },
  'sachsen-anhalt': { name: 'Sachsen-Anhalt', state: 'ST', url: sub('sachsen-anhalt'), overpassArea: 'area["ISO3166-2"="DE-ST"]' },
  'schleswig-holstein': { name: 'Schleswig-Holstein', state: 'SH', url: sub('schleswig-holstein'), overpassArea: 'area["ISO3166-2"="DE-SH"]' },
  thueringen: { name: 'Thüringen', state: 'TH', url: sub('thueringen'), overpassArea: 'area["ISO3166-2"="DE-TH"]' },
};
export const ALL_REGIONS = Object.keys(REGIONS);
