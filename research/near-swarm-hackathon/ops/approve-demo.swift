// Human-operated signing boundary. Never called during startup or readiness checks.
// Account keys never leave Keychain. Every signature requires a native approval.
import Foundation
import Security
import CryptoKit
import AppKit

@main struct DemoApproval {
    enum Failure: Error { case invalid, denied, keychain(OSStatus) }
    static func main() {
        do {
            let input = FileHandle.standardInput.readDataToEndOfFile()
            guard input.count < 800000,
                  let request = try JSONSerialization.jsonObject(with: input) as? [String: Any],
                  let role = request["role"] as? String,
                  let review = request["review"] as? String, review.count < 16000,
                  let expected = request["publicKeyHex"] as? String, expected.count == 64 else { throw Failure.invalid }
            let batch = request["batch"] as? [String]
            let encoded = batch ?? [(request["bytes"] as? String) ?? ""]
            guard !encoded.isEmpty, encoded.count <= 12, batch == nil || role == "solana" else { throw Failure.invalid }
            let messages = try encoded.map { value -> Data in
                guard let data = Data(base64Encoded:value), !data.isEmpty, data.count < 8000 else { throw Failure.invalid }
                return data
            }
            let mapping = ["near-contract":("com.multihopper.swarm-demo.20261117", "near-contract"),
                           "near-operator":("com.multihopper.swarm-demo.20261117", "near-operator"),
                           "solana":("com.multihopper.swarm-for-hire.integration-v1", "service-identity")]
            guard let (service, account) = mapping[role] else { throw Failure.invalid }
            let app = NSApplication.shared
            app.setActivationPolicy(.accessory)
            app.activate(ignoringOtherApps: true)
            let alert = NSAlert()
            alert.messageText = batch == nil ? "MultiHopper — approve this signature" : "MultiHopper — approve this transaction batch"
            alert.informativeText = review + "\n\nSigning uses the dedicated account in this Mac’s Keychain. Approve only the operation shown."
            alert.addButton(withTitle: "Cancel")
            alert.addButton(withTitle: "Approve signature")
            guard alert.runModal() == .alertSecondButtonReturn else { throw Failure.denied }
            let query: [String: Any] = [kSecClass as String:kSecClassGenericPassword,
                kSecAttrService as String:service, kSecAttrAccount as String:account,
                kSecReturnData as String:true]
            var result: CFTypeRef?
            let status = SecItemCopyMatching(query as CFDictionary, &result)
            guard status == errSecSuccess else { throw Failure.keychain(status) }
            guard let seed = result as? Data, seed.count == 32 else { throw Failure.invalid }
            let key = try Curve25519.Signing.PrivateKey(rawRepresentation: seed)
            guard key.publicKey.rawRepresentation.map({String(format:"%02x",$0)}).joined() == expected else { throw Failure.invalid }
            let signatures = try messages.map { bytes -> String in
                let sig = try key.signature(for:bytes)
                guard key.publicKey.isValidSignature(sig,for:bytes) else { throw Failure.invalid }
                return sig.base64EncodedString()
            }
            if batch != nil { print(String(data:try JSONSerialization.data(withJSONObject:signatures),encoding:.utf8)!) }
            else { print(signatures[0]) }
        } catch Failure.denied { fputs("Signature declined. Nothing signed.\n",stderr); exit(2)
        } catch { fputs("Signing unavailable. No secret material returned.\n",stderr); exit(1) }
    }
}
