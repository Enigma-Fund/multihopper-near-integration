"""Synthetic-only NEAR policy integration. No network, wallet SDK, or live signing.

The native bridge runs the Rust contract against NEAR SDK MockedBlockchain. Two
SQLite databases model independent NEAR/coordinator and foreign-chain commits.
The foreign ledger is an explicit fixture, not a production execution adapter.
"""
import contextlib
import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess

ROOT = Path(__file__).resolve().parent
BINARY = ROOT / 'contract/target/debug/near-policy-fixture'
CHAINS = ('base', 'ethereum', 'bnb', 'robinhood', 'arbitrum', 'solana')
ASSETS = ('SYNTH-USD', 'SYNTH-NATIVE')
MAX_AMOUNT = 2**63 - 1  # SQLite fixture limit; NEAR policy uses checked u128.


def canonical(value):
    return json.dumps(value, separators=(',', ':'), sort_keys=True)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def amount(value):
    if type(value) is not int or not 0 < value <= MAX_AMOUNT:
        raise ValueError('positive bounded integer synthetic units required')
    return value


def connection(path):
    db = sqlite3.connect(path, timeout=30, isolation_level=None)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    db.execute('PRAGMA synchronous=FULL')
    return db


@contextlib.contextmanager
def transaction(path):
    db = connection(path)
    try:
        db.execute('BEGIN IMMEDIATE')
        yield db
        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()


class Interrupted(RuntimeError):
    pass


def interrupt(stage, wanted):
    if stage == wanted:
        raise Interrupted(stage)


