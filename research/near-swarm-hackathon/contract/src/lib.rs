//! NEAR job authorization and authenticated Solana settlement receipts.
//! Payment principal stays in the Solana route. NEAR deposits cover record storage.
use near_sdk::{env, near, require, AccountId, PanicOnDefault};
use near_sdk::json_types::{Base64VecU8, U128};
use near_sdk::serde::{Deserialize, Serialize};

const JOB_STORAGE: u128 = 10_000_000_000_000_000_000_000;
const INVOICE_STORAGE: u128 = 20_000_000_000_000_000_000_000;
const MAX_AMOUNT: u128 = 999_999_999_999_999_999;

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Job {
    pub owner: AccountId,
    pub agent: AccountId,
    pub terms_hash: String,
    pub budget: U128,
    pub per_payment: U128,
    pub reserved: U128,
    pub spent: U128,
    pub closed: bool,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Invoice {
    pub job_key: String,
    pub amount: U128,
    pub minimum: U128,
    pub status: String,
    pub credited: U128,
    pub evidence_hash: String,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct SwarmJobs {
    publisher: [u8; 32],
    network: String,
}

fn valid_hash(value: &str) {
    require!(value.len() == 64 && value.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)), "Invalid commitment");
}
fn key(prefix: &str, id: &str) -> Vec<u8> {
    valid_hash(id);
    format!("{prefix}:{id}").into_bytes()
}
fn read<T: for<'a> Deserialize<'a>>(prefix: &str, id: &str) -> Option<T> {
    env::storage_read(&key(prefix, id)).map(|bytes| near_sdk::serde_json::from_slice(&bytes).expect("Invalid stored record"))
}
fn write<T: Serialize>(prefix: &str, id: &str, value: &T) {
    env::storage_write(&key(prefix, id), &near_sdk::serde_json::to_vec(value).unwrap());
}
fn event(name: &str, job: &str, invoice: Option<&str>) {
    env::log_str(&format!("EVENT_JSON:{}", near_sdk::serde_json::json!({
        "standard":"multihopper_swarm", "version":"1.0.0", "event":name,
        "data":[{"job_key":job,"invoice_key":invoice}]
    })));
}
fn ensure_storage(before: u64, deposit: u128) {
    let used = env::storage_usage().saturating_sub(before) as u128;
    require!(used * env::storage_byte_cost().as_yoctonear() <= deposit, "Insufficient record storage deposit");
}

#[near]
impl SwarmJobs {
    #[init]
    pub fn new(publisher: Base64VecU8, network: String) -> Self {
        let owner = env::predecessor_account_id();
        let account = env::current_account_id();
        require!(owner == account || account.as_str().ends_with(&format!(".{owner}")), "Initialize through the account owner");
        require!(matches!(network.as_str(), "mainnet" | "testnet" | "local"), "Invalid network domain");
        Self { publisher: publisher.0.try_into().expect("32-byte publisher key required"), network }
    }

    pub fn configuration(&self) -> near_sdk::serde_json::Value {
        near_sdk::serde_json::json!({"network":self.network,"publisher":Base64VecU8(self.publisher.to_vec()),
            "job_storage":U128(JOB_STORAGE),"invoice_storage":U128(INVOICE_STORAGE),
            "settlement_chain":"solana","asset":"native SOL"})
    }
    pub fn get_job(&self, job_key: String) -> Option<Job> { read("job", &job_key) }
    pub fn get_invoice(&self, job_key: String, invoice_key: String) -> Option<Invoice> {
        valid_hash(&job_key);
        read(&format!("invoice:{job_key}"), &invoice_key)
    }

