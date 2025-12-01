# Frontend Implementation Plan

This folder contains the complete frontend implementation plan for PheatherX.

## Documents

### Current (v3)

| File | Description | Status |
|------|-------------|--------|
| **`FRONTEND_IMPLEMENTATION_PLAN_v3.md`** | **Current plan (v3)** | **Active** |
| `FRONTEND_IMPL_v3_APPENDIX_A_HOOKS.md` | Hooks & Utilities (FHE, deposit, gas) | Active |
| `FRONTEND_IMPL_v3_APPENDIX_B_STATE.md` | State & Validation (Zod, order status) | Active |
| `FRONTEND_IMPL_v3_APPENDIX_C_COMPONENTS.md` | UI Components | Active |

### Previous Versions

| Folder | Description |
|--------|-------------|
| `old/v1/` | Original v1 plan and critique |
| `old/v2/` | v2 plan, appendices, and audit |

## What's New in v3

v3 incorporates all findings from the v2 audit:

- Token approval flow (ERC20)
- Native ETH handling
- Gas estimation hook
- Order status derivation from events
- Network mismatch guard
- App loading states
- FHE retry logic with exponential backoff
- Block explorer links
- Form validation with Zod schemas
- Constants file
- Environment validation

## Getting Started

1. **Start with** `FRONTEND_IMPLEMENTATION_PLAN_v3.md` - the main implementation plan
2. **Reference appendices** as needed during each phase:
   - Appendix A: Hooks (FHE, deposit with approval, gas estimation)
   - Appendix B: State & Validation (Zustand stores, Zod schemas)
   - Appendix C: Components (UI components)

## Implementation Phases

| Phase | Name | Key Deliverables |
|-------|------|------------------|
| 0 | Project Setup | Next.js, dependencies, structure, constants, env validation |
| 1 | Core Infrastructure | Design system, wallet, network guard, app loader, gas estimation |
| 1.5 | FHE Infrastructure | Session management, encryption, retry logic |
| 2 | Portfolio & Balances | Token approval, native ETH, deposit, withdraw, reveal |
| 3 | Swap Interface | Router integration, hookData encoding, execution |
| 4 | Limit Orders | Zod validation, 4 order types, status derivation, history |
| 5 | Analytics | Metrics, charts, stats |
| 6 | Polish | Landing, placeholders, mobile |
| 7 | Testing | Unit, integration, E2E |

## Key Dependencies

- Next.js 14 (App Router)
- wagmi v2 + viem
- RainbowKit
- TanStack Query
- Zustand
- Tailwind CSS
- Zod (validation)
- cofhejs (FHE)

## Related Documents

- `../web-app-specs-v2.md` - UI/UX specifications
- `../IMPLEMENTATION_PLAN_v3.md` - Contract implementation plan

## Version History

| Version | Status | Notes |
|---------|--------|-------|
| v1 | Superseded | Original plan |
| v2 | Superseded | Added FHE infrastructure, router patterns |
| **v3** | **Active** | Incorporated audit findings |
