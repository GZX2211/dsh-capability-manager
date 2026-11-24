<p align="center">
  <!-- Image placeholder: project banner / capability manager main view -->
  <img src="" width="100%" />
</p>

<h1 align="center">Capability Manager</h1>

<p align="center">
  A global capability-governance plugin built on <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a><br>
  The model starts with a minimal capability set and recalls the rest through meta_search; the pool, residency, role blacklists, and MCP connections are governed in one place
</p>

<p align="center">
  <b>English</b> · <a href="README.md">简体中文</a>
</p>

<p align="center">
  <a href="#"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6-blue"></a>
  <a href="#"><img alt="React" src="https://img.shields.io/badge/React-18-blueviolet"></a>
  <a href="#"><img alt="Node" src="https://img.shields.io/badge/Node-%E2%89%A522.19-green"></a>
  <a href="#"><img alt="pnpm" src="https://img.shields.io/badge/pnpm-12-orange"></a>
  <a href="#"><img alt="vitest" src="https://img.shields.io/badge/test-vitest-cyan"></a>
  <a href="#"><img alt="license" src="https://img.shields.io/badge/license-MIT-lightgrey"></a>
  <a href="#"><img alt="version" src="https://img.shields.io/badge/version-0.1.0-0891b2"></a>
</p>

---

## Positioning

The set of tools visible to the model grows with every plugin: each tool's full schema consumes context and KV prefix space, and the more tools there are, the wider the model's choice surface and the higher the cost of judgment.

