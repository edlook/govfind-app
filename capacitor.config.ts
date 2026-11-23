// ENTWURF für Capacitor (nativ iOS/Android). Es werden keine nativen Hüllen gebaut; Schritte siehe README.
// Der Typ kommt aus @capacitor/cli (erst bei Einrichtung installieren); hier lokal strukturell beschrieben.
const config = {
  appId: 'de.example.govfind', // [Platzhalter] Bundle-ID des Eigentümers (Apple/Google-Konto nötig)
  appName: 'GOVfind',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  ios: { contentInset: 'always' },
};
export default config;
