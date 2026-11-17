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
                  let request = try JSONSerialization.jsonObject(with: input) as? [String: String],
                  let role = request["role"], let encoded = request["bytes"],
                  let bytes = Data(base64Encoded: encoded), !bytes.isEmpty,
                  let review = request["review"], review.count < 16000,
                  let expected = request["publicKeyHex"], expected.count == 64 else { throw Failure.invalid }
            let mapping = ["near-contract":("com.multihopper.swarm-demo.20261117", "near-contract"),
                           "near-operator":("com.multihopper.swarm-demo.20261117", "near-operator"),
                           "solana":("com.multihopper.swarm-for-hire.integration-v1", "service-identity")]
            guard let (service, account) = mapping[role] else { throw Failure.invalid }
            let app = NSApplication.shared
            app.setActivationPolicy(.accessory)
            app.activate(ignoringOtherApps: true)
            let alert = NSAlert()
            alert.messageText = "MultiHopper — approve this signature"
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
            let sig = try key.signature(for: bytes)
            guard key.publicKey.isValidSignature(sig, for: bytes) else { throw Failure.invalid }
            print(sig.base64EncodedString())
        } catch Failure.denied { fputs("Signature declined. Nothing signed.\n",stderr); exit(2)
        } catch { fputs("Signing unavailable. No secret material returned.\n",stderr); exit(1) }
    }
}
