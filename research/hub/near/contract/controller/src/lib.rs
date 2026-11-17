//! Shared noncustodial factory/router. No token collection, sweep, upgrade, or arbitrary-call entry point.
use near_sdk::{near,env,require,AccountId,Gas,NearToken,PanicOnDefault,Promise,PromiseError};
use near_sdk::json_types::U128;
use std::collections::BTreeMap;
const CHAMBER:&[u8]=include_bytes!("../../target/wasm32-unknown-unknown/release/multihopper_revolver_chamber_research.wasm");
#[near(serializers=[json,borsh])]
#[derive(Clone)]
pub struct Grant {pub owner:AccountId,pub agent:AccountId,pub token:AccountId,pub chamber:AccountId,pub status:String}
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Controller {grants:BTreeMap<String,Grant>,payments:BTreeMap<String,(AccountId,U128)>}
#[near]
impl Controller {
 #[init]
 pub fn new()->Self {require!(env::current_account_id().as_str().ends_with(".synthetic"),"synthetic only");Self{grants:BTreeMap::new(),payments:BTreeMap::new()}}
 // Factory gas/storage is prefunded by the synthetic sponsor, never customer token principal.
 pub fn create(&mut self,id:String,agent:AccountId,token:AccountId,recipient:AccountId,budget:U128,per_payment:U128,expires:u64)->Promise {
  require!(["ordinaryusd.synthetic","ordinarynative.synthetic"].contains(&token.as_str()),"unreviewed token adapter");
  require!(!id.is_empty()&&id.len()<=64,"invalid id");require!(self.grants.len()<32,"research grant capacity reached");
  require!(recipient!=env::current_account_id() && !recipient.as_str().ends_with(&format!(".{}",env::current_account_id())),"customer custody cannot be a payout destination");
  let owner=env::predecessor_account_id();
  let key=env::sha256(&near_sdk::serde_json::to_vec(&(owner.clone(),id)).unwrap()).iter().take(16).map(|b|format!("{b:02x}")).collect::<String>();
  require!(!self.grants.contains_key(&key),"immutable grant; query existing creation instead");
  let chamber:AccountId=format!("{}.{}",key,env::current_account_id()).parse().unwrap();
  self.grants.insert(key.clone(),Grant{owner:owner.clone(),agent,token:token.clone(),chamber:chamber.clone(),status:"creating".into()});
  Promise::new(chamber).create_account().transfer(NearToken::from_near(3)).deploy_contract(CHAMBER.to_vec())
   .function_call("new",near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({"owner":owner,"token":token,"recipient":recipient,"budget":budget,"per_payment":per_payment,"expires":expires})).unwrap(),NearToken::from_yoctonear(0),Gas::from_tgas(10))
   .then(Promise::new(env::current_account_id()).function_call("created",near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({"key":key})).unwrap(),NearToken::from_yoctonear(0),Gas::from_tgas(10)))
 }
 #[private]
 pub fn created(&mut self,key:String)->Grant {
  require!(env::promise_results_count()==1,"one result required");let g=self.grants.get_mut(&key).expect("unknown grant");require!(g.status=="creating","already resolved");
  g.status=if match env::promise_result_checked(0,256) {Ok(_)=>true,Err(PromiseError::Failed)=>false,Err(_)=>env::panic_str("oversized callback; outcome unresolved")}{"ready"}else{"failed"}.into();g.clone()
 }
 pub fn grant(&self,key:String)->Option<Grant>{self.grants.get(&key).cloned()}
 pub fn pay(&mut self,key:String,id:String,amount:U128)->Promise {
  let g=self.grants.get(&key).expect("unknown grant");require!(g.status=="ready" && env::predecessor_account_id()==g.agent,"agent unauthorized");
  require!(!id.is_empty() && id.len()<=64,"invalid payment id");
  let identity=env::sha256(&near_sdk::serde_json::to_vec(&(g.owner.clone(),id.clone())).unwrap()).iter().map(|b|format!("{b:02x}")).collect::<String>();
  let binding=(g.chamber.clone(),amount);
  if let Some(old)=self.payments.get(&identity){require!(*old==binding,"owner payment id already bound to another chamber/amount");}
  else{require!(self.payments.len()<512,"research payment capacity reached");self.payments.insert(identity,binding);}
  Promise::new(g.chamber.clone()).function_call("pay",near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({"id":id,"amount":amount})).unwrap(),NearToken::from_yoctonear(0),Gas::from_tgas(45))
 }
 pub fn recover(&self,key:String,id:String)->Promise {
  let g=self.grants.get(&key).expect("unknown grant");require!(g.status=="ready" && env::predecessor_account_id()==g.owner,"owner unauthorized");
  Promise::new(g.chamber.clone()).function_call("recover",near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({"id":id})).unwrap(),NearToken::from_yoctonear(0),Gas::from_tgas(45))
 }
}
