// Supabase-Zugangsdaten hier eintragen (Project Settings -> API).
// Der anon key ist öffentlich vorgesehen; die Sicherheit kommt von Row Level Security (supabase/schema.sql).
// Solange beides leer ist, läuft die App im Demo-Modus (Daten nur lokal im Browser).
export const CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  // Öffentliche Fahrplan-API (inoffiziell, kann ausfallen)
  TRANSPORT_API: 'https://v6.db.transport.rest',
  // Limits für Nutzer-Uploads
  MAX_AUDIO_BYTES: 5 * 1024 * 1024,
  MAX_USER_BYTES: 50 * 1024 * 1024,
};
