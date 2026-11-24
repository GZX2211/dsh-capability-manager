# Root AGENTS.md

<p>
  <b>English</b> · <a href="AGENTS.md">简体中文</a>
</p>

> This is the English translation for international readers. [AGENTS.md](AGENTS.md) is the single authoritative version.

## Repository Governance (Source of Authority)

`AGENTS.md` is organized in three layers. Each layer states only the rules it governs; the same rule is never repeated across layers.

| Layer | File | Scope | Content responsibility |
|---|---|---|---|
| Repository | `AGENTS.md` | Whole repository | Rules common to the whole repository |
| Tests | `tests/AGENTS.md` | Test domain | Rules specific to the test domain only |
| Business | `src/<domain>/AGENTS.md` | Business domain | Rules specific to that business domain only |

---

## Development Rules

- Prefer pure functions for core logic; keep dependencies one-directional; put shared logic in modules with a clear responsibility.
- Names should describe responsibility, not implementation.
- Each file carries one clear responsibility and, as far as possible, one main reason to change; split different responsibilities into separate modules.
- When modifying public interfaces, data structures, or contracts, check callers, tests, and related content in sync.

---

## Comment Rules

- Principle: comments only add what the code does not express, and only explain *why* (non-obvious constraints, workarounds, decision background, pitfalls); if deleting it does not hurt understanding, do not write it.
- Forbidden: historical narration; line numbers / internal document pointers; restating the code; asserting external library behavior.
- Keep: the file-path header comment on the first line.
- Required: compatibility and degradation (branch conditions, failure behavior); invariants / preconditions; business / security rules; design rationale that cannot be inferred from the code.
- Writing: stay close to the code being described; use natural language only and leave structural tags to tools; be concise, no longer than necessary.
- Update or delete comments when behavior changes; when they cannot be kept in sync, deleting is better than keeping a wrong comment.

---

## Internationalization Rules

- Any UI text a user can directly see must be bilingual (including toasts, buttons, text, etc.); build an i18n dictionary.
- Other project language policies that serve international users and international developers.

---

## Special Notes

* You do not need to read AGENTS.md; it is injected into your context automatically when you enter.
* The docs directory is the single home for all *project documents*.
* collab/ is the Agent collaboration area: img/ holds temporary images (including e2e verification screenshots), md/ holds temporary collaboration documents, scr/ holds temporary probes and scripts. Any other unclassified temporary file goes under collab/.
* docs/archive is the single home for archived files; none of the files inside may be read.
* scripts/ is the build-script directory.