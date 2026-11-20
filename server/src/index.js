import { config } from './config.js';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { createNotifier } from './notify.js';
import { startScheduler } from './scheduler.js';
import { seedDatabase } from './seed.js';

const db = openDb(config.dbFile);
if (db.prepare('SELECT COUNT(*) AS n FROM patients').get().n === 0) {
  seedDatabase(db);
  console.log('Empty database: loaded synthetic demo data.');
}

const notifier = createNotifier({ config, db });
startScheduler({ db, notifier, config });

createApp({ db, config, notifier }).listen(config.port, () => {
  console.log(`TheCarePal medication server on http://localhost:${config.port} (time zone ${config.tz})`);
  if (config.caregiverCode === 'nurse123') console.warn('Using the default demo access codes. Set CAREGIVER_CODE and FAMILY_CODE in server/.env.');
});
