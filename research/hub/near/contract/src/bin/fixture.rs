//! Local stdin bridge: real Rust policy + NEAR SDK mocked context, never a node.
use multihopper_near_policy_research::{Treasury, Command};
use near_sdk::{serde::{Serialize, Deserialize}, serde_json, test_utils::VMContextBuilder, testing_env};
use std::io::{self, Read};
#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct Input { state: Option<Vec<u8>>, caller: String, now: u64, command: Command }
fn main() {
    let mut input = String::new(); io::stdin().read_to_string(&mut input).unwrap();
    let i: Input = serde_json::from_str(&input).unwrap();
    let mut b = VMContextBuilder::new();
    b.current_account_id("treasury.synthetic".parse().unwrap())
        .predecessor_account_id(i.caller.parse().unwrap()).block_timestamp(i.now.checked_mul(1_000_000_000).unwrap());
    testing_env!(b.build());
    let mut t: Treasury = i.state.map(|bytes| near_sdk::borsh::from_slice(&bytes).unwrap()).unwrap_or_else(Treasury::new);
    let result = t.try_execute(i.command);
    println!("{}", serde_json::json!({"state":near_sdk::borsh::to_vec(&t).unwrap(),"result":result}));
}
