use super::*;
use near_sdk::{test_utils::VMContextBuilder, testing_env, NearToken};
fn ctx(caller: &str, now:u64) { let mut b=VMContextBuilder::new(); b.current_account_id("treasury.synthetic".parse().unwrap()).predecessor_account_id(caller.parse().unwrap()).signer_account_id("alice.near".parse().unwrap()).block_timestamp(now*1_000_000_000); testing_env!(b.build()); }
fn create(id:&str)->Command { Command::Create { id:id.into(),agent:"agent.near".parse().unwrap(),chain:"base".into(),asset:"SYNTH-USD".into(),recipient:"merchant".into(),per_payment:U128(60),budget:U128(100),expires:1000 } }
fn setup()->(Treasury,String) {ctx("alice.near",1);let mut t=Treasury::new();let k=t.execute(create("p")).key;(t,k)}
fn auth(policy:&str,id:&str,n:u128)->Command {Command::Authorize{policy:policy.into(),id:id.into(),amount:U128(n)}}
#[test] fn limit_includes_reservations() {let(mut t,p)=setup();ctx("agent.near",2);t.execute(auth(&p,"one",60));assert!(t.try_execute(auth(&p,"two",41)).is_err());assert_eq!(t.policies[&p].reserved,U128(60));t.execute(auth(&p,"two",40));assert!(t.try_execute(auth(&p,"three",1)).is_err());}
#[test] fn immutable_policy_cannot_reset_budget() {let(mut t,_)=setup();assert!(t.try_execute(create("p")).is_err());}
#[test] fn caller_not_signer_authorizes() {let(mut t,p)=setup();ctx("malicious.near",2);assert!(t.try_execute(auth(&p,"one",1)).is_err());assert!(t.try_execute(Command::Revoke{policy:p}).is_err());}
#[test] fn zero_large_and_expired_rejected() {let(mut t,p)=setup();ctx("agent.near",2);for n in [0,61,u128::MAX]{assert!(t.try_execute(auth(&p,"one",n)).is_err());}ctx("agent.near",1000);assert!(t.try_execute(auth(&p,"one",1)).is_err());}
#[test] fn duplicate_is_bound_and_not_respent() {let(mut t,p)=setup();ctx("agent.near",2);let a=t.execute(auth(&p,"one",60));assert_eq!(a,t.execute(auth(&p,"one",60)));assert!(t.try_execute(auth(&p,"one",59)).is_err());assert_eq!(t.policies[&p].reserved,U128(60));}
#[test] fn cannot_retry_id_through_another_policy() {let(mut t,p)=setup();let q=t.execute(create("q")).key;ctx("agent.near",2);t.execute(auth(&p,"one",10));assert!(t.try_execute(auth(&q,"one",10)).is_err());}
#[test] fn owner_asset_chain_segregated_paths() {let(mut t,p)=setup();ctx("bob.near",1);let q=t.execute(create("p")).key;ctx("agent.near",2);let a=t.execute(auth(&p,"one",10)).payment.unwrap();let b=t.execute(auth(&q,"one",10)).payment.unwrap();assert_ne!(p,q);assert_ne!(a.custody,b.custody);}
#[test] fn resolver_only_and_unknown_keeps_reservation() {let(mut t,p)=setup();ctx("agent.near",2);let k=t.execute(auth(&p,"one",60)).key;assert!(t.try_execute(Command::Resolve{payment:k.clone(),outcome:"cancelled".into()}).is_err());ctx("resolver.synthetic",2);assert!(t.try_execute(Command::Resolve{payment:k,outcome:"unknown".into()}).is_err());assert_eq!(t.policies[&p].reserved,U128(60));}
#[test] fn resolution_idempotent_conflict_rejected() {let(mut t,p)=setup();ctx("agent.near",2);let k=t.execute(auth(&p,"one",60)).key;ctx("resolver.synthetic",2);for _ in 0..2{t.execute(Command::Resolve{payment:k.clone(),outcome:"delivered".into()});}assert_eq!(t.policies[&p].spent,U128(60));assert_eq!(t.policies[&p].reserved,U128(0));assert!(t.try_execute(Command::Resolve{payment:k,outcome:"cancelled".into()}).is_err());}
#[test] fn revoke_preserves_inflight_reservation_and_blocks_new() {let(mut t,p)=setup();ctx("agent.near",2);t.execute(auth(&p,"one",60));ctx("alice.near",2);t.execute(Command::Revoke{policy:p.clone()});ctx("agent.near",2);assert!(t.try_execute(auth(&p,"two",1)).is_err());assert_eq!(t.policies[&p].reserved,U128(60));}
#[test] fn borsh_restart_preserves_state() {let(mut t,p)=setup();ctx("agent.near",2);t.execute(auth(&p,"one",60));let mut restored:Treasury=near_sdk::borsh::from_slice(&near_sdk::borsh::to_vec(&t).unwrap()).unwrap();assert!(restored.try_execute(auth(&p,"two",41)).is_err());assert_eq!(restored.payments,t.payments);}
#[test] fn no_real_assets_or_attached_funds() {let(mut t,_)=setup();let mut c=create("q");if let Command::Create{ref mut asset,..}=c{*asset="USDC".into();}assert!(t.try_execute(c).is_err());let mut b=VMContextBuilder::new();b.predecessor_account_id("alice.near".parse().unwrap()).attached_deposit(NearToken::from_yoctonear(1));testing_env!(b.build());assert!(t.try_execute(create("r")).is_err());}
#[test] fn cancelled_grant_cannot_resurrect_and_budget_can_be_reused_with_new_id() {
    let(mut t,p)=setup();ctx("agent.near",2);let k=t.execute(auth(&p,"one",60)).key;
    ctx("resolver.synthetic",3);t.execute(Command::Resolve{payment:k.clone(),outcome:"cancelled".into()});
    ctx("agent.near",4);assert_eq!(t.execute(auth(&p,"one",60)).payment.unwrap().status,"cancelled");
    t.execute(auth(&p,"two",60));assert_eq!(t.policies[&p].reserved,U128(60));assert_eq!(t.policies[&p].spent,U128(0));
}
#[test] fn settled_spend_still_consumes_budget() {
    let(mut t,p)=setup();ctx("agent.near",2);let k=t.execute(auth(&p,"one",60)).key;
    ctx("resolver.synthetic",3);t.execute(Command::Resolve{payment:k,outcome:"delivered".into()});
    ctx("agent.near",4);assert!(t.try_execute(auth(&p,"two",41)).is_err());
    t.execute(auth(&p,"two",40));assert_eq!(t.policies[&p].spent,U128(60));
}
#[test] fn checked_u128_overflow_does_not_mutate_state() {
    ctx("alice.near",1);let mut t=Treasury::new();let mut c=create("p");
    if let Command::Create{ref mut budget,ref mut per_payment,..}=c{*budget=U128(u128::MAX);*per_payment=U128(u128::MAX);}
    let p=t.execute(c).key;ctx("agent.near",2);t.execute(auth(&p,"one",u128::MAX));
    let before=near_sdk::borsh::to_vec(&t).unwrap();assert!(t.try_execute(auth(&p,"two",1)).is_err());
    assert_eq!(before,near_sdk::borsh::to_vec(&t).unwrap());
}
