# Architecture

<p>
  <b>English</b> · <a href="architecture.md">简体中文</a>
</p>

This document describes the core architecture, design intent, and key trade-offs of this project.

---

## 1. Problem and Positioning

The set of tools visible to the model grows with every plugin: the full schema of each tool consumes context and KV prefix space, and the more tools there are, the wider the model's choice surface and the higher the cost of judgment. At the same time, "which capabilities are available, which are visible at startup, and which are recalled on demand" is scattered across several mechanisms—official tools, custom tools, MCP connections, the skill catalog—leaving users without a unified governance surface and making it hard for role differences to coexist with global configuration.

`dsh-capability-manager` builds on DeepSeek Harness and shifts capability supply from "statically full" to "a governable on-demand surface": the capability pool acts as a hard whitelist, resident capabilities define the startup-visible set, `meta_search` serves as the on-demand recall channel, and a per-role blacklist is layered on top when Personal Agent is detected. It does not rebuild any runtime capability; it only opens and closes visibility through Harness's public interfaces.

The project's core is not to choose between "expose everything" and "hide everything," but to allow the availability scope, startup visibility, and recall timing of capabilities to be allocated on demand—with hot effect, observability, and reversibility after configuration changes.

---

## 2. Core Architecture

The overall layering is as follows:

```text
┌─────────────────────────────────────┐
│                Client               │
│  Pool / resident / blacklist / MCP  │
└──────────────────┬──────────────────┘
                   │ HTTP API
┌──────────────────▼──────────────────┐
│                 Host                │
│                                     │
│  Decision chain: blacklist > pool   │
│                > resident > recall  │
│  Enforcement: restrict / catalog /  │
│               index / recall        │
│  Config: self-heal, atomic write,   │
│          shared-source write path   │
└──────────────────┬──────────────────┘
                   │ Harness public capabilities
┌──────────────────▼──────────────────┐
│           DeepSeek Harness          │
│   Tools / Skills / Session / MCP    │
└─────────────────────────────────────┘
```

### 2.1 A Single Decision Chain

"Whether a capability is available to an agent" has exactly one decision chain: role blacklist → capability pool → resident → recall → use, first match decides. Every enforcement surface—the `restrict` allowlist, the skill catalog, `meta_search` candidates, index injection—is a projection of this chain, and none may implement its own criterion.

Centralizing the decision chain means any "visibility" question can be explained in one place; the cost is that every new enforcement surface must be checked against the chain rather than allowed to bypass it.

### 2.2 Supply Surface and Enforcement Surface Separated

Configuration (pool, resident, blacklist, role bindings) is the declarative supply surface; the `restrict` allowlist, catalog injection, index injection, and recall results are the enforcement surface. The enforcement surface derives from configuration and never writes back to it.

This lets configuration evolve freely, self-heal, and be rebuilt across sessions, while the enforcement surface can be re-derived repeatedly within an agent's lifecycle without contaminating the source of truth. It also turns "configuration is correct but enforcement did not take effect" into a separately diagnosable class of problem.

### 2.3 Recall as Explicit Incremental Supply

At startup the model sees only resident capabilities; the rest enter the session history through `meta_search` recall and become part of the visible set for subsequent steps. Recall payloads carry the full schema so the model can call directly from the return value; a recall within the same step only becomes executable on the next step—an inherent latency of incremental supply, not a defect.

The supply surface is therefore split into "visible at startup" and "appearing on demand," and newly added capabilities do not disturb the existing KV prefix cache.

### 2.4 Configuration Shared at the Source, No Duplicated Copy

MCP configuration is read through the official `mcp-manager` and written through the official `config-editor`, the same copy used by the Agent and official Settings; the source of truth for custom tools and skills is the state directory, which the plugin discovers and registers by watching rather than indexing separately. The plugin is a governance surface, not a second source of truth.

The benefit of sharing the source is that listings, status, and external edits stay consistent by construction; the cost is dependence on the official write path and Loader reconciliation being available—when they are not, the plugin degrades to read-only and explains why.

---

## 3. Key Trade-offs

| Design choice | Main benefit | Cost incurred |
| --- | --- | --- |
| Hard-whitelist pool plus resident subset, rather than full exposure | Context cost is controllable; the model's choice surface narrows | Requires maintaining an index and a recall channel; users must understand two layers of state |
| `meta_search` on-demand recall, rather than statically injecting all schemas | New capabilities do not break the KV prefix cache | Recall has a one-step delay and is not immediately callable within the same step |
| Strict priority of blacklist > pool > resident | Role differences are expressible without conflicting with global config | The blacklist can exclude resident capabilities; needs UI warnings and test coverage |
| Every enforcement surface derived from the decision chain, not implemented separately | One criterion, unit-testable, auditable | Every new enforcement surface must be checked against the chain |
| MCP configuration shares the official write path, no self-held copy | Naturally consistent with Agent / Settings | Depends on Loader entry and editor availability; otherwise read-only fallback |
| A shadow `skill` tool takes over skill supply | Skills and tools governed by the same pool and blacklist | Must coordinate with official catalog injection to avoid duplicate injection |
| Tightening configuration is visible to in-flight sessions only with delay | Preserves addition-only and the KV cache | The UI must state the delay; a new session may be needed |
| The user's `/name` gesture is not restricted by the pool | Explicit use takes precedence; human-in-the-loop is not blocked by governance | The distinction from "out-of-pool is not injected into context" must be made clear in the copy |

These trade-offs do not imply that this project has a superior approach to capability governance. It pursues a configurable supply architecture: a suitable balance between "pre-visible" and "recalled on demand" according to context budget, task uncertainty, and governance requirements.

---

## 4. Architectural Invariants

The following constraints form the long-term architectural boundary:

1. **Harness first.** Tools, Skills, Session, and MCP connections are provided by DeepSeek Harness; the plugin extends only through public capabilities and does not rebuild or modify the runtime inside the plugin.
2. **Single decision chain.** Blacklist > pool > resident > recall > use. No enforcement surface may deviate from this chain, nor introduce a second availability criterion.
3. **Supply surface and enforcement surface separated.** The enforcement surface derives from configuration and never writes back; configuration is the source of truth and enforcement is a projection.
4. **Configuration shared at the source.** The source of truth for MCP and custom capabilities lies in the official manager and the state directory; the plugin holds no second copy and does not write its own patch to bypass reconciliation.
5. **Fail towards not taking effect.** When absorption fails, the candidate set is empty, or the allowlist is empty, nothing is tightened; the combination of "tools taken away and recall unavailable" must never occur—this plugin's restriction can take away its own user's tools, so the direction of degradation must be towards availability, never towards total blindness.
6. **Tightening is visible only with delay.** Under addition-only, removals emit no notification; the UI must truthfully state the delay and must not mask an in-flight session's stale view with "already in effect."
7. **Explicit use takes precedence.** The capability pool, resident set, and blacklist constrain autonomous model invocation and the capability supply surface; a capability explicitly named by the user is not constrained by them.

These constraints define the architectural boundary and are used to evaluate design changes. The implementation is governed by code and tests; when long-term architectural principles change, this document should be updated accordingly.