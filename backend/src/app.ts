import type { Config } from './config.ts';
import type { Db } from './db/db.ts';
import type { PgPool } from './db/pg.ts';
import type { EventHub } from './realtime/hub.ts';
import type { MlClient } from './ml/client.ts';
import type { Mailer } from './mail/mailer.ts';
import type { RateLimiter } from './lib/util.ts';
import type { HospitalAdapter } from './hospital/adapter.ts';

export interface App {
  cfg: Config;
  pool: PgPool;
  db: Db;
  hub: EventHub;
  ml: MlClient;
  mailer: Mailer;
  rate: RateLimiter;
  hospital: HospitalAdapter;
}
