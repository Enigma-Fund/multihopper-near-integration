//! Isolated research: one immutable owner/token per keyless custody account.
use near_sdk::{near,env,require,AccountId,Gas,NearToken,PanicOnDefault,Promise,PromiseError,PromiseOrValue};
use near_sdk::json_types::U128;
use std::collections::BTreeMap;
#[near(serializers=[json,borsh])]
#[derive(Clone)]
pub struct Operation { pub amount:U128, pub recovery:bool, pub status:String }
#[near(serializers=[json])]
pub struct State {
 pub controller:AccountId,pub owner:AccountId,pub token:AccountId,pub recipient:AccountId,
 pub funded:U128,pub available:U128,pub reserved:U128,pub spent:U128,pub recovered:U128,
 pub closing:bool,pub budget:U128,pub per_payment:U128,pub expires:u64,
}
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Chamber {
 controller:AccountId, owner:AccountId, token:AccountId, recipient:AccountId,
 budget:u128, per_payment:u128, expires:u64,
 funded:u128,available:u128,reserved:u128,spent:u128,recovered:u128,closing:bool,
 operations:BTreeMap<String,Operation>,
}
#[near]
impl Chamber {
 #[init]
 pub fn new(owner:AccountId,token:AccountId,recipient:AccountId,budget:U128,per_payment:U128,expires:u64)->Self {
  let controller=env::predecessor_account_id();
  require!(env::current_account_id().as_str().ends_with(&format!(".{}",controller)),"factory only");
  require!(controller.as_str().ends_with(".synthetic"),"synthetic only");
  require!(owner!=env::current_account_id() && recipient!=env::current_account_id(),"invalid recipient");
  require!(budget.0>0 && per_payment.0>0 && per_payment.0<=budget.0 && expires>env::block_timestamp_ms()/1000,"invalid policy");
  Self{controller,owner,token,recipient,budget:budget.0,per_payment:per_payment.0,expires,funded:0,available:0,reserved:0,spent:0,recovered:0,closing:false,operations:BTreeMap::new()}
 }
 pub fn state(&self)->State {State{controller:self.controller.clone(),owner:self.owner.clone(),token:self.token.clone(),recipient:self.recipient.clone(),funded:U128(self.funded),available:U128(self.available),reserved:U128(self.reserved),spent:U128(self.spent),recovered:U128(self.recovered),closing:self.closing,budget:U128(self.budget),per_payment:U128(self.per_payment),expires:self.expires}}
 pub fn operation(&self,id:String)->Option<Operation>{self.operations.get(&id).cloned()}
 // Only authenticated token callbacks recognize principal. Direct donations never count.
 pub fn ft_on_transfer(&mut self,sender_id:AccountId,amount:U128,msg:String)->U128 {
  require!(env::predecessor_account_id()==self.token,"wrong token");
  if sender_id!=self.owner || !msg.is_empty() || amount.0==0 || self.closing || env::block_timestamp_ms()/1000>=self.expires || amount.0>self.budget-self.funded {return amount;}
  self.funded+=amount.0;self.available+=amount.0;U128(0)
 }
 pub fn pay(&mut self,id:String,amount:U128)->PromiseOrValue<Operation> {
  require!(env::predecessor_account_id()==self.controller,"controller only");
  if let Some(old)=self.operations.get(&id){require!(!old.recovery && old.amount==amount,"operation conflict");return PromiseOrValue::Value(old.clone());}
  require!(self.operations.len()<127,"research payment capacity reached");
  require!(!self.closing && env::block_timestamp_ms()/1000<self.expires,"inactive");
  require!(amount.0>0 && amount.0<=self.per_payment && amount.0<=self.available,"spending limit");
  self.begin(id,amount.0,false)
 }
 pub fn recover(&mut self,id:String)->PromiseOrValue<Operation> {
  require!(env::predecessor_account_id()==self.controller || env::predecessor_account_id()==self.owner,"owner/controller only");
  if let Some(old)=self.operations.get(&id){require!(old.recovery,"operation conflict");if old.status!="failed" {return PromiseOrValue::Value(old.clone());} self.operations.remove(&id);}
  require!(self.reserved==0,"pending outcomes must settle first");
  self.closing=true;
  self.begin(id,self.available,true)
 }
 pub fn freeze(&mut self){require!(env::predecessor_account_id()==self.owner || env::predecessor_account_id()==self.controller,"owner/controller only");self.closing=true;}
 #[private]
 pub fn resolve(&mut self,id:String)->Operation {
  require!(env::promise_results_count()==1,"one callback result required");
  let op=self.operations.get_mut(&id).expect("unknown operation");
  require!(op.status=="pending","already resolved");
  self.reserved-=op.amount.0;
  if match env::promise_result_checked(0,256) {Ok(_)=>true,Err(PromiseError::Failed)=>false,Err(_)=>env::panic_str("oversized callback; outcome unresolved")} {
   if op.recovery{self.recovered+=op.amount.0;}else{self.spent+=op.amount.0;}
   op.status="settled".into();
  }else{self.available+=op.amount.0;op.status="failed".into();}
  op.clone()
 }
}
impl Chamber {
 fn begin(&mut self,id:String,amount:u128,recovery:bool)->PromiseOrValue<Operation> {
  require!(!id.is_empty() && id.len()<=64 && id.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'),"invalid operation id");
  require!(self.operations.len()<128,"research operation capacity reached");
  // Zero-principal recovery still permanently closes the chamber; no token call.
  let op=Operation{amount:U128(amount),recovery,status:if amount==0{"settled"}else{"pending"}.into()};
  self.available-=amount;self.reserved+=amount;self.operations.insert(id.clone(),op.clone());
  if amount==0{return PromiseOrValue::Value(op);}
  let receiver=if recovery{&self.owner}else{&self.recipient};
  PromiseOrValue::Promise(Promise::new(self.token.clone()).function_call("ft_transfer",near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({"receiver_id":receiver,"amount":amount.to_string()})).unwrap(),NearToken::from_yoctonear(1),Gas::from_tgas(12))
   .then(Promise::new(env::current_account_id()).function_call("resolve",near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({"id":id})).unwrap(),NearToken::from_yoctonear(0),Gas::from_tgas(12))))
 }
}
