# Contributing

<p>
  <b>English</b> · <a href="CONTRIBUTING.md">简体中文</a>
</p>

Thank you for willing to put your time and ideas into this project. This is a research-driven personal project, and contributions of all kinds are welcome: bug fixes, documentation improvements, UI polish, recall and governance enhancements, new-feature experiments, and secondary development based on this architecture.

## Understand the Project Boundaries First

This project has a clear architectural stance—governable, on-demand capability supply. The following are not recommended for direct PR changes; if you have different ideas, please open an Issue to discuss first (the full statements live in the "Architectural Invariants" section of the [Architecture document](architecture.en.md)):

- **Harness first**: tools, Skills, Session, and MCP connections are provided by DeepSeek Harness; the plugin extends only through public capabilities and never rebuilds or modifies the runtime inside the plugin;
- **A single decision chain**: blacklist > pool > residency > recall > use; no enforcement surface may deviate from this chain or introduce a second availability semantics;
- **Supply/demand plane separated from enforcement**: enforcement is derived from configuration and never writes back to it;
- **Configuration shares its source**: the truth of MCP and custom capabilities lives in the official manager and the state directory; the plugin holds no second copy and never writes patches that bypass reconciliation;
- **Failures degrade toward "not in effect"**: never a combination of "tools taken away and recall unavailable"—this plugin's restrictions take away the user's own tools, so degradation must land on usable, not blind;
- **Explicit use outranks governance**: the user's `/name` gesture is not constrained by the pool, residency, or blacklists.

**Everything else is open**

## Submitting PRs

Small, focused PRs are the most welcome—they are easier to process quickly.

For large refactors or feature rewrites, please open an Issue first. Such PRs may not be merged directly, but I will read and evaluate them carefully and extract the useful parts into the existing architecture.

The project iterates quickly; just submit against the code you forked, and do not worry about merge conflicts. Mechanical conflicts are handled by me; if semantics are involved, I will confirm with you in the PR.

## Extend, Rather Than Modify

If you have ideas about the architecture, the friendliest way to participate is to **fork this repository, build on its architecture, or create your own DSH plugin**. You do not need to wait for review—your implementation can serve your own scenario immediately while keeping in sync with upstream improvements.

If you discover architectural shortcomings while extending, come back and open an Issue. Feedback backed by a real implementation carries far more weight than abstract design.

## Development & Testing

For environment setup, build, test, and type-check commands, see the "Local Development" section of the [README](../README.en.md). Before submitting, make sure `pnpm check` (typecheck + test + build) passes; if you add behavior, add the corresponding tests.

A few hard conventions of this repository (the full rules live in the root `AGENTS.md` and the ones in each subdirectory):

- **Pure functions first**: deterministic computation—decisions, normalization, projections—must be pure functions with all facts passed in; the shared layer `src/shared/` forbids runtime imports.
- **Tests mirror the source**: unit directories under `tests/` mirror the `src/` structure, files named `<source-name>.test.ts`; new business logic must have test coverage, with a line-coverage target of ≥ 80% for new code; never delete assertions or loosen conditions just to make tests pass.
- **UI text must be bilingual**: every user-visible string goes through the `zh` / `en` dictionaries in `src/client/i18n.ts`, added in sync; hardcoding in components is forbidden.
- **Comments explain why only**: capture constraints, decision background, and pitfalls the code does not express—never restate the code; update or delete comments when behavior changes.
- **Contract changes are checked in sync**: when modifying public interfaces, data structures, or contracts, check callers and tests together; record behavior changes explicitly, and never smuggle behavior changes into pure refactors.

## Finally

Every contributor willing to invest time and effort deserves respect. I will review every submission as carefully as I can, and I look forward to your Issues and PRs.