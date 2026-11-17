//! Synthetic sandbox token ONLY. Not a production NEP-141 implementation.
//! Balances belong to distinct account IDs; no pooled custody address.
use near_sdk::{near, env, require, AccountId, PanicOnDefault};
use near_sdk::json_types::U128;
use std::collections::BTreeMap;
#[near(serializers=[json,borsh])]
#[derive(Clone)]
pub struct Receipt { pub binding:String, pub recipient:AccountId, pub amount:U128, pub outcome:String }
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Token { issuer:AccountId, symbol:String, balances:BTreeMap<AccountId,u128>, receipts:BTreeMap<String,Receipt> }
#[near]
impl Token {
 #[init]
 pub fn new(symbol:String)->Self {
  require!(["SYNTH-USD","SYNTH-NATIVE"].contains(&symbol.as_str()),"synthetic assets only");
  Self {issuer:env::predecessor_account_id(),symbol,balances:BTreeMap::new(),receipts:BTreeMap::new()}
 }
 pub fn mint(&mut self, account:AccountId, amount:U128) {
  require!(env::predecessor_account_id()==self.issuer,"issuer only");
  require!(amount.0>0,"positive units only");
  let b=self.balances.entry(account).or_default();*b=b.checked_add(amount.0).unwrap_or_else(||env::panic_str("overflow"));
 }
 pub fn balance(&self,account:AccountId)->U128 { U128(*self.balances.get(&account).unwrap_or(&0)) }
 pub fn operation(&self,account:AccountId,id:String)->Option<Receipt> {self.receipts.get(&format!("{}:{}",account,id)).cloned()}
 #[payable]
 pub fn fenced_transfer(&mut self,id:String,binding:String,recipient:AccountId,amount:U128,cancel:bool)->Receipt {
  require!(env::attached_deposit().as_yoctonear()==1,"exactly one synthetic yocto for authorization");
  require!(!id.is_empty() && id.len()<=80 && binding.len()==64 && amount.0>0,"invalid request");
  let caller=env::predecessor_account_id();let key=format!("{}:{}",caller,id);
  if let Some(r)=self.receipts.get(&key) {
   require!(r.binding==binding && r.recipient==recipient && r.amount==amount,"idempotency conflict");return r.clone();
  }
  require!(caller!=recipient,"self transfer unsupported");
  let outcome=if cancel {"cancelled"} else {
   let source=self.balances.get(&caller).copied().unwrap_or(0);require!(source>=amount.0,"insufficient principal");
   let destination=self.balances.get(&recipient).copied().unwrap_or(0).checked_add(amount.0).unwrap_or_else(||env::panic_str("overflow"));
   self.balances.insert(caller,source-amount.0);self.balances.insert(recipient.clone(),destination);"delivered"
  };
  let receipt=Receipt{binding,recipient,amount,outcome:outcome.into()};self.receipts.insert(key,receipt.clone());receipt
 }
}
