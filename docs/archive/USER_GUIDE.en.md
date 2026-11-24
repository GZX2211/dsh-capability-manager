# User Guide

<p>
  <b>English</b> · <a href="USER_GUIDE.md">简体中文</a>
</p>

This document focuses only on the actual operation of the plugin and explains **how to use** each feature;
for basic concepts and installation, see the [README](../README.en.md).

## 1. The Main View

<p align="center">
  <!-- Image placeholder: capability manager overview (header / tabs / filters / transfer panes, annotated) -->
  <img src="" width="100%" />
</p>

> Click the "Capabilities" entry in the official left sidebar (below the "Plugins" button) to open the manager. All capability governance happens on this single page.

From top to bottom:

| Area | Content |
|---|---|
| Header | Title, help button (?), **Refresh**, the **Create capability** split button |
| Tabs | **Tools** / **Skills** / **MCP** / **Settings** |
| Toolbar | Source filter pills (All / Official / Custom / MCP) + search box (substring match on name and purpose, filters as you type) |
| Transfer panes | Left: **Excluded**; right: **Pool**; the divider between them is draggable (also ← / → to nudge, Home / End to the edges, double-click to reset) |
| Warning bar | Below the header; lists configurations that would break the recall chain, click to expand details |

Extra: what is inside the help button (?)?
- It explains the transfer panes, the resident switch, the recall mechanism, and whether you are in mode A or mode B.
- It states two easily misunderstood rules explicitly: **loading a skill with `/name` is not restricted by the pool**; **recalled results become callable from the next step on**.

## 2. Managing the Pool and Residency

<table>
  <tr>
    <td width="50%" valign="top">
      <!-- Image placeholder: Tools tab operations (plus / minus / resident switch / open folder) -->
      <img src="" width="100%" />
    </td>
    <td width="50%" valign="top">
      <!-- Image placeholder: expanded warning bar details -->
      <img src="" width="100%" />
    </td>
  </tr>
</table>

> The Tools and Skills tabs share the same transfer panes—the most frequently used management surface of the plugin. The Skills tab has no MCP filter (MCP servers provide tools only, not skills).

Each capability has exactly two configurable states:

| State | Operation | Effect |
|---|---|---|
| **In pool / out of pool** | Click the **minus** on a pool row to move it out; click the **plus** on an excluded row to put it back | Out of pool: cannot be called, recalled, or listed in the index; moving out also clears residency |
| **Resident / non-resident** | The **resident switch** inside a pool row | Resident: available immediately at startup; non-resident: must be recalled by name through `meta_search` |

Key points:

1. Residency can only be chosen from the pool; resident items are pinned to the top of the pool pane.
2. The pane counters (e.g. `3/26`) use the **current filtered result** as the denominator, not all capabilities.
3. Custom capability rows have an **Open folder** button (left of the plus / minus) that opens the source directory in the file manager.
4. Changes are saved immediately; if another window changed the configuration meanwhile, you will see "The configuration changed in another window; reloaded".

### What the warnings mean

| Warning | Meaning |
|---|---|
| `meta_search` is not resident | Non-resident pool capabilities cannot be recalled |
| `meta_search` is excluded | Nothing can be recalled; the model works with resident capabilities only |
| The `skill` tool is excluded | No skill can be loaded |
| Nothing is resident | The model starts with no capability available |
| The blacklist excludes resident capabilities | Those capabilities become unavailable for that role |

> All of these configurations are **legal**—the plugin will not stop you, it only reports the consequences honestly. Deliberately tightening to the limit is a valid use too.

## 3. How Recall Happens

You never trigger recall manually: the model calls `meta_search` itself during a session. Understanding its behavior helps you judge whether your configuration is sound.

```text
Session start: the model sees only resident capabilities (meta_search + skill by default)
   │
   ├─ Mode A: a tool index + skill catalog are injected (names and summaries only)
   │    the index tells the model what exists → meta_search(names: "read|grep") fetches full definitions
   │
   └─ Mode B: no index is injected
        meta_search(keywords: "read file contents") recalls tools and skills semantically
   │
   ▼
Recall returns: tools come with full schemas (callable from the next step); skills come as index entries (load the body via skill)
   │
   ▼
Restart / resume: previously recalled tools are rebuilt from the session log and remain available—no re-recall needed
```

