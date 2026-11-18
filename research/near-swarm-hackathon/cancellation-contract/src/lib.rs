//! Isolated native-NEAR escrow experiment. One contract account per customer/job.
//! NOT a cancellation mechanism for principal already in a Solana route.
use near_sdk::{env,near,require,AccountId,NearToken,Promise,PromiseResult,Gas,PanicOnDefault};
use near_sdk::json_types::U128;
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Chamber { owner:AccountId, recipient:AccountId, amount:u128, state:String, attempt:u64 }
#[near]
impl Chamber {
 #[init]
 pub fn new(owner:AccountId,recipient:AccountId)->Self {
  let account=env::current_account_id();let caller=env::predecessor_account_id();
  require!(caller==account||account.as_str().ends_with(&format!(".{caller}")),"Account owner must initialize");
  require!(owner!=recipient,"Distinct recipient required");
  Self{owner,recipient,amount:0,state:"empty".into(),attempt:0}
 }
 #[payable]
 pub fn fund(&mut self){
  require!(env::predecessor_account_id()==self.owner,"Owner only");
  require!(self.state=="empty","Already funded");
  let amount=env::attached_deposit().as_yoctonear();require!(amount>0,"Positive principal required");
  self.amount=amount;self.state="funded".into();
 }
 pub fn status(&self)->near_sdk::serde_json::Value{
  near_sdk::serde_json::json!({"state":self.state,"principal":U128(self.amount),"attempt":self.attempt})
 }
 pub fn cancel(&mut self)->Promise {self.start(true)}
 pub fn release(&mut self)->Promise {self.start(false)}
 fn start(&mut self,refund:bool)->Promise {
  require!(env::predecessor_account_id()==self.owner,"Owner only");
  require!(self.state=="funded","Principal is locked or settled");
  self.attempt=self.attempt.checked_add(1).expect("Attempt overflow");
  self.state=if refund{"refunding"}else{"paying"}.into();
  let recipient=if refund{self.owner.clone()}else{self.recipient.clone()};
  Promise::new(recipient).transfer(NearToken::from_yoctonear(self.amount)).then(
   Promise::new(env::current_account_id()).function_call("complete",near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({"attempt":self.attempt,"refund":refund})).unwrap(),NearToken::from_yoctonear(0),Gas::from_tgas(10)))
 }
 #[private]
 pub fn complete(&mut self,attempt:u64,refund:bool){
  require!(attempt==self.attempt,"Stale callback");
  require!(self.state==if refund{"refunding"}else{"paying"},"Unexpected outcome");
  require!(env::promise_results_count()==1,"One transfer result required");
  self.state=match env::promise_result(0){PromiseResult::Successful(_)=>if refund{"refunded"}else{"paid"},PromiseResult::Failed=>"funded"}.into();
 }
}
