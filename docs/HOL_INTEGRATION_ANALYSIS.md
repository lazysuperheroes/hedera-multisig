# HOL Standards Integration Analysis

> **Analysis of how Hedera MultiSig can integrate with HCS-10, HCS-15, and HCS-16 standards from the Hashgraph Online Library (HOL).**
>
> Date: 2026-03-18

## Executive Summary

Three HOL standards have direct relevance to Hedera MultiSig:

| Standard | Name | Relevance |
|----------|------|-----------|
| **HCS-10** | OpenConvAI | Agent-to-agent communication protocol on HCS — enables our AgentSigningClient to discover and communicate with other agents natively on Hedera |
| **HCS-15** | Petals | Multi-account identity with shared keys — maps to how treasury teams manage multiple signing accounts |
| **HCS-16** | Flora | Multi-signature coordination accounts — **directly overlaps** with our core functionality and represents an on-chain standardization of what we do via WebSocket |

**Key insight**: HCS-16 Flora is essentially a standardized, on-chain version of our multi-sig coordination. Rather than competing, we should **implement HCS-16 as a backend** — our tooling (CLI, dApp, Agent SDK) becomes the user interface for creating and managing Flora accounts.

---

## HCS-10: OpenConvAI — Agent Communication

### What It Does
HCS-10 enables AI agents to discover each other and communicate using Hedera Consensus Service (HCS) topics. It defines:
- **Registry Topics** — directories for discovering registered agents
- **Inbound/Outbound Topics** — message channels for each agent
- **Connection Topics** — private bilateral communication channels
- **Transaction Operations** — propose scheduled transactions requiring approval

### Integration Opportunities

#### 1. AgentSigningClient as an HCS-10 Agent
Our `AgentSigningClient` could register as an HCS-10 agent, enabling:
- **Discovery**: Other agents/services find our signing agent via the registry
- **Connection**: Automated connection establishment via HCS-10 protocol
- **Transaction proposals**: Agents receive signing requests via HCS-10 `transaction` operations (which already use Hedera ScheduleCreate — aligned with our Phase 4 scheduled transactions)

#### 2. Replace WebSocket with HCS-10 for Agent Communication
Currently agents connect via WebSocket to a centralized server. HCS-10 offers a **decentralized alternative**:
- Agent publishes to its outbound topic
- Signing coordinator monitors via subscription
- Connection topics provide private bilateral channels
- No single server needed for agent coordination

#### 3. HCS-10 Transaction Approval Workflow
HCS-10's `transaction` operation type directly maps to our signing flow:
1. Initiator creates a `ScheduleCreateTransaction` on Hedera
2. Sends `transaction` message via HCS-10 with schedule ID
3. Recipient agent evaluates (via PolicyEngine)
4. Recipient signs with `ScheduleSignTransaction`
5. Execution occurs when threshold met

This is almost identical to our `ScheduledWorkflow` — the difference is the transport layer (HCS topics vs WebSocket).

### Implementation Path
1. Add HCS-10 agent registration to `AgentSigningClient`
2. Create an HCS-10 transport adapter alongside the WebSocket adapter
3. The PolicyEngine and signing logic remain unchanged
4. **Estimated effort**: Medium (new transport layer, existing signing logic)

---

## HCS-15: Petals — Profile Accounts

### What It Does
HCS-15 enables account holders to create multiple account instances (petals) sharing the same private key. Each petal has:
- Identical cryptographic key as the base account
- Its own HCS-11 profile with inbound/outbound topics
- Separate asset holdings and identity

### Integration Opportunities

#### 1. Treasury Account Organization
Treasury teams often manage multiple accounts for different purposes (operating, reserve, payroll). Petals formalize this:
- Base account holds the master key
- Petal accounts isolate assets by function
- All controlled by the same key (or multi-sig threshold key via HCS-16)

#### 2. Agent Identity
Our `AgentSigningClient` could use a Petal account as its identity:
- The agent's petal has its own HCS-10 inbound/outbound topics
- The base account retains control
- Multiple agent instances share the same key lineage

### Implementation Path
1. Add Petal account awareness to the transaction decoder (show base account relationship)
2. CLI commands for creating/managing petal accounts
3. **Estimated effort**: Low (primarily UX/display changes)

---

## HCS-16: Flora — Multi-Sig Coordination Accounts

### What It Does
HCS-16 defines "Flora accounts" — multi-signature coordination accounts for decentralized AppNets. A Flora consists of:
1. **Multisig Account** — Hedera native ThresholdKey (T-of-M)
2. **Communication Topic (CTopic)** — governance and coordination messages
3. **Transaction Topic (TTopic)** — scheduled transaction proposals
4. **State Topic (STopic)** — state commitments and membership changes
5. **HCS-11 Profile** — metadata describing members, thresholds, policies

