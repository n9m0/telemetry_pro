<!--
Sync Impact Report
- Version change: none -> 1.0.0 (initial constitution)
- Modified principles: none
- Added sections: five core principles; Additional Constraints; Development Workflow
- Removed sections: Target Technology Stack (not applicable to UPGRADE mode)
- Templates reviewed:
  - ✅ <plugin>/skills/creating-implementation-plan/templates/plan-template.md — Constitution Check supports principle-by-principle validation.
  - ✅ <plugin>/skills/feature-inventory/templates/spec-template.md — its mandatory requirements and measurable outcomes align with the principles.
  - ✅ <plugin>/skills/creating-implementation-plan/templates/tasks-template.md — validation tasks remain available for the project’s existing test workflow.
- Follow-up TODO: original ratification date is not documented.
-->
# Mac System Monitor Constitution

## Migration Mode

**Mode**: UPGRADE

**Justification**: This is an existing local-first telemetry dashboard with an established
React and TypeScript frontend, Node.js backend, and test workflow. Changes must preserve
its architecture and observable behavior unless a change is explicitly requested.

## Core Principles

### I. Local-First Privacy

Telemetry, inference observations, and benchmark history MUST remain on the user's machine.
Services and integrations MUST use loopback addresses by default, and the application MUST
NOT upload collected data or introduce analytics or remote APIs without an explicit,
reviewed change to this principle. This protects the monitor's defining privacy boundary.

### II. Honest, Provenance-Bearing Metrics

Every reported metric MUST communicate its unit, quality, and source. Values MUST be
identified as measured, calculated, estimated, or unavailable; unavailable readings MUST
remain unavailable rather than being fabricated, inferred from unrelated signals, or
presented as measured. This keeps system-health decisions grounded in what the data can
actually establish.

### III. Safe System Integration

System commands MUST use explicit argument arrays and narrowly scoped inputs. The
application MUST NOT request administrator access, install privileged helpers, change
system settings, or download models. Ollama integrations MUST remain restricted to
validated loopback targets and supported API paths. These limits reduce the risk and
surprise of a local monitoring tool.

### IV. Failure Isolation and Clear Limits

A failure or unavailable source in one collector or integration MUST NOT prevent unrelated
telemetry from being reported. The UI and documentation MUST distinguish unsupported or
inaccessible readings from zero values and MUST describe material measurement limitations.
This keeps partial system visibility useful without overstating coverage.

### V. Behavior-Preserving, Verified Changes

Changes MUST preserve existing behavior outside the requested scope. Behavioral changes
MUST be covered by relevant automated tests; when existing tests do not exercise changed
behavior, tests MUST be added or the uncovered risk documented. Before delivery, run the
smallest applicable checks from the repository's typecheck, lint, unit-test, end-to-end,
and build scripts. User-visible changes and new limitations MUST be reflected in the
relevant documentation.

## Additional Constraints

- The supported platform is macOS, with Apple Silicon as the primary target.
- The documented runtime requirement is Node.js 22 or later with npm. Ollama is optional.
- Network-facing application services MUST bind to loopback; non-loopback `HOST` values
  MUST be rejected.
- Sensor and thermal readings unavailable to an unprivileged process MUST be reported as
  unavailable rather than obtained through elevated privileges or unsupported substitutes.

## Development Workflow

- Review each change against all five principles before merging or releasing it. Any
  exception requires an explicit rationale, a description of its user and privacy impact,
  and approval by the project maintainer.
- Use the existing npm scripts for validation: `npm run typecheck`, `npm run lint`,
  `npm test`, `npm run test:e2e`, and `npm run build`, selecting checks appropriate to the
  change and its affected behavior.
- Changes to metric sources, quality labels, integration boundaries, or persistence MUST
  include corresponding documentation updates and tests for the changed contract.

## Governance

This constitution governs project design, implementation, review, and release decisions.
Amendments require a written rationale, maintainer approval, an impact review of dependent
specifications and plans, and an update to this document. The version MUST follow semantic
versioning: MAJOR for incompatible changes to principles or governance, MINOR for added
principles or materially expanded requirements, and PATCH for clarifications that do not
change requirements. Each review MUST verify principle compliance, applicable validation
results, and whether documented limitations and privacy boundaries remain accurate.

**Version**: 1.0.0 | **Ratified**: TODO(RATIFICATION_DATE): original adoption date is not documented | **Last Amended**: 2026-11-08