class SyntheticChain:
    """Local fixture with durable idempotency and cancellation fences.

    Public methods are a test harness, NOT authenticated public APIs. Production
    needs an actual signer, transaction encoder, nonce/finality reconciliation
    and an enforceable cancellation equivalent before releasing reservations.
    """
    def __init__(self, path):
        self.path = Path(path)
        with transaction(self.path) as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS custody (
                    address TEXT PRIMARY KEY, owner TEXT NOT NULL, chain TEXT NOT NULL,
                    asset TEXT NOT NULL, funded INTEGER NOT NULL, principal INTEGER NOT NULL CHECK(principal>=0),
                    quarantine INTEGER NOT NULL DEFAULT 0 CHECK(quarantine>=0), closed INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS receipts (
                    txid TEXT PRIMARY KEY, binding TEXT NOT NULL, outcome TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS credits (
                    owner TEXT NOT NULL, chain TEXT NOT NULL, asset TEXT NOT NULL,
                    kind TEXT NOT NULL, units INTEGER NOT NULL CHECK(units>=0),
                    PRIMARY KEY(owner,chain,asset,kind));
                CREATE TABLE IF NOT EXISTS sponsor (id INTEGER PRIMARY KEY CHECK(id=1), fees INTEGER NOT NULL);
                INSERT OR IGNORE INTO sponsor VALUES(1,0);
            ''')

    def fund(self, address, owner, chain, asset, units):
        amount(units)
        if chain not in CHAINS or asset not in ASSETS:
            raise ValueError('only synthetic assets and enumerated fixtures')
        with transaction(self.path) as db:
            old = db.execute('SELECT * FROM custody WHERE address=?', (address,)).fetchone()
            if old:
                if (old['owner'], old['chain'], old['asset'], old['funded']) != (owner, chain, asset, units):
                    raise ValueError('custody assignment immutable; no commingling')
                return
            db.execute('INSERT INTO custody(address,owner,chain,asset,funded,principal) VALUES(?,?,?,?,?,?)',
                       (address, owner, chain, asset, units, units))

    def unsolicited(self, address, units):
        amount(units)
        with transaction(self.path) as db:
            row = db.execute('SELECT quarantine FROM custody WHERE address=?', (address,)).fetchone()
            if not row or row[0] > MAX_AMOUNT-units:
                raise ValueError('unknown custody or overflow')
            db.execute('UPDATE custody SET quarantine=quarantine+? WHERE address=?', (units,address))

    def receipt(self, txid):
        with contextlib.closing(connection(self.path)) as db:
            row = db.execute('SELECT * FROM receipts WHERE txid=?', (txid,)).fetchone()
            return dict(row) if row else None

    def apply(self, envelope, cancel=False):
        """Atomic external settlement OR a durable cancellation tombstone."""
        binding = digest(envelope)
        with transaction(self.path) as db:
            old = db.execute('SELECT * FROM receipts WHERE txid=?', (envelope['txid'],)).fetchone()
            if old:
                if old['binding'] != binding:
                    raise ValueError('transaction id conflict')
                return old['outcome']
            if cancel:
                outcome = 'cancelled'
            else:
                units = amount(envelope['amount'])
                row = db.execute('SELECT * FROM custody WHERE address=?', (envelope['custody'],)).fetchone()
                if not row or row['closed'] or (row['owner'], row['chain'], row['asset']) != (envelope['owner'], envelope['chain'], envelope['asset']):
                    raise ValueError('custody domain mismatch')
                if row['principal'] < units:
                    raise ValueError('insufficient rightful principal; quarantine excluded')
                if envelope['kind'] not in ('payment','recovery'):
                    raise ValueError('unknown operation')
                if envelope['kind'] == 'recovery' and envelope['recipient'] != row['owner']:
                    raise ValueError('recovery must return to original owner')
                if envelope['kind'] == 'recovery' and units != row['principal']:
                    raise ValueError('recovery must exhaust rightful principal only')
                credit = db.execute('SELECT units FROM credits WHERE owner=? AND chain=? AND asset=? AND kind=?',
                                    (envelope['recipient'],row['chain'],row['asset'],envelope['kind'])).fetchone()
                if credit and credit[0] > MAX_AMOUNT-units:
                    raise ValueError('recipient overflow')
                db.execute('UPDATE custody SET principal=principal-?, closed=? WHERE address=?',
                           (units, int(envelope['kind']=='recovery'), envelope['custody']))
                db.execute('INSERT INTO credits VALUES(?,?,?,?,?) ON CONFLICT(owner,chain,asset,kind) DO UPDATE SET units=units+excluded.units',
                           (envelope['recipient'],row['chain'],row['asset'],envelope['kind'],units))
                # Simple sponsor pays one synthetic fee per actual transfer. No principal deduction.
                db.execute('UPDATE sponsor SET fees=fees+1 WHERE id=1')
                outcome = 'delivered'
            db.execute('INSERT INTO receipts VALUES(?,?,?)', (envelope['txid'], binding, outcome))
            return outcome

    def audit(self):
        with contextlib.closing(connection(self.path)) as db:
            return {table:[dict(r) for r in db.execute('SELECT * FROM '+table)]
                    for table in ('custody','receipts','credits','sponsor')}


class Treasury:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.path = self.directory/'coordinator.sqlite'
        self.chain = SyntheticChain(self.directory/'synthetic-chain.sqlite')
        with transaction(self.path) as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT);
                INSERT OR IGNORE INTO state VALUES(1,NULL);
                CREATE TABLE IF NOT EXISTS positions (
                    policy TEXT PRIMARY KEY, custody TEXT NOT NULL UNIQUE, owner TEXT NOT NULL,
                    chain TEXT NOT NULL, asset TEXT NOT NULL, funded INTEGER NOT NULL,
                    principal INTEGER NOT NULL CHECK(principal>=0), status TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS payments (
                    id TEXT PRIMARY KEY, policy TEXT NOT NULL REFERENCES positions(policy),
                    envelope TEXT NOT NULL, status TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS recoveries (
                    policy TEXT PRIMARY KEY REFERENCES positions(policy), envelope TEXT NOT NULL,
                    status TEXT NOT NULL);
            ''')

    def _policy(self, db, caller, now, command):
        state = db.execute('SELECT value FROM state WHERE id=1').fetchone()[0]
        proc = subprocess.run([str(BINARY)], input=canonical({'state':json.loads(state) if state else None,
            'caller':caller, 'now':now, 'command':command}), text=True, capture_output=True, check=True, timeout=15,
            env={'PATH':'/usr/bin:/bin'})
        output = json.loads(proc.stdout)
        if 'Err' in output['result']:
            raise ValueError(output['result']['Err'])
        db.execute('UPDATE state SET value=? WHERE id=1',(canonical(output['state']),))
        return output['result']['Ok']

    def create(self, owner='alice.near', agent='agent.near', id='policy', chain='base', asset='SYNTH-USD',
               recipient='merchant', per_payment=60, budget=100, funded=100, expires=1000, now=1):
        for v in (per_payment,budget,funded): amount(v)
        with transaction(self.path) as db:
            p = self._policy(db,owner,now,{'op':'create','id':id,'agent':agent,'chain':chain,'asset':asset,
                'recipient':recipient,'per_payment':str(per_payment),'budget':str(budget),'expires':expires})['key']
            custody = digest(['mh-synthetic-custody-v1','treasury.synthetic',owner,p,chain,asset])
            db.execute('INSERT INTO positions VALUES(?,?,?,?,?,?,?,?)',(p,custody,owner,chain,asset,funded,funded,'unfunded'))
        self.fund(p)
        return p

    def fund(self, policy, crash=None):
        with transaction(self.path) as db:
            p = db.execute('SELECT * FROM positions WHERE policy=?',(policy,)).fetchone()
            if not p or p['status'] != 'unfunded':
                if p and p['status']=='active': return
                raise ValueError('position cannot be funded again')
            self.chain.fund(p['custody'],p['owner'],p['chain'],p['asset'],p['funded'])
            interrupt('after_funding',crash)
            db.execute('UPDATE positions SET status="active" WHERE policy=?',(policy,))

    def authorize(self, policy, id, units, caller='agent.near', now=2):
        amount(units)
        with transaction(self.path) as db:
            p = db.execute('SELECT * FROM positions WHERE policy=?',(policy,)).fetchone()
            if not p: raise ValueError('unknown position')
            grant = self._policy(db,caller,now,{'op':'authorize','policy':policy,'id':id,'amount':str(units)})
            key = grant['key']
            old = db.execute('SELECT * FROM payments WHERE id=?',(key,)).fetchone()
            if old: return key  # Return durable status; never create a new execution.
            if p['status'] != 'active': raise ValueError('position frozen')
            reserved = sum(json.loads(r[0])['amount'] for r in db.execute('SELECT envelope FROM payments WHERE policy=? AND status="reserved"',(policy,)))
            if p['principal']-reserved < units: raise ValueError('insufficient principal')
            if grant['payment']['custody'] != p['custody']: raise ValueError('policy custody mismatch')
            envelope = {'txid':key,'policy':policy,'custody':p['custody'],'owner':p['owner'],
                'chain':p['chain'],'asset':p['asset'],'recipient':grant['payment']['recipient'],
                'amount':units,'kind':'payment'}
            db.execute('INSERT INTO payments VALUES(?,?,?,?)',(key,policy,canonical(envelope),'reserved'))
            return key

    def _settle(self, db, payment, outcome, now):
        envelope = json.loads(payment['envelope'])
        self._policy(db,'resolver.synthetic',now,{'op':'resolve','payment':payment['id'],'outcome':outcome})
        if payment['status']=='reserved':
            if outcome=='delivered':
                db.execute('UPDATE positions SET principal=principal-? WHERE policy=?',(envelope['amount'],payment['policy']))
            db.execute('UPDATE payments SET status=? WHERE id=?',(outcome,payment['id']))

    def dispatch(self, key, crash=None, now=3):
        with transaction(self.path) as db:
            p = db.execute('SELECT * FROM payments WHERE id=?',(key,)).fetchone()
            if not p: raise ValueError('unknown payment')
            if p['status']!='reserved': return p['status']
            position = db.execute('SELECT status FROM positions WHERE policy=?',(p['policy'],)).fetchone()
            if position[0]!='active': raise ValueError('position frozen; reconcile instead')
            interrupt('before_send',crash)
            outcome = self.chain.apply(json.loads(p['envelope']))
            interrupt('after_send',crash)
            self._settle(db,p,outcome,now)
            interrupt('before_ack_commit',crash)
            return outcome

    def reconcile(self, key, now=4, unavailable=False):
        with transaction(self.path) as db:
            p = db.execute('SELECT * FROM payments WHERE id=?',(key,)).fetchone()
            if not p: raise ValueError('unknown payment')
            receipt = None if unavailable else self.chain.receipt(key)
            if not receipt: return 'unknown'  # Absence is not proof of failure.
            if receipt['binding']!=digest(json.loads(p['envelope'])): raise ValueError('receipt binding mismatch')
            self._settle(db,p,receipt['outcome'],now)
            return receipt['outcome']

    def recover(self, policy, owner='alice.near', now=5, crash=None, unavailable=False):
        # Freeze BEFORE any external side effect, durably across crashes.
        with transaction(self.path) as db:
            p = db.execute('SELECT * FROM positions WHERE policy=?',(policy,)).fetchone()
            if not p or p['owner']!=owner: raise ValueError('owner unauthorized')
            if p['status']=='recovered': return 'recovered'
            if p['status']=='unfunded': raise ValueError('reconcile funding first')
            self._policy(db,owner,now,{'op':'revoke','policy':policy})
            db.execute('UPDATE positions SET status="recovering" WHERE policy=?',(policy,))
        interrupt('after_freeze',crash)
        if unavailable: return 'unknown'
        with transaction(self.path) as db:
            for payment in db.execute('SELECT * FROM payments WHERE policy=? AND status="reserved"',(policy,)).fetchall():
                # Atomic fixture fence: an earlier delivered receipt wins; otherwise irrevocably cancel.
                outcome = self.chain.apply(json.loads(payment['envelope']),cancel=True)
                interrupt('after_cancel',crash)
                self._settle(db,payment,outcome,now)
            p = db.execute('SELECT * FROM positions WHERE policy=?',(policy,)).fetchone()
            if p['principal']:
                envelope = {'txid':digest(['recovery-v1',policy]),'policy':policy,'custody':p['custody'],
                    'owner':owner,'chain':p['chain'],'asset':p['asset'],'recipient':owner,
                    'amount':p['principal'],'kind':'recovery'}
                old = db.execute('SELECT * FROM recoveries WHERE policy=?',(policy,)).fetchone()
                if old and old['envelope']!=canonical(envelope): raise ValueError('recovery changed')
                self.chain.apply(envelope)
                interrupt('after_recovery_transfer',crash)
                db.execute('INSERT OR REPLACE INTO recoveries VALUES(?,?,?)',(policy,canonical(envelope),'delivered'))
            db.execute('UPDATE positions SET principal=0,status="recovered" WHERE policy=?',(policy,))
            interrupt('before_recovery_commit',crash)
        return 'recovered'

    def audit(self):
        with contextlib.closing(connection(self.path)) as db:
            return {table:[dict(r) for r in db.execute('SELECT * FROM '+table)]
                    for table in ('positions','payments','recoveries')}
