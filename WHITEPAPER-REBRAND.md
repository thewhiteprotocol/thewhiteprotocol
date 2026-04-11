# The White Protocol - Rebrand Executive Summary

## Why "The White Protocol"?

| Aspect | pSOL v2 | The White Protocol |
|--------|---------|-------------------|
| **Memorability** | Technical, tied to Solana | Unique, brandable |
| **Meaning** | "Privacy SOL" - functional | "White" - pure, clean, transparent privacy |
| **Future-proof** | Limited to Solana | Chain-agnostic potential |
| **Marketing** | Hard to trademark | Distinctive brand identity |

**"White"** symbolizes:
- **Purity**: Clean, uncorrupted transactions
- **Transparency**: Open source, verifiable privacy
- **Clean Slate**: Fresh start, new identity

---

## Scope of Changes

### Affected Components

```
┌─────────────────────────────────────────────────────────────┐
│                    REBRAND SCOPE                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  🦀 RUST PROGRAM (programs/white-protocol/)                │
│     ├── Package name: psol-privacy-v2 → white-protocol     │
│     ├── Module name: psol_privacy_v2 → white_protocol      │
│     ├── Error enum: PrivacyErrorV2 → WhiteProtocolError    │
│     └── PDA seeds: pool_v2 → white_pool, etc.              │
│                                                             │
│  📦 SDK (sdk/)                                             │
│     ├── Package: @psol/sdk → @whiteprotocol/sdk            │
│     ├── Client: PsolV2Client → WhiteProtocolClient         │
│     └── Constants: POOL_V2_SEED → POOL_SEED                │
│                                                             │
│  🔄 RELAYER (relayer/)                                     │
│     ├── Package: @psol/relayer → @whiteprotocol/relayer    │
│     └── Service branding updates                           │
│                                                             │
│  📜 SCRIPTS & TESTS                                        │
│     ├── All import statements                              │
│     ├── All class instantiations                           │
│     └── All documentation strings                          │
│                                                             │
│  📖 DOCUMENTATION                                          │
│     ├── README.md complete rewrite                         │
│     ├── Code comments                                      │
│     └── Circuit documentation                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Critical Decisions

### 1. PDA Seeds: Keep or Change?

| Approach | Pros | Cons |
|----------|------|------|
| **Keep old seeds** (`pool_v2`) | Backwards compatible with existing deployment | Inconsistent naming |
| **Change seeds** (`white_pool`) | Clean rebrand, consistent naming | New deployment required |

**Recommendation**: Change seeds and deploy as new program for cleanest rebrand.

### 2. Program ID: Keep or New?

| Approach | Pros | Cons |
|----------|------|------|
| **Keep existing** | Existing users can continue | Confusing if seeds change |
| **New program ID** | Fresh start, no confusion | Need to migrate liquidity |

**Recommendation**: New program ID for mainnet. Keep existing for devnet continuity during transition.

### 3. SDK Package Name

```
@psol/sdk        →  @whiteprotocol/sdk
@psol/relayer    →  @whiteprotocol/relayer
```

This allows:
- Both SDKs to coexist during migration
- Clear namespace ownership
- Future expansion (@whiteprotocol/react, etc.)

---

## Implementation Timeline

### Week 1: Core Changes
- [ ] Rust program renames
- [ ] Anchor configuration updates
- [ ] SDK core changes
- [ ] Initial testing

### Week 2: Integration
- [ ] Relayer updates
- [ ] All scripts updated
- [ ] Test files updated
- [ ] Full test suite passing

### Week 3: Documentation & Polish
- [ ] README rewrite
- [ ] All comments updated
- [ ] Circuit documentation
- [ ] Deployment guides

### Week 4: Deployment
- [ ] Devnet deployment
- [ ] Integration testing
- [ ] Security review
- [ ] Mainnet deployment (if ready)

---

## Breaking Changes for Users

### If Deploying as New Program

| Impact | Migration Path |
|--------|----------------|
| Existing notes | Cannot be used directly - withdraw from old pool |
| Existing deposits | Must withdraw from pSOL, deposit to White |
| SDK imports | Update package name and class name |
| Environment vars | Update variable names |

### Migration Script for Users

```typescript
// Old
import { PsolV2Client } from '@psol/sdk';
const client = new PsolV2Client({...});

