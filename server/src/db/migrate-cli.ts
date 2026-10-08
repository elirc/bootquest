// `npm run migrate -w @bootquest/server` — open BOOTQUEST_DB and apply migrations.
// Refuses to run without BOOTQUEST_DB (no default path, by design).
import { openDb } from './database.ts';
import { schemaVersion } from './migrate.ts';

const db = openDb();
try {
  console.log(`bootquest db ${db.path} at schema version ${schemaVersion(db)}`);
} finally {
  db.close();
}
