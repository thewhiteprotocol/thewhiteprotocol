/**
 * pSOL v2 SDK - Note Management
 *
 * Handles creation, encryption, decryption, and storage of shielded notes.
 *
 * @module note/note
 */
/**
 * Represents a shielded note in pSOL v2
 */
export interface Note {
    /** Random blinding factor */
    secret: bigint;
    /** Nullifier preimage */
    nullifier: bigint;
    /** Token amount */
    amount: bigint;
    /** Asset identifier */
    assetId: bigint;
    /** Commitment = Poseidon(secret, nullifier, amount, assetId) */
    commitment: bigint;
    /** Leaf index in Merkle tree (set after deposit) */
    leafIndex?: number;
    /** Merkle root at time of deposit */
    merkleRoot?: bigint;
    /** Block timestamp of deposit */
    depositTimestamp?: number;
    /** Transaction signature of deposit */
    depositSignature?: string;
}
/**
 * Serialized note format for storage
 */
export interface SerializedNote {
    secret: string;
    nullifier: string;
    amount: string;
    assetId: string;
    commitment: string;
    leafIndex?: number;
    merkleRoot?: string;
    depositTimestamp?: number;
    depositSignature?: string;
}
/**
 * Note with computed nullifier hash (for withdrawal)
 */
export interface NoteWithNullifier extends Note {
    /** Computed nullifier hash */
    nullifierHash: bigint;
}
/**
 * Create a new shielded note
 * @param amount - Token amount
 * @param assetId - Asset identifier (from computeAssetId)
 * @returns New note with commitment
 */
export declare function createNote(amount: bigint, assetId: bigint): Promise<Note>;
/**
 * Create note from existing parameters (for recovery)
 */
export declare function createNoteFromParams(secret: bigint, nullifier: bigint, amount: bigint, assetId: bigint, leafIndex?: number, merkleRoot?: bigint): Promise<Note>;
/**
 * Compute nullifier hash for a note (requires leaf index)
 * @param note - Note with leaf index set
 * @returns Note with nullifier hash
 */
export declare function computeNoteNullifier(note: Note): Promise<NoteWithNullifier>;
/**
 * Serialize note to JSON-safe format
 */
export declare function serializeNote(note: Note): SerializedNote;
/**
 * Deserialize note from JSON format
 */
export declare function deserializeNote(data: SerializedNote): Note;
/**
 * Convert note commitment to bytes (for on-chain)
 */
export declare function commitmentToBytes(commitment: bigint): Uint8Array;
/**
 * Convert bytes to commitment
 */
export declare function bytesToCommitment(bytes: Uint8Array): bigint;
/**
 * Encrypt note for storage (basic encryption - use proper encryption in production)
 * @param note - Note to encrypt
 * @param password - Encryption password
 * @returns Encrypted note data
 */
export declare function encryptNote(note: Note, password: string): Promise<Uint8Array>;
/**
 * Decrypt note from storage
 * @param encryptedData - Encrypted note data
 * @param password - Decryption password
 * @returns Decrypted note
 */
export declare function decryptNote(encryptedData: Uint8Array, password: string): Promise<Note>;
/**
 * Note store for managing multiple notes
 */
export declare class NoteStore {
    private notes;
    /**
     * Add a note to the store
     */
    add(note: Note): void;
    /**
     * Get a note by commitment
     */
    get(commitment: bigint): Note | undefined;
    /**
     * Get all unspent notes for an asset
     */
    getByAsset(assetId: bigint): Note[];
    /**
     * Get total balance for an asset
     */
    getBalance(assetId: bigint): bigint;
    /**
     * Remove a note (after spending)
     */
    remove(commitment: bigint): boolean;
    /**
     * Get all notes
     */
    getAll(): Note[];
    /**
     * Serialize store to JSON
     */
    serialize(): string;
    /**
     * Load store from JSON
     */
    static deserialize(data: string): NoteStore;
}
//# sourceMappingURL=note.d.ts.map