A few behaviors worth knowing:

- **The `names` channel recalls tools only**; it accepts regex name groups like `read|write|edit` and is always available. Skills load directly from the resident catalog in mode A, and are recalled through `keywords` in mode B.
- **A `names` hit on a skill name returns only a note**, never entries: in mode A it says "the skill catalog is already in context—load it directly via skill"; in mode B it says "use keywords for semantic recall instead".
- **Dedupe is payload-level**: only payloads byte-identical to the current context are dropped. An empty return is not a failure—the target capability may already be in context.
- **A tool recalled within a step cannot execute in that same step**; it becomes callable from the next step, and the return value says so.

<p align="center">
  <!-- Image placeholder: a meta_search call and its return inside a session -->
  <img src="" width="100%" />
</p>

## 4. Vector Search (Switching Mode A / B)

In **Settings → Vector search**:

1. Turn on **Enable vector search**. The first enable downloads the ~24 MB `bge-small-zh-v1.5` model (int8-quantized ONNX) from the network; the UI shows download / load status—please wait.
2. Once downloaded and verified, you enter **mode B**: no index is injected, and `keywords` semantic recall becomes active.
3. A failed download or load **keeps it off** and shows the reason here; exact regex recall is never affected.
4. Turning the switch off returns to **mode A** and the index is injected again.

> The mode is a global switch affecting all sessions. Model files and the vector cache live under `models/` in the plugin state directory; deleting them causes a re-download on the next enable.

<p align="center">
  <!-- Image placeholder: Settings vector-search section (switch / status / failure reason) -->
  <img src="" width="100%" />
</p>

## 5. MCP Connection Management

The **MCP** tab manages MCP server connections. The configuration here is **the same one** the Agent and the official Settings use: a server added on either side appears in the same list with the same name, transport, and state.

<table>
  <tr>
    <td width="50%" valign="top">
      <!-- Image placeholder: MCP list (state dots / tags / enable switches) -->
      <img src="" width="100%" />
    </td>
    <td width="50%" valign="top">
      <!-- Image placeholder: Configure MCP dialog (manual form / mcp.json import) -->
      <img src="" width="100%" />
    </td>
  </tr>
</table>

### Adding a server

Click **Configure MCP** in the top-right; two views:

- **Fill in manually**: enter the server name (letters, digits, underscore, hyphen; up to 32 characters—it is also the tool namespace); choose the transport—`stdio` takes a one-line launch command (run through cmd.exe automatically on Windows), `streamable-http` takes an endpoint URL; environment / headers are optional JSON objects.
- **Import mcp.json**: paste an `mcp.json`, preview each server, then write them in batch; same-name entries are overwritten and their enabled state is kept. The `sse` transport is not supported—use `streamable-http` or `stdio`.

Saving **takes effect immediately, no restart needed**. Once connected, the server's tools enter the capability pool by default; manage them back on the Tools tab (source filter: MCP).

### Everyday operations

| Operation | Description |
|---|---|
| Enable switch | Off: the entry stays, the connection unmounts (state "Disabled"); on: mounts and connects immediately, the state dot reflects the result live |
| State dot | Green = connected; in progress = connecting / reconnecting; yellow = missing credentials; red = connection failed (reason available); gray = disabled / not connected |
| Edit | The in-row edit button opens the dialog pre-filled; **the name cannot change after saving** (renaming means delete and recreate) |
| Delete | Only at the bottom of the edit dialog, with a click-again confirmation; deleting unmounts the connection and its tools |
| Filters | All / Connected / Not connected; search matches the name and target summary |

Boundaries:

- Servers registered by a plugin are tagged "registered by a plugin"—read-only, not editable or deletable here.
- When the profile does not mount the official MCP manager, the tab shows the reason and how to enable it instead of faking an empty list; when the configuration editor is unavailable, it degrades to read-only.
- `${credential:…}` templates in environment / headers are stored and echoed verbatim; the UI never claims to read secret values.
- There is a brief tool gap while a server is rebuilt—a known limitation of the official mechanism.

## 6. Creating Custom Capabilities

The **Create capability** split button in the header offers two ways:

### Let the Agent create it

