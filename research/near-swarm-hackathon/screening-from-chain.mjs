import {readComplianceSigner} from './compliance-config.mjs';
import {verifyHopsProof} from './screening-proof.mjs';
// The caller must pin the correct program, config PDA and genesis independently.
// Result is a screener-signed proof, not an attestation signed by TRM itself.
export async function verifyScreeningFromChain({rpc,expectedGenesis,expectedProgram,expectedConfigAddress,proof,routeId,creator,baseIndex,recipients,nowSeconds}){
 const config=await readComplianceSigner({rpc,expectedGenesis,expectedProgram,expectedConfigAddress});
 const checked=verifyHopsProof({proof,expectedSigner:config.signer,programId:expectedProgram,routeId,creator,baseIndex,recipients,nowSeconds});
 return {...checked,configSlot:config.slot};
}
