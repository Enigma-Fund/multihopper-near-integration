//! Research authorization contract. Contains no asset custody, live signing or RPC.
use near_sdk::{env, near, AccountId, PanicOnDefault};
use near_sdk::json_types::U128;
use std::collections::BTreeMap;

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Policy {
    pub owner: AccountId, pub agent: AccountId, pub chain: String, pub asset: String,
    pub recipient: String, pub per_payment: U128, pub budget: U128,
    pub expires: u64, pub revoked: bool, pub reserved: U128, pub spent: U128,
}
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Payment {
    pub policy: String, pub id: String, pub amount: U128,
    pub custody: String, pub recipient: String, pub chain: String, pub asset: String,
    pub status: String,
}
#[near(serializers = [json])]
#[derive(Clone, Debug)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Command {
    Create { id: String, agent: AccountId, chain: String, asset: String, recipient: String,
        per_payment: U128, budget: U128, expires: u64 },
    Authorize { policy: String, id: String, amount: U128 },
    Resolve { payment: String, outcome: String },
    Revoke { policy: String },
}
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Response { pub key: String, pub payment: Option<Payment> }
#[near(contract_state)]
#[derive(PanicOnDefault, Clone)]
pub struct Treasury {
    pub resolver: AccountId,
    pub policies: BTreeMap<String, Policy>,
    pub payments: BTreeMap<String, Payment>,
}
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
fn hash(value: &impl near_sdk::serde::Serialize) -> String {
    env::sha256(&near_sdk::serde_json::to_vec(value).unwrap()).iter().map(|b| format!("{b:02x}")).collect()
}
#[near]
impl Treasury {
    #[init]
    pub fn new() -> Self {
        // No caller-selected live resolver. This crate is deliberately research-only.
        Self { resolver: "resolver.synthetic".parse().unwrap(), policies: BTreeMap::new(), payments: BTreeMap::new() }
    }
    pub fn execute(&mut self, command: Command) -> Response {
        // Stage mutations so native fixture and NEAR receipt rollback have identical behavior.
        self.try_execute(command).unwrap_or_else(|e| env::panic_str(&e))
    }
    pub fn policy(&self, key: String) -> Option<Policy> { self.policies.get(&key).cloned() }
    pub fn payment(&self, key: String) -> Option<Payment> { self.payments.get(&key).cloned() }
    pub fn payments_for_policy(&self, policy: String) -> Vec<(String, Payment)> {
        self.payments.iter().filter(|(_, p)| p.policy == policy).map(|(k,p)| (k.clone(),p.clone())).collect()
    }
}
impl Treasury {
    pub fn try_execute(&mut self, command: Command) -> Result<Response, String> {
        let mut candidate = self.clone();
        let result = candidate.apply(command)?;
        *self = candidate;
        Ok(result)
    }
    fn apply(&mut self, command: Command) -> Result<Response, String> {
        let caller = env::predecessor_account_id();
        let now = env::block_timestamp_ms() / 1000;
        if env::attached_deposit().as_yoctonear() != 0 { return Err("no funds accepted".into()); }
        match command {
            Command::Create { id, agent, chain, asset, recipient, per_payment, budget, expires } => {
                if !valid_id(&id) || !valid_id(&recipient) || !["base", "ethereum", "bnb", "robinhood", "arbitrum", "solana"].contains(&chain.as_str()) || !["SYNTH-USD", "SYNTH-NATIVE"].contains(&asset.as_str()) || per_payment.0 == 0 || budget.0 < per_payment.0 || expires <= now {
                    return Err("invalid synthetic policy".into());
                }
                let key = hash(&("mh-policy-v1", env::current_account_id(), &caller, &id));
                if self.policies.contains_key(&key) { return Err("policy immutable".into()); }
                self.policies.insert(key.clone(), Policy { owner: caller, agent, chain, asset, recipient, per_payment, budget, expires, revoked: false, reserved: U128(0), spent: U128(0) });
                Ok(Response { key, payment: None })
            }
            Command::Authorize { policy, id, amount } => {
                let p = self.policies.get_mut(&policy).ok_or("unknown policy")?;
                if caller != p.agent { return Err("agent unauthorized".into()); }
                if !valid_id(&id) || amount.0 == 0 { return Err("invalid payment".into()); }
                // Owner-scoped idempotency across policies prevents switching policy on a retry.
                let key = hash(&("mh-payment-v1", env::current_account_id(), &p.owner, &id));
                if let Some(old) = self.payments.get(&key) {
                    if old.policy != policy || old.amount != amount { return Err("idempotency conflict".into()); }
                    return Ok(Response { key, payment: Some(old.clone()) });
                }
                if p.revoked || now >= p.expires { return Err("policy inactive".into()); }
                let total = p.spent.0.checked_add(p.reserved.0).and_then(|n| n.checked_add(amount.0)).ok_or("overflow")?;
                if amount.0 > p.per_payment.0 || total > p.budget.0 { return Err("spending limit".into()); }
                p.reserved = U128(p.reserved.0.checked_add(amount.0).ok_or("overflow")?);
                // No shared per-mint vault: policy is a separate position owned by exactly one user.
                let custody = hash(&("mh-synthetic-custody-v1", env::current_account_id(), &p.owner, &policy, &p.chain, &p.asset));
                let payment = Payment { policy, id, amount, custody, recipient: p.recipient.clone(), chain: p.chain.clone(), asset: p.asset.clone(), status: "reserved".into() };
                self.payments.insert(key.clone(), payment.clone());
                Ok(Response { key, payment: Some(payment) })
            }
            Command::Resolve { payment, outcome } => {
                if caller != self.resolver { return Err("resolver unauthorized".into()); }
                if !["delivered", "cancelled"].contains(&outcome.as_str()) { return Err("unknown is not final".into()); }
                let t = self.payments.get_mut(&payment).ok_or("unknown payment")?;
                if t.status != "reserved" {
                    if t.status != outcome { return Err("conflicting settlement".into()); }
                } else {
                    let p = self.policies.get_mut(&t.policy).ok_or("unknown policy")?;
                    p.reserved = U128(p.reserved.0.checked_sub(t.amount.0).ok_or("reservation mismatch")?);
                    if outcome == "delivered" { p.spent = U128(p.spent.0.checked_add(t.amount.0).ok_or("overflow")?); }
                    t.status = outcome;
                }
                Ok(Response { key: payment, payment: Some(t.clone()) })
            }
            Command::Revoke { policy } => {
                let p = self.policies.get_mut(&policy).ok_or("unknown policy")?;
                if caller != p.owner { return Err("owner unauthorized".into()); }
                p.revoked = true; // Existing grants remain reserved until externally reconciled.
                Ok(Response { key: policy, payment: None })
            }
        }
    }
}

#[cfg(test)]
mod tests;
