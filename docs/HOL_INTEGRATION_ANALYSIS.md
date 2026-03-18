# HOL Standards Integration Analysis

> **Analysis of how Hedera MultiSig integrates with HOL (Hashgraph Online Library) standards.**
>
> Date: 2026-03-18 | Updated: 2026-03-18

## Executive Summary

Eight HOL standards have direct or supporting relevance to Hedera MultiSig:

| Standard | Name | Relevance | Priority |
|----------|------|-----------|----------|
| **HCS-16** | Flora Coordination | On-chain multi-sig groups — **directly overlaps** with our core functionality | High |
| **HCS-10** | OpenConvAI | Agent-to-agent communication — enables discovery and messaging for our AgentSigningClient | High |
| **HCS-15** | Petals | Multi-account identity — maps to treasury teams managing multiple signing accounts | Medium |
| **HCS-17** | State Hash | Tamper-evident state verification for Flora groups | Medium (with Flora) |
| **HCS-18** | Flora Discovery | Decentralized group formation for autonomous agents | Medium (with Flora) |
| **HCS-26** | Agent Skills Registry | Discoverable signing capabilities for agent marketplace | Low |
| **HCS-11** | Profile Metadata | Identity standard used by HCS-10/15/16 for agent/account profiles | Supporting |
| **HCS-1** | File Management | Large message storage used by HCS-10 for data > topic message limits | Supporting |
| **HCS-8/9** | Poll Topics | Decentralized voting — future governance within Flora groups | Future |

**Strategic position**: HCS-16 Flora standardizes on-chain multi-sig coordination. Rather than competing, we offer Flora as a **fifth coordination mode** alongside our existing WebSocket, Offline, Networked, and Scheduled modes. Our tooling (CLI, dApp, Agent SDK) becomes the reference implementation for managing Flora accounts on Hedera.

**Current status**: Architectural prep complete (CoordinationTransport abstraction, FloraTransport stub, transport-agnostic AgentSigningClient). Full build planned for when HCS-16 stabilizes (est. Q3/Q4 2026).

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

## Implementation Roadmap

### Completed (v2.0 — March 2026)
1. **CoordinationTransport abstraction** — `shared/CoordinationTransport.js` with base class, WebSocket adapter, Flora stub, factory
2. **Transport-agnostic AgentSigningClient** — accepts `transportType` option
3. **ScheduleCreate/ScheduleSign decoders** — transaction decoder handles Flora-relevant types
4. **This analysis document** and roadmap updates

### When HCS-16 Stabilizes (est. v3.0 — Q3/Q4 2026)
5. **FloraWorkflow** — on-chain coordination via HCS topics (1-2 weeks with prep in place)
6. **Flora CLI** — `hedera-multisig flora create/join/propose/sign/status`
7. **HCS-17 state hash** verification for Flora groups
8. **HCS-10 agent registration** for AgentSigningClient

### Future (v4.0+)
9. **HCS-18 Flora discovery** — autonomous agent group formation
10. **HCS-26 skills registry** — register signing capabilities
11. **Flora dApp** — visual Flora management page
12. **HCS-15 Petal integration** — multi-account treasury management
13. **HCS-8/9 governance** — voting within Flora groups

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

## Additional Relevant Standards

Beyond the core three (HCS-10, HCS-15, HCS-16), these standards are directly relevant:

### HCS-17: State Hash Calculation
Provides tamper-evident state verification for Flora groups. Calculates SHA-384 hashes aggregating topic running hashes, public keys, and member states. Enables rapid reconciliation and audit trails for multi-party formations. **Direct integration with Flora mode** — every state change is verifiable.

### HCS-18: Flora Discovery Protocol
Decentralized formation protocol extending HCS-2 topic registries. Petals broadcast availability, propose groups, collect acceptances, and form Floras — all without a central coordinator. **Relevant for autonomous agent multi-sig** — agents can discover and join multi-sig groups without human setup.

### HCS-26: Decentralized Agent Skills Registry
Agents register versioned skills (like "multi-sig signing") as discoverable capabilities. Our signing agent could register its capabilities, letting other agents/services discover and invoke it. **Lower priority but interesting** for the agent-to-agent ecosystem.

### HCS-8/9: Poll Topics
Framework for decentralized voting via HCS topics. Could be relevant for governance decisions within a Flora (e.g., voting on whether to approve a large transfer). **Future consideration** — not needed for initial Flora integration.

---

## Architectural Preparation (Completed)

The following groundwork has been laid to enable Flora integration when the standard matures:

1. **`shared/CoordinationTransport.js`** — Abstract transport interface with:
   - `CoordinationTransport` base class (broadcast, sendTo, sendToCoordinator, event handlers)
   - `WebSocketTransport` adapter wrapping existing WebSocket server
   - `FloraTransport` stub with documented behavior for each method
   - `createTransport(type, options)` factory function
   - `TRANSPORT_TYPES` constants

2. **Transport-agnostic AgentSigningClient** — Constructor accepts `transportType` option. WebSocket is default; Flora can be swapped in without changing policy engine or signing logic.

3. **SigningSessionManager is already transport-agnostic** — It manages session state purely through method calls and event handlers. No WebSocket coupling. Flora integration only needs a new transport, not session management changes.

### Migration Path When Flora Is Ready

1. Implement `FloraTransport.start()` — subscribe to HCS topics
2. Implement `FloraTransport.broadcast()` — publish to session CTopic
3. Implement `FloraTransport.sendTo()` — use HCS-10 inbound topics
4. Implement `FloraTransport.onMessage()` — mirror node subscription for topic messages
5. Add `flora` CLI subcommand group
6. Add Flora mode to dApp session creation

**Estimated effort with prep work in place: 1-2 weeks** (vs 3-5 weeks without it).

---

## Timing Recommendation

**Build Flora integration when 2 of these 3 signals appear:**
1. HCS-16 spec moves from "Draft" to "Accepted" status
2. Reference implementations exist (SDK or tooling)
3. Other Hedera ecosystem tools adopt HCS-16

**Current status (March 2026)**: HCS-16 is Draft. No reference implementations seen. Architectural prep complete — ready to build when timing is right.

---

## References

- [HCS-10 OpenConvAI](https://hol.org/docs/standards/hcs-10/) — Agent communication standard
- [HCS-15 Petals](https://hol.org/docs/standards/hcs-15/) — Multi-account profile standard
- [HCS-16 Flora](https://hol.org/docs/standards/hcs-16/) — Multi-sig coordination standard
- [HCS-17 State Hash](https://hol.org/docs/standards/hcs-17/) — Tamper-evident state verification
- [HCS-18 Flora Discovery](https://hol.org/docs/standards/hcs-18/) — Decentralized group formation
- [HCS-26 Agent Skills](https://hol.org/docs/standards/hcs-26/) — Discoverable agent capabilities
- [HCS-11 Profiles](https://hol.org/docs/standards/hcs-11/) — Agent/account metadata standard
- [HCS-1 Files](https://hol.org/docs/standards/hcs-1/) — Large message storage

---

*Analysis conducted 2026-03-18 as part of v2.0 planning.*
*Architectural prep completed 2026-03-18. Full build planned for when HCS-16 stabilizes.*
