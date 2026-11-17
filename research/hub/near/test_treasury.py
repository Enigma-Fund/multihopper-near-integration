import concurrent.futures
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from treasury import Treasury, SyntheticChain, Interrupted, ROOT, connection


class Lifecycle(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='mh-near-synthetic-')
        self.addCleanup(self.temp.cleanup)
        self.t = Treasury(self.temp.name)

    def position(self,p):
        return next(x for x in self.t.audit()['positions'] if x['policy']==p)

    def test_funding_delivery_recovery_all_six_chain_fixtures(self):
        for chain in ('base','ethereum','bnb','robinhood','arbitrum','solana'):
            with self.subTest(chain=chain):
                p=self.t.create(chain=chain,id=chain)
                k=self.t.authorize(p,chain,60)
                self.assertEqual(self.t.dispatch(k),'delivered')
                self.assertEqual(self.t.recover(p),'recovered')
                self.assertEqual(self.position(p)['principal'],0)
        a=self.t.chain.audit()
        self.assertEqual(sum(x['units'] for x in a['credits'] if x['kind']=='payment'),360)
        self.assertEqual(sum(x['units'] for x in a['credits'] if x['kind']=='recovery'),240)
        self.assertEqual(a['sponsor'][0]['fees'],12)

    def test_same_asset_different_owners_never_share_custody(self):
        a=self.t.create();b=self.t.create(owner='bob.near')
        pa,pb=self.position(a),self.position(b)
        self.assertNotEqual(pa['custody'],pb['custody'])
        with self.assertRaisesRegex(ValueError,'immutable'):
            self.t.chain.fund(pa['custody'],'bob.near','base','SYNTH-USD',100)
        self.t.recover(a)
        self.assertEqual(self.position(b)['principal'],100)

    def test_different_assets_and_chains_have_distinct_custody(self):
        ids=[self.t.create(id=str(n),asset=asset,chain=chain) for n,(asset,chain) in enumerate([
            ('SYNTH-USD','base'),('SYNTH-NATIVE','base'),('SYNTH-USD','solana')])]
        self.assertEqual(len({self.position(p)['custody'] for p in ids}),3)

    def test_zero_negative_float_bool_and_real_asset_rejected(self):
        p=self.t.create()
        for n in (0,-1,1.2,True,2**63):
            with self.assertRaises(ValueError):self.t.authorize(p,'x',n)
        for asset in ('USDC','SOL','ETH'):
            with self.assertRaises(ValueError):self.t.create(asset=asset,id=asset)
        with self.assertRaises(ValueError):self.t.create(chain='mainnet')

    def test_per_payment_and_total_reservations(self):
        p=self.t.create()
        with self.assertRaisesRegex(ValueError,'limit'):self.t.authorize(p,'a',61)
        self.t.authorize(p,'a',60)
        with self.assertRaisesRegex(ValueError,'limit'):self.t.authorize(p,'b',41)
        self.t.authorize(p,'b',40)
        with self.assertRaisesRegex(ValueError,'limit'):self.t.authorize(p,'c',1)

    def test_insufficient_funded_principal_rolls_back_authorization(self):
        p=self.t.create(funded=20)
        with self.assertRaisesRegex(ValueError,'principal'):self.t.authorize(p,'a',21)
        k=self.t.authorize(p,'a',20) # Failed reservation did not poison idempotency key.
        self.t.dispatch(k)
        self.assertEqual(self.position(p)['principal'],0)

    def test_agent_owner_and_expiry_restrictions(self):
        p=self.t.create()
        with self.assertRaisesRegex(ValueError,'unauthorized'):self.t.authorize(p,'x',1,caller='other.near')
        with self.assertRaisesRegex(ValueError,'unauthorized'):self.t.recover(p,owner='other.near')
        with self.assertRaisesRegex(ValueError,'inactive'):self.t.authorize(p,'x',1,now=1000)

    def test_duplicate_payment_and_receipt_charge_once(self):
        p=self.t.create();k=self.t.authorize(p,'a',60)
        for _ in range(5):
            self.assertEqual(self.t.authorize(p,'a',60),k)
            self.assertEqual(self.t.dispatch(k),'delivered')
            self.assertEqual(self.t.reconcile(k),'delivered')
        a=self.t.chain.audit()
        self.assertEqual(a['credits'][0]['units'],60)
        self.assertEqual(a['sponsor'][0]['fees'],1)
        self.assertEqual(self.position(p)['principal'],40)

    def test_idempotency_conflict_across_amount_or_policy(self):
        p=self.t.create();q=self.t.create(id='second');self.t.authorize(p,'a',10)
        with self.assertRaisesRegex(ValueError,'conflict'):self.t.authorize(p,'a',11)
        with self.assertRaisesRegex(ValueError,'conflict'):self.t.authorize(q,'a',10)

    def test_unsolicited_assets_never_credited_or_recovered(self):
        p=self.t.create(funded=20);addr=self.position(p)['custody'];self.t.chain.unsolicited(addr,900)
        with self.assertRaisesRegex(ValueError,'principal'):self.t.authorize(p,'a',21)
        self.t.recover(p)
        a=self.t.chain.audit()
        self.assertEqual(a['custody'][0]['quarantine'],900)
        self.assertEqual(a['credits'][0]['units'],20)
        self.assertEqual(a['custody'][0]['principal'],0)

    def test_funding_retry_does_not_top_up_spent_principal(self):
        p=self.t.create();addr=self.position(p)['custody'];k=self.t.authorize(p,'a',60);self.t.dispatch(k)
        self.t.chain.fund(addr,'alice.near','base','SYNTH-USD',100)
        self.t.fund(p)
        self.assertEqual(self.t.chain.audit()['custody'][0]['principal'],40)
        self.t.recover(p)
        with self.assertRaises(ValueError):self.t.fund(p)

    def test_crash_before_send_and_after_send_reconcile_once(self):
        for stage in ('before_send','after_send','before_ack_commit'):
            with self.subTest(stage=stage), tempfile.TemporaryDirectory() as d:
                t=Treasury(d);p=t.create();k=t.authorize(p,'a',60)
                with self.assertRaises(Interrupted):t.dispatch(k,crash=stage)
                t=Treasury(d)
                result=t.reconcile(k)
                self.assertEqual(result,'unknown' if stage=='before_send' else 'delivered')
                t.dispatch(k)
                self.assertEqual(t.chain.audit()['credits'][0]['units'],60)
                self.assertEqual(t.chain.audit()['sponsor'][0]['fees'],1)

    def test_unknown_settlement_keeps_reservation_even_after_expiry(self):
        p=self.t.create();k=self.t.authorize(p,'a',60)
        self.assertEqual(self.t.reconcile(k,now=1001,unavailable=True),'unknown')
        self.assertEqual(self.t.audit()['payments'][0]['status'],'reserved')
        self.assertEqual(self.t.recover(p,now=1002,unavailable=True),'unknown')
        self.assertEqual(self.position(p)['principal'],100)
        self.assertEqual(self.position(p)['status'],'recovering')
        self.assertEqual(self.t.chain.audit()['credits'],[])

    def test_recovery_every_interruption_point(self):
        for stage in ('after_freeze','after_cancel','after_recovery_transfer','before_recovery_commit'):
            with self.subTest(stage=stage),tempfile.TemporaryDirectory() as d:
                t=Treasury(d);p=t.create();t.authorize(p,'a',60)
                with self.assertRaises(Interrupted):t.recover(p,crash=stage)
                t=Treasury(d)
                with self.assertRaises(ValueError):t.authorize(p,'new',1)
                self.assertEqual(t.recover(p),'recovered');self.assertEqual(t.recover(p),'recovered')
                a=t.chain.audit()
                self.assertEqual(a['credits'][0]['units'],100)
                self.assertEqual(a['sponsor'][0]['fees'],1)

    def test_delayed_send_after_recovery_is_fenced(self):
        p=self.t.create();k=self.t.authorize(p,'a',60)
        envelope=json.loads(self.t.audit()['payments'][0]['envelope'])
        self.t.recover(p)
        self.assertEqual(self.t.chain.apply(envelope),'cancelled')
        self.assertEqual(self.t.dispatch(k),'cancelled')
        self.assertEqual([x['kind'] for x in self.t.chain.audit()['credits']],['recovery'])

    def test_recovery_after_external_delivery_before_local_ack(self):
        p=self.t.create();k=self.t.authorize(p,'a',60)
        with self.assertRaises(Interrupted):self.t.dispatch(k,crash='after_send')
        self.t.recover(p)
        a=self.t.chain.audit()
        self.assertEqual(sorted((x['kind'],x['units']) for x in a['credits']),[('payment',60),('recovery',40)])

    def test_tampered_receipt_and_transaction_replay_rejected(self):
        p=self.t.create();k=self.t.authorize(p,'a',60);self.t.dispatch(k)
        envelope=json.loads(self.t.audit()['payments'][0]['envelope']);envelope['amount']=59
        with self.assertRaisesRegex(ValueError,'conflict'):self.t.chain.apply(envelope)
        with connection(self.t.chain.path) as db:
            db.execute('UPDATE receipts SET binding="invalid" WHERE txid=?',(k,))
        with self.assertRaisesRegex(ValueError,'binding'):self.t.reconcile(k)

    def test_cross_owner_asset_chain_recovery_redirection_rejected(self):
        p=self.t.create();self.t.authorize(p,'a',10)
        e=json.loads(self.t.audit()['payments'][0]['envelope'])
        for field,value in [('owner','bob.near'),('asset','SYNTH-NATIVE'),('chain','solana')]:
            bad={**e,field:value}
            with self.assertRaisesRegex(ValueError,'domain'):self.t.chain.apply(bad)
        bad={**e,'kind':'recovery','recipient':'thief'}
        with self.assertRaisesRegex(ValueError,'original owner'):self.t.chain.apply(bad)
        self.assertEqual(self.t.chain.audit()['credits'],[])

    def test_concurrent_agents_cannot_overspend(self):
        p=self.t.create()
        def submit(i):
            try:return Treasury(self.temp.name).authorize(p,str(i),60)
            except ValueError:return None
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            keys=list(pool.map(submit,range(16)))
        self.assertEqual(sum(k is not None for k in keys),1)

    def test_concurrent_duplicate_dispatch_and_recovery_conserve_principal(self):
        p=self.t.create();k=self.t.authorize(p,'a',60)
        def work(i):
            try:
                t=Treasury(self.temp.name)
                return t.recover(p) if i%2 else t.dispatch(k)
            except ValueError:return 'frozen'
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:list(pool.map(work,range(20)))
        a=self.t.chain.audit()
        self.assertEqual(sum(x['units'] for x in a['credits']),100)
        self.assertEqual(sum(x['units'] for x in a['credits'] if x['kind']=='payment') in (0,60),True)
        self.assertEqual(self.position(p)['status'],'recovered')

    def test_real_process_exit_between_external_commit_and_ack(self):
        for recovery in (False,True):
            with self.subTest(recovery=recovery),tempfile.TemporaryDirectory() as d:
                t=Treasury(d);p=t.create();k=t.authorize(p,'a',60)
                code='''import os,sys
from treasury import Treasury
t=Treasury(sys.argv[1]);original=t.chain.apply
def die(*args,**kwargs):
 result=original(*args,**kwargs)
 if not kwargs.get("cancel"):os._exit(73)
 return result
t.chain.apply=die
if sys.argv[4]=="True":t.recover(sys.argv[2])
else:t.dispatch(sys.argv[3])
'''
                proc=subprocess.run([sys.executable,'-c',code,d,p,k,str(recovery)],cwd=ROOT,env={'PATH':'/usr/bin:/bin'})
                self.assertEqual(proc.returncode,73)
                t=Treasury(d)
                if recovery:t.recover(p)
                else:t.reconcile(k);t.recover(p)
                self.assertEqual(sum(x['units'] for x in t.chain.audit()['credits']),100)

    def test_interrupted_funding_retries_same_funding_event(self):
        original=self.t.chain.fund
        def after_fund(*args):
            original(*args)
            raise Interrupted('funded before ack')
        self.t.chain.fund=after_fund
        with self.assertRaises(Interrupted):self.t.create()
        p=self.t.audit()['positions'][0]['policy']
        self.assertEqual(self.position(p)['status'],'unfunded')
        with self.assertRaises(ValueError):self.t.authorize(p,'x',1)
        self.t=Treasury(self.temp.name);self.t.fund(p)
        self.assertEqual(self.t.chain.audit()['custody'][0]['funded'],100)
        self.assertEqual(self.t.chain.audit()['custody'][0]['principal'],100)

    def test_cancelled_payment_id_cannot_be_reused(self):
        p=self.t.create();k=self.t.authorize(p,'x',60)
        self.t.recover(p)
        self.assertEqual(self.t.authorize(p,'x',60),k)
        self.assertEqual(self.t.dispatch(k),'cancelled')
        self.assertEqual(self.t.chain.audit()['sponsor'][0]['fees'],1)

    def test_partial_recovery_cannot_close_with_stranded_principal(self):
        p=self.t.create();self.t.authorize(p,'a',10)
        e=json.loads(self.t.audit()['payments'][0]['envelope'])
        e.update(kind='recovery',recipient='alice.near')
        with self.assertRaisesRegex(ValueError,'exhaust'):self.t.chain.apply(e)
        self.assertEqual(self.t.chain.audit()['custody'][0]['principal'],100)

    def test_independent_processes_share_budget_lock(self):
        p=self.t.create()
        code='''import sys
from treasury import Treasury
try:Treasury(sys.argv[1]).authorize(sys.argv[2],sys.argv[3],60)
except ValueError:sys.exit(4)
'''
        procs=[subprocess.Popen([sys.executable,'-c',code,self.temp.name,p,str(i)],cwd=ROOT,env={'PATH':'/usr/bin:/bin'}) for i in range(6)]
        codes=[p.wait(timeout=30) for p in procs]
        self.assertEqual(codes.count(0),1);self.assertEqual(codes.count(4),5)

if __name__=='__main__':unittest.main(verbosity=2)
