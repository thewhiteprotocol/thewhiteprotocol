"use strict";
/**
 * pSOL v2 SDK
 *
 * Complete TypeScript SDK for the pSOL v2 Multi-Asset Shielded Pool.
 *
 * @packageDocumentation
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SDK_STATUS = exports.IS_PRODUCTION_READY = exports.SDK_VERSION = exports.createPsolClient = exports.PsolV2Client = exports.exportVerificationKey = exports.verifyProofLocally = exports.pubkeyToScalar = exports.DEFAULT_CIRCUIT_PATHS = exports.Prover = void 0;
exports.initializeSDK = initializeSDK;
// Re-export crypto module
__exportStar(require("./crypto/poseidon"), exports);
// Re-export note module
__exportStar(require("./note/note"), exports);
// Re-export merkle module
__exportStar(require("./merkle/tree"), exports);
// Re-export proof module (excluding ProofType to avoid duplicate)
var prover_1 = require("./proof/prover");
Object.defineProperty(exports, "Prover", { enumerable: true, get: function () { return prover_1.Prover; } });
Object.defineProperty(exports, "DEFAULT_CIRCUIT_PATHS", { enumerable: true, get: function () { return prover_1.DEFAULT_CIRCUIT_PATHS; } });
Object.defineProperty(exports, "pubkeyToScalar", { enumerable: true, get: function () { return prover_1.pubkeyToScalar; } });
Object.defineProperty(exports, "verifyProofLocally", { enumerable: true, get: function () { return prover_1.verifyProofLocally; } });
Object.defineProperty(exports, "exportVerificationKey", { enumerable: true, get: function () { return prover_1.exportVerificationKey; } });
// Re-export types (source of truth for request/result types)
__exportStar(require("./types"), exports);
// Re-export PDA helpers
__exportStar(require("./pda"), exports);
// Re-export client (only the client class and factory, not duplicate types)
var client_1 = require("./client");
Object.defineProperty(exports, "PsolV2Client", { enumerable: true, get: function () { return client_1.PsolV2Client; } });
Object.defineProperty(exports, "createPsolClient", { enumerable: true, get: function () { return client_1.createPsolClient; } });
/**
 * Initialize the SDK (must be called before using crypto functions)
 */
async function initializeSDK() {
    const { initPoseidon } = await Promise.resolve().then(() => __importStar(require('./crypto/poseidon')));
    await initPoseidon();
}
/**
 * SDK version
 */
exports.SDK_VERSION = '2.0.0';
/**
 * Check if SDK is production ready
 */
exports.IS_PRODUCTION_READY = false;
exports.SDK_STATUS = "alpha";
