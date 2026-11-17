CREATE TABLE IF NOT EXISTS swarm_orders (
  owner TEXT NOT NULL,
  id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  budget TEXT NOT NULL,
  cap TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','closed')),
  PRIMARY KEY(owner,id)
);
