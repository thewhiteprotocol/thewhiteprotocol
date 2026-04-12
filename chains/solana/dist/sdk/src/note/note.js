"use strict";
/**
 * pSOL v2 SDK - Note Management
 *
 * Handles creation, encryption, decryption, and storage of shielded notes.
 *
 * @module note/note
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NoteStore = void 0;
exports.createNote = createNote;
exports.createNoteFromParams = createNoteFromParams;
exports.computeNoteNullifier = computeNoteNullifier;
exports.serializeNote = serializeNote;
exports.deserializeNote = deserializeNote;
exports.commitmentToBytes = commitmentToBytes;
exports.bytesToCommitment = bytesToCommitment;
exports.encryptNote = encryptNote;
exports.decryptNote = decryptNote;
const poseidon_1 = require("../crypto/poseidon");
/**
 * Create a new shielded note
 * @param amount - Token amount
 * @param assetId - Asset identifier (from computeAssetId)
 * @returns New note with commitment
 */
async function createNote(amount, assetId) {
    await (0, poseidon_1.initPoseidon)();
    // Generate random secret and nullifier
    const secret = (0, poseidon_1.randomFieldElement)();
    const nullifier = (0, poseidon_1.randomFieldElement)();
    // Compute commitment
    const commitment = (0, poseidon_1.computeCommitment)(secret, nullifier, amount, assetId);
    return {
        secret,
        nullifier,
        amount,
        assetId,
        commitment,
    };
}
/**
 * Create note from existing parameters (for recovery)
 */
async function createNoteFromParams(secret, nullifier, amount, assetId, leafIndex, merkleRoot) {
    await (0, poseidon_1.initPoseidon)();
    const commitment = (0, poseidon_1.computeCommitment)(secret, nullifier, amount, assetId);
    return {
        secret,
        nullifier,
        amount,
        assetId,
        commitment,
        leafIndex,
        merkleRoot,
    };
}
/**
 * Compute nullifier hash for a note (requires leaf index)
 * @param note - Note with leaf index set
 * @returns Note with nullifier hash
 */
async function computeNoteNullifier(note) {
    if (note.leafIndex === undefined) {
        throw new Error('Note must have leafIndex set to compute nullifier hash');
    }
    await (0, poseidon_1.initPoseidon)();
    const nullifierHash = (0, poseidon_1.computeNullifierHash)(note.nullifier, note.secret, BigInt(note.leafIndex));
    return {
        ...note,
        nullifierHash,
    };
}
/**
 * Serialize note to JSON-safe format
 */
function serializeNote(note) {
    return {
        secret: note.secret.toString(),
        nullifier: note.nullifier.toString(),
        amount: note.amount.toString(),
        assetId: note.assetId.toString(),
        commitment: note.commitment.toString(),
        leafIndex: note.leafIndex,
        merkleRoot: note.merkleRoot?.toString(),
        depositTimestamp: note.depositTimestamp,
        depositSignature: note.depositSignature,
    };
}
/**
 * Deserialize note from JSON format
 */
function deserializeNote(data) {
    return {
        secret: BigInt(data.secret),
        nullifier: BigInt(data.nullifier),
        amount: BigInt(data.amount),
        assetId: BigInt(data.assetId),
        commitment: BigInt(data.commitment),
        leafIndex: data.leafIndex,
        merkleRoot: data.merkleRoot ? BigInt(data.merkleRoot) : undefined,
        depositTimestamp: data.depositTimestamp,
        depositSignature: data.depositSignature,
    };
}
/**
 * Convert note commitment to bytes (for on-chain)
 */
function commitmentToBytes(commitment) {
    return (0, poseidon_1.bigIntToBytes)(commitment);
}
/**
 * Convert bytes to commitment
 */
function bytesToCommitment(bytes) {
    return (0, poseidon_1.bytesToBigInt)(bytes);
}
/**
 * Encrypt note for storage (basic encryption - use proper encryption in production)
 * @param note - Note to encrypt
 * @param password - Encryption password
 * @returns Encrypted note data
 */
async function encryptNote(note, password) {
    const serialized = JSON.stringify(serializeNote(note));
    const encoder = new TextEncoder();
    const data = encoder.encode(serialized);
    // Derive key from password
    const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.deriveKey({
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256',
    }, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
    // Combine salt + iv + ciphertext
    const result = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
    result.set(salt, 0);
    result.set(iv, salt.length);
    result.set(new Uint8Array(encrypted), salt.length + iv.length);
    return result;
}
/**
 * Decrypt note from storage
 * @param encryptedData - Encrypted note data
 * @param password - Decryption password
 * @returns Decrypted note
 */
async function decryptNote(encryptedData, password) {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    // Extract salt, iv, and ciphertext
    const salt = encryptedData.slice(0, 16);
    const iv = encryptedData.slice(16, 28);
    const ciphertext = encryptedData.slice(28);
    // Derive key from password
    const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256',
    }, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    const serialized = decoder.decode(decrypted);
    return deserializeNote(JSON.parse(serialized));
}
/**
 * Note store for managing multiple notes
 */
class NoteStore {
    constructor() {
        this.notes = new Map();
    }
    /**
     * Add a note to the store
     */
    add(note) {
        const key = note.commitment.toString();
        this.notes.set(key, note);
    }
    /**
     * Get a note by commitment
     */
    get(commitment) {
        return this.notes.get(commitment.toString());
    }
    /**
     * Get all unspent notes for an asset
     */
    getByAsset(assetId) {
        return Array.from(this.notes.values()).filter(note => note.assetId === assetId);
    }
    /**
     * Get total balance for an asset
     */
    getBalance(assetId) {
        return this.getByAsset(assetId).reduce((sum, note) => sum + note.amount, BigInt(0));
    }
    /**
     * Remove a note (after spending)
     */
    remove(commitment) {
        return this.notes.delete(commitment.toString());
    }
    /**
     * Get all notes
     */
    getAll() {
        return Array.from(this.notes.values());
    }
    /**
     * Serialize store to JSON
     */
    serialize() {
        const notes = Array.from(this.notes.values()).map(serializeNote);
        return JSON.stringify(notes);
    }
    /**
     * Load store from JSON
     */
    static deserialize(data) {
        const store = new NoteStore();
        const notes = JSON.parse(data);
        for (const serialized of notes) {
            store.add(deserializeNote(serialized));
        }
        return store;
    }
}
exports.NoteStore = NoteStore;
