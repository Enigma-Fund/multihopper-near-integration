//! Synthetic ft_transfer/storage-registration fixture. No custom cancellation/idempotency.
//! Exercises the ordinary NEP-141 transfer path, NOT a complete/audited token implementation.
use near_sdk::{near,env,require,AccountId,NearToken,PanicOnDefault,Promise,Gas};
use near_sdk::json_types::U128;
use std::collections::BTreeMap;
const STORAGE:u128=2_350_000_000_000_000_000_000;
#[near(serializers=[json])]
pub struct StorageBalance { total:U128, available:U128 }
#[near(serializers=[json])]
pub struct StorageBounds { min:U128, max:Option<U128> }
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Token { issuer:AccountId, balances:BTreeMap<AccountId,u128>, supply:u128 }
#[near]
impl Token {
 #[init]
 pub fn new(symbol:String)->Self {
  require!(["SYNTH-USD","SYNTH-NATIVE"].contains(&symbol.as_str()),"synthetic assets only");
  Self{issuer:env::predecessor_account_id(),balances:BTreeMap::new(),supply:0}
 }
 pub fn storage_balance_bounds(&self)->StorageBounds { StorageBounds{min:U128(STORAGE),max:Some(U128(STORAGE))} }
 pub fn storage_balance_of(&self,account_id:AccountId)->Option<StorageBalance> {
  self.balances.get(&account_id).map(|_|StorageBalance{total:U128(STORAGE),available:U128(0)})
 }
 #[payable]
 pub fn storage_deposit(&mut self,account_id:Option<AccountId>,registration_only:Option<bool>)->StorageBalance {
  let _=registration_only;
  let account=account_id.unwrap_or_else(env::predecessor_account_id);
  let deposit=env::attached_deposit().as_yoctonear();
  let cost=if self.balances.contains_key(&account){0}else{STORAGE};
  require!(deposit>=cost,"insufficient storage deposit");
  self.balances.entry(account).or_insert(0);
  if deposit>cost {Promise::new(env::predecessor_account_id()).transfer(NearToken::from_yoctonear(deposit-cost)).detach();}
  StorageBalance{total:U128(STORAGE),available:U128(0)}
 }
 #[payable]
 pub fn storage_unregister(&mut self,force:Option<bool>)->bool {
  require!(env::attached_deposit().as_yoctonear()==1,"exactly one yocto required");
  require!(!force.unwrap_or(false),"force unregister unsupported in fixture");
  let account=env::predecessor_account_id();
  if let Some(balance)=self.balances.get(&account) {
   require!(*balance==0,"balance must be zero");self.balances.remove(&account);
   Promise::new(account).transfer(NearToken::from_yoctonear(STORAGE+1)).detach();true
  } else {false}
 }
 pub fn ft_balance_of(&self,account_id:AccountId)->U128 {U128(*self.balances.get(&account_id).unwrap_or(&0))}
 pub fn ft_total_supply(&self)->U128 {U128(self.supply)}
 pub fn mint(&mut self,account_id:AccountId,amount:U128) {
  require!(env::predecessor_account_id()==self.issuer,"issuer only");
  let b=self.balances.get_mut(&account_id).unwrap_or_else(||env::panic_str("account not registered"));
  *b=b.checked_add(amount.0).unwrap_or_else(||env::panic_str("overflow"));
  self.supply=self.supply.checked_add(amount.0).unwrap_or_else(||env::panic_str("overflow"));
 }
 #[payable]
 pub fn ft_transfer(&mut self,receiver_id:AccountId,amount:U128,memo:Option<String>) {
  require!(env::attached_deposit().as_yoctonear()==1,"exactly one yocto required");
  let sender=env::predecessor_account_id();
  require!(sender!=receiver_id && amount.0>0,"invalid transfer");
  let source=*self.balances.get(&sender).unwrap_or_else(||env::panic_str("sender not registered"));
  let target=*self.balances.get(&receiver_id).unwrap_or_else(||env::panic_str("receiver not registered"));
  require!(source>=amount.0,"insufficient balance");
  let target=target.checked_add(amount.0).unwrap_or_else(||env::panic_str("overflow"));
  self.balances.insert(sender.clone(),source-amount.0);self.balances.insert(receiver_id.clone(),target);
  env::log_str(&format!("EVENT_JSON:{}",near_sdk::serde_json::json!({"standard":"nep141","version":"1.0.0","event":"ft_transfer","data":[{"old_owner_id":sender,"new_owner_id":receiver_id,"amount":amount,"memo":memo}]})));
 }
 // Standard-style synthetic transfer-call/resolver; same ordinary balances and ft_transfer.
 #[payable]
 pub fn ft_transfer_call(&mut self,receiver_id:AccountId,amount:U128,memo:Option<String>,msg:String)->Promise {
  let sender_id=env::predecessor_account_id();
  self.ft_transfer(receiver_id.clone(),amount,memo);
  Promise::new(receiver_id.clone()).function_call("ft_on_transfer",near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({"sender_id":sender_id,"amount":amount,"msg":msg})).unwrap(),NearToken::from_yoctonear(0),Gas::from_tgas(20))
   .then(Promise::new(env::current_account_id()).function_call("ft_resolve_transfer",near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({"sender_id":sender_id,"receiver_id":receiver_id,"amount":amount})).unwrap(),NearToken::from_yoctonear(0),Gas::from_tgas(12)))
 }
 #[private]
 pub fn ft_resolve_transfer(&mut self,sender_id:AccountId,receiver_id:AccountId,amount:U128)->U128 {
  require!(env::promise_results_count()==1,"one result required");
  let unused=match env::promise_result_checked(0,256){Ok(v)=>near_sdk::serde_json::from_slice::<U128>(&v).map(|x|x.0.min(amount.0)).unwrap_or(amount.0),_=>amount.0};
  let refund=unused.min(*self.balances.get(&receiver_id).unwrap_or(&0));
  if refund>0 {
   *self.balances.get_mut(&receiver_id).unwrap()-=refund;
   if let Some(b)=self.balances.get_mut(&sender_id){*b+=refund;}else{self.supply-=refund;}
   env::log_str(&format!("EVENT_JSON:{}",near_sdk::serde_json::json!({"standard":"nep141","version":"1.0.0","event":"ft_transfer","data":[{"old_owner_id":receiver_id,"new_owner_id":sender_id,"amount":refund.to_string(),"memo":"refund"}]})));
  }
  U128(amount.0-refund)
 }

}