### This Is Us (Almost)

HCS-16 Flora standardizes **exactly what Hedera MultiSig does**:

| Our Feature | HCS-16 Equivalent |
|-------------|-------------------|
| WebSocket session | Communication Topic (CTopic) |
| Transaction injection | Transaction Topic (TTopic) proposals |
| Signature collection | ScheduleSign via TTopic |
| Session state | State Topic (STopic) commitments |
| Participant tracking | Flora membership via STopic |
| Coordinator role | Flora creator/admin |
| Pre-session workflow | Pre-formation negotiation via HCS-10 |

### Key Differences

| Aspect | Our Current Approach | HCS-16 Flora |
|--------|---------------------|--------------|
| **Transport** | WebSocket (centralized server) | HCS topics (on-chain, decentralized) |
| **State** | In-memory/Redis | On-chain via STopic |
| **Persistence** | Session expires (30 min default) | Persistent on-chain (survives restarts) |
| **Discovery** | Connection strings, QR codes | HCS-10 registry + HCS-11 profiles |
| **Membership** | Public keys at session creation | On-chain membership changes via STopic |
| **Threshold** | Set at session creation | Native ThresholdKey, changeable via governance |

### Integration Strategy: Become an HCS-16 Client

Rather than replacing our stack, we should **add HCS-16 as a backend option**:

#### Phase A: Flora-Aware Transaction Decoder
- Recognize Flora account structures in transactions
- Display Flora metadata (members, threshold, topics) when decoding
- Show which Flora member is signing

#### Phase B: Flora Session Mode
- New workflow mode alongside Interactive, Offline, Networked, Scheduled
- `FloraWorkflow` that uses HCS topics instead of WebSocket
- Transactions proposed via TTopic, signatures collected on-chain
- State tracked via STopic

#### Phase C: Flora Management CLI
- `hedera-multisig flora create` — Create a Flora (multisig account + 3 topics + profile)
- `hedera-multisig flora join` — Request to join an existing Flora
- `hedera-multisig flora propose` — Submit a transaction proposal
- `hedera-multisig flora sign` — Sign a pending proposal
- `hedera-multisig flora status` — Show Flora state, pending proposals, member status

#### Phase D: Flora dApp Integration
- dApp page for Flora management
- Visual member status and voting
- Transaction proposal builder integrated with Flora

### Implementation Path
1. **Phase A** (Low effort): Add Flora awareness to decoder and display
2. **Phase B** (Medium effort): New FloraWorkflow using HCS SDK
3. **Phase C** (Medium effort): CLI commands wrapping FloraWorkflow
4. **Phase D** (Large effort): Full dApp integration

### Estimated Total Effort: Large (2-4 weeks for Phases A-C)

---

## Recommended Roadmap Addition

### Near-term (v2.x)
1. **HCS-16 awareness** in the transaction decoder — recognize Flora-related transactions
2. **HCS-10 agent registration** for `AgentSigningClient`
3. **Documentation** on how Hedera MultiSig relates to HCS-16

### Medium-term (v3.0)
4. **Flora management CLI** — create, join, propose, sign, status
5. **FloraWorkflow** — on-chain coordination as alternative to WebSocket
6. **HCS-10 transport adapter** for agent communication

### Long-term (v4.0)
7. **Full Flora dApp** — visual Flora management
8. **HCS-15 Petal integration** — multi-account treasury management
9. **HCS-10 marketplace** — agent discovery and service monetization

---

## Key Architectural Decision

**Should we replace WebSocket sessions with HCS-16 Flora?**

**No — we should offer both.** The WebSocket approach is:
- Faster (sub-second vs ~3-5 second HCS consensus)
- Free (no HCS topic creation fees)
- Works offline (no network dependency for session management)
- Better for the 120-second real-time signing window

HCS-16 Flora is better for:
- Persistent, long-lived multi-sig groups (DAOs, treasuries)
- On-chain auditability
- Decentralized coordination (no server dependency)
- Scheduled/async signing over days

The two approaches complement each other. WebSocket for real-time, Flora for persistent governance.

---

## References

- [HCS-10 OpenConvAI](https://hol.org/docs/standards/hcs-10/) — Agent communication standard
- [HCS-15 Petals](https://hol.org/docs/standards/hcs-15/) — Multi-account profile standard
- [HCS-16 Flora](https://hol.org/docs/standards/hcs-16/) — Multi-sig coordination standard
- [HCS-11 Profiles](https://hol.org/docs/standards/hcs-11/) — Agent/account metadata standard
- [HCS-1 Files](https://hol.org/docs/standards/hcs-1/) — Large message storage

---

*Analysis conducted 2026-03-18 as part of v2.0 planning.*