Clicking it opens a new session pre-filled with "Help me create a skill / tool / MCP: "—continue typing your request after the colon. The built-in `capability-creator` Skill guides the Agent to:

1. Decide the type: run commands / read-write files / call HTTP → a custom tool; reusable task instructions → a custom Skill; connect an existing MCP endpoint → guided MCP configuration.
2. Confirm the name is free via `meta_search`.
3. Write files into the state directory: tools prefer the **declarative** form (`meta.json` describing shell / http—auditable, no arbitrary code); only complex logic gets an `impl.mjs`; Skills get a `SKILL.md`.
4. Writes are watched and registered—**no restart needed**; new capabilities enter the pool by default, are not resident by default, and can be recalled by `meta_search` right away.

> Security note: custom code tools run in the host process with no sandbox. Always review an Agent-written `impl.mjs` before enabling it, and never write access credentials into capability files.

### Create a skill manually

Click **Create a skill manually**: you are taken to the Skills tab, and a new entry appears pinned at the top of the Excluded pane (default name `my-skill`, auto-numbered on collision) with a "Custom" tag. Click its **Open folder** button, edit the `SKILL.md` (the skeleton already contains frontmatter and filling guidance) and `references/`, then click the plus to move it into the pool and enable it.

<p align="center">
  <!-- Image placeholder: the create-capability menu and the new custom entry -->
  <img src="" width="100%" />
</p>

## 7. Role Blacklists & Session Roles (Personal Agent required)

**Only when the Personal Agent plugin (`ctx.paRoles` service) is detected** do the "Role blacklists" and "Session roles" sections appear in Settings; otherwise an explanation is shown—never a panel you can configure but that does nothing.

### Role blacklists

Two side-by-side panels for Router and Worker, each with a searchable list:

- The in-row switch means "**disable for this role**"; disabled items are pinned to the top; the pane header carries a "disabled n/m" counter and a **Clear** action.
- Type filter pills: All / Tools / Skills; counters only count the filtered-and-searched set.
- Out-of-pool capabilities are still listed and tagged "Excluded": the blacklist and the pool are independent—configure first, pool later is a valid workflow.
- **A blacklist outranks everything**: it excludes pooled and resident capabilities alike; the two roles are independent, and sessions with an unknown role are unaffected by either.

### Session roles

Each active session shows its **effective role** and **source** (from the Personal Agent / from a manual binding / not determined yet):

- The manual binding has three states: **Automatic / Router / Worker**. "Automatic" writes no binding and hands the decision back to the Personal Agent.
- A manual binding is a **fallback**, not an override: when the Personal Agent has decided a role, the binding is dormant and does not take effect—the UI marks it.

<p align="center">
  <!-- Image placeholder: Settings role-blacklist panels and the session-role list -->
  <img src="" width="100%" />
</p>

## 8. Common Questions

- **The model says it has no tools / recall returns nothing**: check that `meta_search` is resident and in the pool (see the warning bar); confirm the target capability is pooled and not excluded by the current role's blacklist.
- **A just-recalled tool errors when called**: recalled tools become callable from the next step; executing within the same step fails. Let the model continue to the next step.
- **I tightened the configuration but an in-flight session did not change**: the host protocol sends no tool-removal notices, so tightening is delayed for in-flight sessions; start a new session when needed. Additions and loosening are visible immediately.
- **Do tools survive a restart?** Yes. Previously recalled tools are rebuilt from the session log—no re-recall needed.
- **Why can an out-of-pool skill still load via `/name`?** Explicit use outranks governance—this is by design; the pool only constrains the model's autonomous calls, the catalog, and recall.
- **An MCP server keeps showing "Connection failed"**: read the failure reason on the state dot; verify the launch command / endpoint and that dependencies are installed; when credentials are missing, configure them via the official credential templates.
- **A custom tool did not appear after writing it**: check the `meta.json` fields and that the directory name matches the spec (invalid entries are skipped with a specific reason in the log); names must not contain `__` (that is the MCP namespace).
- **Enabling vector search failed**: staying off is the intended degradation; fix the network or disk issue shown in the UI and retry—exact recall is always available.

If you hit a problem you cannot solve, note the situation and reproduce it once more (if possible), then raise it in an issue; if you are good at locating problems and fixing code, a PR is welcome too—I will handle it promptly.