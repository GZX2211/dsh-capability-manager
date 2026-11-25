# Contributing

<p>
  <b>English</b> · <a href="CONTRIBUTING.md">简体中文</a>
</p>

Thank you for willing to put your time and ideas into this project. This is a research-driven personal project, and contributions of all kinds are welcome: bug fixes, documentation improvements, UI polish, recall and governance enhancements, new-feature experiments, and secondary development based on this architecture.

## Submitting PRs

Small, focused PRs are the most welcome—they are easier to process quickly.

For large refactors or feature rewrites, please open an Issue first. Such PRs may not be merged directly, but I will read and evaluate them carefully and extract the useful parts into the existing architecture.

The project iterates quickly; just submit against the code you forked, and do not worry about merge conflicts. Mechanical conflicts are handled by me; if semantics are involved, I will confirm with you in the PR.

## Extend, Rather Than Modify

If you have ideas about the architecture, the friendliest way to participate is to **fork this repository, build on its architecture, or create your own DSH plugin**. You do not need to wait for review—your implementation can serve your own scenario immediately while keeping in sync with upstream improvements.

If you discover architectural shortcomings while extending, come back and open an Issue. Feedback backed by a real implementation carries far more weight than abstract design.

## Development & Testing

For environment setup, build, test, and type-check commands, see the "Local Development" section of the [README](../README.en.md). Before submitting, make sure `pnpm check` (typecheck + test + build) passes; if you add behavior, add the corresponding tests.

## Finally

Every contributor willing to invest time and effort deserves respect. I will review every submission as carefully as I can, and I look forward to your Issues and PRs.