    #[payable]
    pub fn create_job(&mut self, job_key: String, job_id: String, agent: AccountId, terms_hash: String, budget: U128, per_payment: U128) -> Job {
        valid_hash(&terms_hash);
        require!(per_payment.0 > 0 && budget.0 >= per_payment.0 && budget.0 <= MAX_AMOUNT, "Invalid spending limits");
        let owner = env::predecessor_account_id();
        require!(!job_id.is_empty() && job_id.len() <= 48 && job_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-'), "Invalid job ID");
        let encoded = near_sdk::serde_json::to_vec(&("swarm-job-v1", &owner, job_id)).unwrap();
        let expected: String = env::sha256(&encoded).iter().map(|b| format!("{b:02x}")).collect();
        require!(expected == job_key, "Job key belongs to another customer");
        if let Some(existing) = self.get_job(job_key.clone()) {
            require!(existing.owner == owner && existing.agent == agent && existing.terms_hash == terms_hash && existing.budget == budget && existing.per_payment == per_payment, "Job terms are immutable");
            require!(env::attached_deposit().is_zero(), "Retry an existing job with zero deposit");
            return existing;
        }
        require!(env::attached_deposit().as_yoctonear() == JOB_STORAGE, "Attach the quoted job storage deposit");
        let before = env::storage_usage();
        let job = Job { owner, agent, terms_hash, budget, per_payment, reserved: U128(0), spent: U128(0), closed: false };
        write("job", &job_key, &job);
        ensure_storage(before, JOB_STORAGE);
        event("job_created", &job_key, None);
        job
    }

    #[payable]
    pub fn reserve_invoice(&mut self, job_key: String, invoice_key: String, amount: U128, minimum: U128) -> Invoice {
        let mut job = self.get_job(job_key.clone()).expect("Unknown job");
        let caller = env::predecessor_account_id();
        require!(caller == job.owner || caller == job.agent, "Agent is not authorized for this job");
        if let Some(existing) = self.get_invoice(job_key.clone(), invoice_key.clone()) {
            require!(existing.job_key == job_key && existing.amount == amount && existing.minimum == minimum, "Invoice terms are immutable");
            require!(env::attached_deposit().is_zero(), "Retry an existing invoice with zero deposit");
            return existing;
        }
        require!(!job.closed, "Job is closed");
        require!(amount.0 > 0 && minimum.0 > 0 && minimum.0 <= amount.0 && amount.0 <= job.per_payment.0, "Payment exceeds the signed limit");
        let total = job.spent.0.checked_add(job.reserved.0).and_then(|v| v.checked_add(amount.0)).expect("Amount overflow");
        require!(total <= job.budget.0, "Job budget exceeded");
        require!(env::attached_deposit().as_yoctonear() == INVOICE_STORAGE, "Attach the quoted invoice storage deposit");
        let before = env::storage_usage();
        job.reserved.0 += amount.0;
        let invoice = Invoice { job_key: job_key.clone(), amount, minimum, status: "reserved".into(), credited: U128(0), evidence_hash: "0".repeat(64) };
        write(&format!("invoice:{job_key}"), &invoice_key, &invoice);
        write("job", &job_key, &job);
        ensure_storage(before, INVOICE_STORAGE);
        event("invoice_reserved", &job_key, Some(&invoice_key));
        invoice
    }

    pub fn close_job(&mut self, job_key: String) -> Job {
        let mut job = self.get_job(job_key.clone()).expect("Unknown job");
        require!(env::predecessor_account_id() == job.owner, "Only the customer can close the job");
        job.closed = true;
        write("job", &job_key, &job);
        event("job_closed", &job_key, None);
        job
    }

    pub fn record_settlement(&mut self, job_key: String, invoice_key: String, outcome: String, credited: U128, evidence_hash: String, signature: Base64VecU8) -> Invoice {
        valid_hash(&evidence_hash);
        require!(matches!(outcome.as_str(), "paid" | "refunded"), "Unresolved payments remain reserved");
        require!(credited.0 > 0 && credited.0 <= MAX_AMOUNT, "Invalid settlement credit");
        let message = near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!([
            "multihopper-swarm-settlement-v1",self.network,env::current_account_id(),
            job_key,invoice_key,outcome,credited.0.to_string(),evidence_hash
        ])).unwrap();
        let sig: [u8; 64] = signature.0.try_into().expect("64-byte signature required");
        require!(env::ed25519_verify(&sig, &message, &self.publisher), "Invalid settlement publisher signature");
        let mut invoice = self.get_invoice(job_key.clone(), invoice_key.clone()).expect("Unknown invoice");
        require!(invoice.job_key == job_key, "Invoice belongs to another job");
        if invoice.status != "reserved" {
            require!(invoice.status == outcome && invoice.credited == credited && invoice.evidence_hash == evidence_hash, "Conflicting final settlement");
            return invoice;
        }
        if outcome == "paid" { require!(credited.0 >= invoice.minimum.0 && credited.0 <= invoice.amount.0, "Payout differs from invoice limits"); }
        let mut job = self.get_job(job_key.clone()).expect("Unknown job");
        job.reserved.0 = job.reserved.0.checked_sub(invoice.amount.0).expect("Reservation mismatch");
        // A terminal invoice consumes its original authorization even after refund.
        // This prevents a recovered invoice from restoring an already approved allowance.
        job.spent.0 += invoice.amount.0;
        invoice.status = outcome;
        invoice.credited = credited;
        invoice.evidence_hash = evidence_hash;
        write("job", &job_key, &job);
        write(&format!("invoice:{job_key}"), &invoice_key, &invoice);
        event("settlement_recorded", &job_key, Some(&invoice_key));
        invoice
    }
}