This plugin shifts capability supply from "statically full" to "a governable on-demand surface": the **capability pool** is a hard whitelist, **residency** defines the minimal startup-visible set, and **`meta_search`** is the on-demand recall channel. When dsh-personal-agent (the same author's personal-agent plugin) is detected, two **role blacklists** (Router / Worker) are layered on top.

```text
Capability = Tools + Skills
Tools      = official tools + custom tools + MCP tools
Skills     = official skills + custom skills

Decision chain (first match wins):

  role blacklist ──► pool ──► residency ──► meta_search recall ──► use
  (highest priority) (hard whitelist) (visible at start) (on-demand supply)
```

Out of the box: every capability is in the pool, only the two meta capabilities `meta_search` and `skill` are resident, blacklists are empty, and vector search is off. A new session starts with just these two entry points; the model recalls everything else as the task requires.

> The plugin rebuilds no runtime capability; it only opens and closes visibility through Harness's public interfaces. Configuration is the source of truth; enforcement is a projection.

---

## Highlights

✦ **Minimal startup surface + on-demand recall**
  - Only resident capabilities' full schemas are injected at startup; everything else enters the session through `meta_search` and **becomes callable from the next step on**, so new capabilities never break the KV prefix cache.
  - Recall records are rebuilt from the session log: **capabilities recalled earlier remain available after a restart**, with no need to recall them again.
  - **Payload-level deduplication** runs before every return: items byte-identical to a same-type payload already in the current context are dropped, so the same schema never occupies the context twice.

✦ **Tools and Skills under one governance**
  - A same-name shadow takes over the official `skill` tool and the skill catalog, so Skills and tools are governed by the same pool, residency, and blacklists.
  - Loading a Skill explicitly with `/name` in the composer is **not restricted by the pool**—explicit use outranks governance; the human in the loop is never blocked.

<table>
  <tr>
    <td width="50%" valign="top">
      <!-- Image placeholder: Tools tab transfer panes (Excluded / Pool / resident switches) -->
      <img src="" width="100%" />
    </td>
    <td width="50%" valign="top">
      <!-- Image placeholder: Settings tab (vector search / role blacklists) -->
      <img src="" width="100%" />
    </td>
  </tr>
</table>

> The two transfer panes manage in-pool / out-of-pool; the in-row switch manages residency; the warning bar points out configurations that would break the recall chain in real time.

✦ **Two recall channels, two operating modes**
  - **Mode A (default, vector search off)**: a tool index and the skill catalog are injected (names and one-line summaries only); the `names` channel recalls tools by exact regex match—always available, batch-friendly.
  - **Mode B (vector search on)**: no index is injected; the `keywords` channel recalls tools and Skills by semantic similarity. The model is `bge-small-zh-v1.5` (int8-quantized ONNX, ~24 MB), downloaded and verified on first enable; a failure keeps it off and reports why.

✦ **Role blacklists (optional integration)**
  - The Router / Worker panels appear only when Personal Agent's `paRoles` service is detected. A blacklist outranks everything: it excludes pooled and resident capabilities alike, and applies only to sessions of that role.
  - Roles are decided by Personal Agent first; a manual binding only fills in sessions it does not decide. Sessions with an unknown role are unaffected by either blacklist.

✦ **MCP connection management, same source as the official one**
  - Create / edit / enable / disable / delete MCP servers in the UI, with batch import of `mcp.json`; toggles take effect immediately, no restart needed.
  - Reads go through the official `mcp-manager`, writes through the official `config-editor`: it is **the same configuration** the Agent and the official Settings use—mutually visible, consistent state, no copy held by the plugin.

✦ **Custom capabilities, hot effect**
  - The built-in `capability-creator` Skill lets the Agent decide the type and write custom tools (declarative shell / http, or code `impl.mjs`) and custom Skills directly; files written into the state directory are watched and registered without a restart.
  - You can also generate a skeleton via "Create a skill manually" in the UI, edit it, then move it into the pool to enable it. New capabilities enter the pool by default and are not resident by default.

✦ **Failures degrade toward "not in effect"**
  - When absorption fails, candidates are empty, or the allow list is empty, nothing is tightened—never a combination of "tools taken away and recall unavailable". Restrictions have two independent release paths: plugin unload and agent disposal.

<p align="center">
  <!-- Image placeholder: meta_search recalling tools inside a live session -->
  <img src="" width="100%" />
</p>

---

## Core Concepts

| Concept | Description |
|------|------|
| **Capability** | Umbrella term for tools + Skills; tools come from official / custom / MCP sources, Skills from official / custom |
| **Capability pool** | The full set of capabilities currently allowed; a hard whitelist. Out-of-pool capabilities cannot be called, recalled, or injected into context |
| **Excluded** | Capabilities moved out of the pool; the left pane in the UI—click the plus to put one back |
| **Resident** | The subset available immediately at startup, selectable only from the pool; non-resident capabilities must be recalled via `meta_search` |
| **`meta_search`** | The recall tool: `names` exact-regex channel (tools only) + `keywords` semantic channel (tools and Skills, mode B only); itself an ordinary pooled capability that can be excluded or made non-resident |
| **`skill` (shadow)** | The taken-over Skill loader: validates the pool and blacklist, then renders the body; coordinates with the official catalog injection to avoid duplicates |
| **Payload-level dedupe** | Before returning, each payload is compared byte-for-byte with same-type payloads in the current context; only exact matches are dropped. A tool index ≠ a tool schema—they never dedupe against each other |
| **Tool index / skill catalog** | Name + summary lists injected in mode A: the index lists non-resident tools only, the catalog lists all pooled Skills; nothing is injected in mode B |
| **Role blacklist** | Per-role exclusion lists for Router / Worker, highest priority; configurable only when Personal Agent is detected |
| **Session role binding** | A manual fallback for naming a session's role; dormant whenever Personal Agent has already decided |
| **Vector search** | The semantic-recall subsystem of mode B: model download and verification, WordPiece tokenization, CLS pooling, cosine top-K; vectors are cached incrementally by summary hash |

---

## Plugin Tools & Built-in Skill

| Name | Kind | Purpose |
|---|---|---|
| **`meta_search`** | Tool | Recalls pooled capabilities: `names` (regex name group, tools only, always available), `keywords` (semantic, mode B only), `limit` (default 20, max 50); returns full tool schemas and Skill index entries |
| **`skill`** | Tool (shadow) | Loads a Skill's body by name; validates the capability pool and role blacklist before loading |
| **`capability-creator`** | Built-in Skill | Guides the Agent through creating custom tools / custom Skills / configuring MCP: decide the type, write the files, check name collisions—effective immediately on write |

> Recalled tools become callable from the **next step**: the restriction rebuild takes effect on the next step, so calling one within the same step using the returned schema will fail. This is the inherent latency of incremental supply.

---

## Installation (Windows)

> **Version compatibility**: this plugin targets the **DeepSeek Harness `0.2.2-rc` line** (developed and verified against `0.2.2-rc.3`, Desktop profile `desktop`). Install or upgrade the host first (**fully stop the dsh process** in an external terminal before upgrading):
>
> ```bash
> npm install -g @deepseek-ai/dsh@0.2.2-rc.3
> ```
> Tip: you can paste the following steps directly to an AI assistant such as Claude Codex to install the plugin. When using the web profile, replace `desktop` with `web` in the commands below.

1. **Locate in File Explorer**: `%USERPROFILE%\.dsh\profiles\desktop\pnpm-workspace.yaml`, and add:

```yaml
allowBuilds:
  onnxruntime-node: true
```

2. **Run the plugin install command**:

```bash
dsh plugin --profile desktop add "github:GZX2211/dsh-capability-manager#master"
```

3. **On Desktop you can also add and install from the Plugins page in the top-left corner**:

```
github:GZX2211/dsh-capability-manager#master
```

4. **Verify the mount** (optional):

```bash
dsh --profile desktop --dump-config | findstr "capability-manager"
```

5. **Restart** dsh or the Desktop app. Open the manager: click the **"Capabilities" entry in the official left sidebar** (below the "Plugins" button) for the full management UI.

### Installation Troubleshooting

**`Host key verification failed`**

Run in **PowerShell** or **CMD**:

```bash
git config --global url."https://github.com/".insteadOf "git@github.com:"
```

**pnpm blocks the install: build scripts declared, `allowBuilds` required** (common)

Locate in File Explorer: `%USERPROFILE%\.dsh\profiles\desktop\pnpm-workspace.yaml`, add the package named in the error to the `allowBuilds` list, save, and reinstall.

### Uninstall

```bash
dsh plugin --profile desktop remove dsh-capability-manager
```

> If you no longer use the plugin, you may also clean up the state directory: `~/.dsh/state/capability-manager/` (MCP configuration does not live there—it is stored in the official configuration, and uninstalling the plugin does not affect configured servers).

## Quick Start

- Understand the architecture? See the [Architecture document](docs/architecture.en.md)
- Want to contribute? See [Contributing](docs/CONTRIBUTING.en.md)
- Learn how to use the plugin? See the [User Guide](docs/USER_GUIDE.en.md)
- Secondary development? See the [development rules](AGENTS.md)
- Installation and project overview? This file, [README.en.md](README.en.md)

---

## Data Storage

The plugin's private state lives in `<DSH_HOME>/state/capability-manager/` (falling back to `~/.dsh/state/capability-manager/` when `DSH_HOME` is absent):

```
config.json                 # pool / residency / blacklists / vector search / role bindings (atomic writes, self-healing reads)
tools/<name>/               # custom tools: meta.json (declarative shell/http) + optional impl.mjs (code)
skills/<name>/              # custom Skills: SKILL.md + references/
models/bge-small-zh-v1.5/   # vector model weights, tokenizer, manifest, and the vector cache vectors.json
```

> MCP configuration is **not** in the state directory: it is written into the profile configuration through the official `config-editor`, the same source as the official Settings. Session recall records are not persisted; they are rebuilt from the session log after a restart.

---

## Local Development

```bash
git clone https://github.com/GZX2211/dsh-capability-manager.git
cd dsh-capability-manager
pnpm install
pnpm build
dsh plugin --profile desktop add "link:$PWD"
```

Common commands:

```bash
pnpm typecheck      # type checking
pnpm test           # unit + integration tests (vitest)
pnpm build          # build Host + Client (tsdown)
pnpm check          # typecheck + test + build
```

> Client changes require a rebuild and a hard browser refresh; Host changes require restarting dsh or the Desktop app. Layered development rules live in the root `AGENTS.md` and the ones under each `src/` and `tests/` subdirectory.

---

## Known Limitations

| Item | Description |
|---|---|
| Tightening is delayed for in-flight sessions | The host's `addition-only` protocol sends no tool-removal notices; the UI states this honestly—start a new session when needed |
| Recall has a one-step latency | A tool recalled within a step can only be executed from the next step |
| Tools registered on the agent's own scope escape the pool | A semantic boundary of `restrict`; such tools are session-specific |
| Custom code tools have no sandbox | They run in the host process; prefer declarative tools and review code tools yourself |
| Long-lived sessions accumulate recall records | The recall set is rebuilt from the session log without distinguishing why tools were added; new sessions always behave correctly |

Planned: Skill version control.

---

## License

MIT © GZX2211. Issues and PRs are welcome.