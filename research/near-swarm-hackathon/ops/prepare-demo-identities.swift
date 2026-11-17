// Creates and verifies dedicated local identities. No network, transaction signing or funds movement.
// Secret material is stored only in macOS Keychain; output contains public keys and account IDs.
import Foundation
import Security
import CryptoKit

@main struct PrepareDemoIdentities {
    static let service = "com.multihopper.swarm-demo.20261117"
    enum Failure: Error { case keychain(OSStatus), invalidKey, verification }
    static func query(_ role: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: role,
         kSecUseAuthenticationUI as String: kSecUseAuthenticationUIFail]
    }
    static func read(_ role: String) throws -> Data? {
        var q = query(role)
        q[kSecReturnData as String] = true
        var result: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw Failure.keychain(status) }
        guard let bytes = result as? Data, bytes.count == 32 else { throw Failure.invalidKey }
        return bytes
    }
    static func identity(_ role: String) throws -> Curve25519.Signing.PrivateKey {
        if let existing = try read(role) { return try .init(rawRepresentation: existing) }
        let key = Curve25519.Signing.PrivateKey()
        var q = query(role)
        q[kSecValueData as String] = key.rawRepresentation
        q[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        q[kSecAttrLabel as String] = "MultiHopper NEAR demo: " + role
        let status = SecItemAdd(q as CFDictionary, nil)
        guard status == errSecSuccess else { throw Failure.keychain(status) }
        guard let saved = try read(role), saved == key.rawRepresentation else { throw Failure.verification }
        return try .init(rawRepresentation: saved)
    }
    static func base58(_ data: Data) -> String {
        let alphabet = Array("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")
        var digits = [Int]()
        for byte in data {
            var carry = Int(byte)
            for i in digits.indices { carry += digits[i] * 256; digits[i] = carry % 58; carry /= 58 }
            while carry > 0 { digits.append(carry % 58); carry /= 58 }
        }
        return String(repeating: "1", count: data.prefix(while: {$0 == 0}).count) + String(digits.reversed().map {alphabet[$0]})
    }
    static func main() {
        do {
            var accounts = [[String: String]]()
            for role in ["near-contract", "near-operator", "receipt-publisher"] {
                let key = try identity(role)
                let publicBytes = key.publicKey.rawRepresentation
                // Non-transaction, domain-separated local possession check. Never broadcast.
                let challenge = Data(("multihopper-local-key-check-v1:" + role).utf8)
                guard key.publicKey.isValidSignature(try key.signature(for: challenge), for: challenge) else { throw Failure.verification }
                var entry = ["role": role, "publicKey": "ed25519:" + base58(publicBytes), "keyStorage": "macOS Keychain", "verified": "true"]
                if role != "receipt-publisher" { entry["accountId"] = publicBytes.map {String(format: "%02x", $0)}.joined() }
                else { entry["publicKeyBase64"] = publicBytes.base64EncodedString() }
                accounts.append(entry)
            }
            let output: [String: Any] = ["network": "near-mainnet", "onChainCreated": false, "identities": accounts]
            let data = try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys, .prettyPrinted])
            print(String(decoding: data, as: UTF8.self))
        } catch Failure.keychain(let code) {
            fputs("Keychain unavailable (\(code)); no secret material printed.\n", stderr); exit(1)
        } catch { fputs("Identity preparation failed; no secret material printed.\n", stderr); exit(1) }
    }
}
