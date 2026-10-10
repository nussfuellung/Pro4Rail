# Pro4Rail-Rocrail-Bridge

Die App läuft im Internet (HTTPS) und kann deshalb nicht direkt auf Rocrail in deinem Heimnetz zugreifen.
Die Bridge ist ein kleines Programm auf dem Rechner, auf dem Rocrail läuft. Sie verbindet sich von innen nach außen,
es muss also kein Port am Router geöffnet werden.

```
App (Handy)  ->  Supabase  <-  Bridge  ->  Rocrail (TCP 8051)
```

## Einrichten

1. Datenbank: Die Tabellen `rocrail_layout` und `rocrail_commands` stehen am Ende von `supabase/schema.sql`.
   Den neuen Teil im Supabase-SQL-Editor ausführen.
2. Node.js 20 oder neuer installieren (nodejs.org). Zusätzliche Pakete sind nicht nötig.
3. `config.example.json` nach `config.json` kopieren und ausfüllen. Eintragen: Supabase-URL, anon Key und
   E-Mail und Passwort deines Pro4Rail-Kontos. Die Bridge meldet sich damit an und sieht nur deine eigenen Daten.
   Lege die Datei nur auf diesem Rechner ab und gib sie nicht weiter.
4. In Rocrail: Server läuft, TCP-Port 8051 (Standard).
5. Starten: `node src/bridge.mjs` im Ordner `rocrail-bridge`.
   Beim Start holt die Bridge den Plan und meldet ihn an die App. In der App erscheint oben „Bridge verbunden“.

Dauerbetrieb: unter Windows zum Beispiel mit der Aufgabenplanung (Aufgabe bei Anmeldung, Programm `node`,
Argument `src\bridge.mjs`, Starten in: dieser Ordner). Unter Linux als systemd-Dienst.

## Sicherheit

- Befehle gelten nur für Objekte, die im Plan stehen. Unbekannte Namen werden abgelehnt.
- Befehle, die älter als `commandMaxAgeSec` (Standard 10 Sekunden) sind, werden verworfen. So fährt keine Lok los,
  weil ein Befehl liegen geblieben ist. Nothalt wird immer ausgeführt.
- Ist Rocrail nicht verbunden, werden Befehle verworfen und nicht später nachgeholt.
- Nothalt sendet Fahrstrom aus und anschließend Nothalt für alle Loks.
- Wer Zugriff auf dein Pro4Rail-Konto hat, kann deine Anlage steuern. Nutze ein eigenes, starkes Passwort.

## Befehle der App

| Typ | Nutzdaten | Rocrail-Befehl |
|---|---|---|
| power | on | sys go / stop |
| nothalt | | sys stop, sys ebreak |
| plan_reload | | model plan (Plan neu holen) |
| plan_reload | | model plan (Plan neu holen) |
| auto | on | auto on / off |
| lc_speed | id, v (0 bis 100 Prozent) | lc V |
| lc_dir | id, forward | lc dir |
| lc_stop | id | lc V=0 |
| lc_fn | id, fn (0 bis 31), on | fn |
| lc_auto | id, on | lc go / stop |
| sw_set | id, state (flip, straight, turnout, left, right) | sw cmd |
| st_set | id | st set |
| co_set | id, on | co on / off |

Tempo: Die App arbeitet in Prozent. Bei Loks mit `V_mode` km/h rechnet die Bridge mit `V_max` um.

## Tests

`npm test` im Ordner `rocrail-bridge`. Die Tests nutzen ein Schein-Rocrail und prüfen Rahmenformat, Plan lesen,
Befehle, Verwerfen alter Befehle und Rückmeldungen. Ein echtes Rocrail ist dafür nicht nötig.

## Stand und Grenzen

Das Protokoll (Port 8051, XML mit Rahmen, Befehlsformate) ist dem Verhalten des Open-Source-Clients py-rocrail
nachgebaut und gegen einen Beispielplan getestet, **nicht** gegen eine laufende Rocrail-Installation.
Unsicher sind vor allem die Rückmeldung des Fahrstroms und die Bedeutung des Loktempos je nach Loktyp.
Fehler bitte mit der Bridge-Ausgabe melden: Jede gesendete Nachricht steht im Protokoll.
