CREATE TABLE IF NOT EXISTS swarm_near_links (
  owner TEXT NOT NULL, id TEXT NOT NULL, near_owner TEXT NOT NULL, near_job TEXT NOT NULL,
  job_key TEXT NOT NULL UNIQUE, access_block TEXT NOT NULL,
  PRIMARY KEY(owner,id), UNIQUE(near_owner,near_job), FOREIGN KEY(owner,id) REFERENCES swarm_orders(owner,id)
);
CREATE TABLE IF NOT EXISTS swarm_invoices (
  owner TEXT NOT NULL, id TEXT NOT NULL, invoice TEXT NOT NULL, external_id TEXT NOT NULL UNIQUE,
  amount INTEGER NOT NULL CHECK(amount>0), minimum INTEGER NOT NULL CHECK(minimum>0 AND minimum<=amount),
  transfer_id TEXT UNIQUE, quoted_net TEXT, rescue_messages TEXT,
  outcome TEXT, received TEXT, evidence TEXT,
  PRIMARY KEY(owner,invoice), FOREIGN KEY(owner,id) REFERENCES swarm_near_links(owner,id)
);
CREATE INDEX IF NOT EXISTS swarm_invoices_job ON swarm_invoices(owner,id);
CREATE TABLE IF NOT EXISTS swarm_final_signatures (
  signature TEXT PRIMARY KEY, external_id TEXT NOT NULL REFERENCES swarm_invoices(external_id)
);
CREATE TABLE IF NOT EXISTS swarm_wallet_batches (
  reference TEXT NOT NULL REFERENCES swarm_invoices(external_id), mode TEXT NOT NULL CHECK(mode IN ('payment','recovery')),
  items TEXT NOT NULL, extra TEXT NOT NULL, progress TEXT NOT NULL DEFAULT '[]', done INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(reference,mode)
);
CREATE TABLE IF NOT EXISTS swarm_notification_key (
  id INTEGER PRIMARY KEY CHECK(id=1), nonce TEXT NOT NULL, ciphertext TEXT NOT NULL
);
