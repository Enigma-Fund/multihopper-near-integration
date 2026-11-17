CREATE TABLE IF NOT EXISTS swarm_orders (
  owner TEXT NOT NULL,
  id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  budget TEXT NOT NULL,
  cap TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','closed')),
  PRIMARY KEY(owner,id)
);

CREATE TABLE IF NOT EXISTS swarm_approvals (
  owner TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, item TEXT NOT NULL,
  statement TEXT NOT NULL, PRIMARY KEY(owner,id,kind,item)
);