// New
import { WhiteProtocolClient } from '@whiteprotocol/sdk';
const client = new WhiteProtocolClient({...});
```

---

## Brand Assets to Create

### Immediate
- [ ] New logo (white/clean aesthetic)
- [ ] Color palette (whites, grays, accent color)
- [ ] Typography

### Website
- [ ] Landing page
- [ ] Documentation site theme
- [ ] API documentation styling

### Social
- [ ] Twitter/X profile
- [ ] Discord server branding
- [ ] GitHub organization avatar

---

## Technical Architecture (Unchanged)

The core protocol architecture remains identical:

```
┌─────────────────────────────────────────────────────────────┐
│              THE WHITE PROTOCOL ARCHITECTURE                │
│                    (Same as pSOL v2)                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   USER          DEPOSIT           SEQUENCER       MERKLE   │
│     │              │                    │            │     │
│     │ ────────────►│                    │            │     │
│     │   Commitment │                    │            │     │
│     │              │ ──────────────────►│            │     │
│     │              │   Batch+Proof      │            │     │
│     │              │                    │───────────►│     │
│     │              │                    │   Update   │     │
│     │              │◄───────────────────│            │     │
│     │◄─────────────│   Note+Index       │            │     │
│     │   Receipt    │                    │            │     │
│     │              │                    │            │     │
│   USER         WITHDRAWAL          RELAYER          POOL   │
│     │              │                    │            │     │
│     │ ────────────►│                    │            │     │
│     │   ZK Proof   │───────────────────►│            │     │
│     │              │   Verify+Submit    │───────────►│     │
│     │              │                    │   Execute  │     │
│     │◄─────────────│◄───────────────────│            │     │
│     │   Tokens     │   Confirmation     │            │     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Cost Estimate

### Development Time
- **Core changes**: 12-18 hours
- **Testing & debugging**: 4-8 hours
- **Documentation**: 4-6 hours
- **Total**: ~20-32 hours

### Deployment Costs (Solana)
- **Program deployment**: ~5-10 SOL
- **Pool initialization**: ~0.5 SOL
- **VK uploads**: ~0.5 SOL per circuit
- **Total**: ~10-15 SOL

### Brand Assets
- **Logo design**: $500-2000 (if outsourcing)
- **Website redesign**: $1000-5000
- **Documentation site**: $500-2000

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking existing integrations | High | High | Keep old SDK published, deprecation notice |
| User confusion | Medium | Medium | Clear migration guide, dual-branding period |
| Deployment issues | Low | High | Thorough devnet testing |
| SEO/traffic loss | Medium | Medium | Redirects, update all links |

---

## Success Metrics

### Technical
- [ ] All tests passing
- [ ] No references to "pSOL" in codebase
- [ ] Successful devnet deployment
- [ ] SDK published to npm

### Adoption
- [ ] First integration using new SDK
- [ ] Relayer operators migrated
- [ ] Documentation site traffic

### Brand
- [ ] Social media following maintained
- [ ] Positive community reception
- [ ] Press coverage (if applicable)

---

## Next Steps

1. **Approve rebrand** - Stakeholder sign-off
2. **Create feature branch** - `rebrand/white-protocol`
3. **Reserve npm packages** - `@whiteprotocol/sdk`, `@whiteprotocol/relayer`
4. **Reserve GitHub org** - `github.com/whiteprotocol`
5. **Begin Phase 1** - Rust program changes

---

## Questions to Resolve

1. Should we keep the `v2` suffix in any naming?
2. Do we want to change the token ticker symbol (if any)?
3. Should we create a new domain name immediately?
4. What's the timeline for sunsetting pSOL brand?
5. Do we need a legal review of the new name?

---

*The White Protocol - Privacy, Pure and Simple.*
