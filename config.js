// Supabase-Zugangsdaten hier eintragen (Project Settings -> API).
// Der anon key ist öffentlich vorgesehen; die Sicherheit kommt von Row Level Security (supabase/schema.sql).
// Solange beides leer ist, läuft die App im Demo-Modus (Daten nur lokal im Browser).
export const CONFIG = {
  SUPABASE_URL: 'https://uzvhwhzrsaylblkavroe.supabase.co',
  // Adresse dieser App (GitHub Pages), auf die Links in Bestätigungs- und Passwort-Mails zurückführen, zum Beispiel
  // 'https://DEINNAME.github.io/REPO/'. Leer lassen: Die Adresse, unter der die App gerade geöffnet ist. In Supabase muss sie
  // unter Authentication > URL Configuration als Redirect URL stehen (und als Site URL, sonst landen Links auf localhost:3000).
  SITE_URL: '',
  SUPABASE_ANON_KEY: 'sb_publishable_XvjxV2ZsrkN-tPZt032MlA_8lRWvXc1',
  // Fahrplandaten (Haltestellensuche und Abfahrten).
  // 'transitous': offene Schnittstelle der Transitous-Gemeinschaft, ohne Schlüssel (https://transitous.org/api/).
  //   Bedingungen von Transitous: nur nichtkommerzielle Nutzung, Quellcode des Projekts muss unter einer offenen Lizenz
  //   stehen, Verweis auf die Quellenseite (ist im Seitenfuß der App). Ohne Zusage, kann jederzeit enden.
  // 'dbrest': eigene Instanz von db-rest / db-vendo-client (Docker), Adresse unten bei DBREST_API eintragen.
  DATA_SOURCE: 'transitous',
  TRANSITOUS_API: 'https://api.transitous.org',
  GEOCODE_PATH: '/api/v1/geocode',
  STOPTIMES_PATH: '/api/v6/stoptimes',
  DBREST_API: '',
  // Limits für Nutzer-Uploads
  MAX_AUDIO_BYTES: 5 * 1024 * 1024,
  MAX_GIF_BYTES: 1.5 * 1024 * 1024,   // animierte GIFs bleiben unverändert
  MAX_USER_BYTES: 50 * 1024 * 1024,
};
