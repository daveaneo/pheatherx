# FHE Operation Gas Costs

Gas costs measured using MockTaskManager on local Anvil. These are representative of relative costs between operations.

## Trivial Encryption (Plaintext → Encrypted)

| Operation | Gas Cost |
|-----------|----------|
| FHE.asEuint128(plaintext) | 92,634 |
| FHE.asEbool(plaintext) | 41,320 |

## Arithmetic Operations

| Operation | Gas Cost |
|-----------|----------|
| FHE.add | 118,718 |
| FHE.sub | 115,737 |
| FHE.mul | 124,582 |
| FHE.div | 121,178 |
| FHE.rem | 102,603 |

## Comparison Operations

| Operation | Gas Cost |
|-----------|----------|
| FHE.lt | 131,169 |
| FHE.lte | 129,111 |
| FHE.gt | 113,146 |
| FHE.gte | 107,924 |
| FHE.eq | 117,881 |
| FHE.ne | 140,051 |

## Min/Max Operations

| Operation | Gas Cost |
|-----------|----------|
| FHE.min | 136,728 |
| FHE.max | 138,712 |

## Bitwise Operations

| Operation | Gas Cost |
|-----------|----------|
| FHE.and | 118,497 |
| FHE.or | 119,889 |
| FHE.xor | 117,517 |
| FHE.not | 77,223 |
| FHE.shl | 105,470 |
| FHE.shr | 107,046 |

## Conditional Selection

| Operation | Gas Cost |
|-----------|----------|
| FHE.select | 132,861 |

## ACL Operations (Permission Management)

| Operation | Gas Cost | Notes |
|-----------|----------|-------|
| FHE.allowThis | 25,846 | Permanent permission for this contract |
| FHE.allow | 27,992 | Permanent permission for specific address |
| FHE.allowGlobal | 23,381 | Permanent permission for all addresses |
| **FHE.allowTransient** | **4,050** | **Temporary (tx-only) - 84% cheaper!** |
| FHE.allowSender | 25,849 | Permanent permission for msg.sender |

### ACL Optimization Strategy

`FHE.allowTransient` is **84% cheaper** than `FHE.allowThis` (saves ~21.8k gas per call).

**Use `allowTransient` when:**
- Value is only used within the same transaction
- Value is passed to another contract during the same tx
- Value does not need to persist in storage

**Use `allowThis` when:**
- Value is written to contract storage
- Value needs to be accessible in future transactions

## Notes

- Measured using `@fhenixprotocol/cofhe-mock-contracts` MockTaskManager
- Real CoFHE precompile on testnet may have different absolute costs
- Relative costs between operations are accurate for optimization decisions
- Test file: `contracts/test/integration/LocalFHEIntegration.t.sol`
