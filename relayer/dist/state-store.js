"use strict";
/**
 * Simple JSON file-based state store for the relayer.
 * Persists critical in-memory state across restarts.
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
exports.loadRelayerState = loadRelayerState;
exports.saveRelayerState = saveRelayerState;
exports.loadMerkleTreeState = loadMerkleTreeState;
exports.saveMerkleTreeState = saveMerkleTreeState;
exports.loadPendingState = loadPendingState;
exports.savePendingState = savePendingState;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const STATE_DIR = process.env.STATE_DIR || path.join(process.cwd(), 'data');
const RELAYER_STATE_PATH = path.join(STATE_DIR, 'relayer-state.json');
const MERKLE_STATE_PATH = path.join(STATE_DIR, 'merkle-tree-state.json');
const PENDING_STATE_PATH = path.join(STATE_DIR, 'pending-state.json');
function ensureDir() {
    if (!fs.existsSync(STATE_DIR)) {
        fs.mkdirSync(STATE_DIR, { recursive: true });
    }
}
function loadRelayerState() {
    try {
        if (!fs.existsSync(RELAYER_STATE_PATH))
            return null;
        const raw = fs.readFileSync(RELAYER_STATE_PATH, 'utf8');
        return JSON.parse(raw);
    }
    catch (err) {
        // eslint-disable-next-line no-console
        console.error('[StateStore] Failed to load relayer state:', err);
        return null;
    }
}
function saveRelayerState(state) {
    ensureDir();
    const tmp = RELAYER_STATE_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, RELAYER_STATE_PATH);
}
function loadMerkleTreeState() {
    try {
        if (!fs.existsSync(MERKLE_STATE_PATH))
            return null;
        const raw = fs.readFileSync(MERKLE_STATE_PATH, 'utf8');
        return JSON.parse(raw);
    }
    catch (err) {
        // eslint-disable-next-line no-console
        console.error('[StateStore] Failed to load merkle tree state:', err);
        return null;
    }
}
function saveMerkleTreeState(state) {
    ensureDir();
    const tmp = MERKLE_STATE_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, MERKLE_STATE_PATH);
}
function loadPendingState() {
    try {
        if (!fs.existsSync(PENDING_STATE_PATH))
            return null;
        const raw = fs.readFileSync(PENDING_STATE_PATH, 'utf8');
        return JSON.parse(raw);
    }
    catch (err) {
        // eslint-disable-next-line no-console
        console.error('[StateStore] Failed to load pending state:', err);
        return null;
    }
}
function savePendingState(state) {
    ensureDir();
    const tmp = PENDING_STATE_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, PENDING_STATE_PATH);
}
