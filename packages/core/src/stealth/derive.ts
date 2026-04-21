/**
 * Unified export of stealth derivation functions for both curves.
 */

export {
  deriveStealthAddressEd25519,
  tryDecryptStealthPaymentEd25519,
  computeStealthPrivateKeyEd25519,
  stealthPubkeyFromPrivateKeyEd25519,
  randomEd25519Scalar,
  deriveSharedSecretFromViewPrivEd25519,
} from "./derive-ed25519";

export {
  deriveStealthAddressSecp256k1,
  tryDecryptStealthPaymentSecp256k1,
  computeStealthPrivateKeySecp256k1,
  stealthPubkeyFromPrivateKeySecp256k1,
  randomSecp256k1Scalar,
  deriveSharedSecretFromViewPrivSecp256k1,
} from "./derive-secp256k1";
