# FheatherX Test Wallet

A dedicated test wallet for FheatherX development. This wallet is separate from the standard Anvil accounts to avoid confusion.

## Wallet Details

- **Mnemonic:** `ladder upset equal pigeon rotate copper mandate mesh grant tiger case tag`
- **Address:** `0xA66bbE4E307462d37457d363FBE4814428C9278A`
- **Private Key:** `0xc8b6da05290c267f6917e4da157083ff3773a2414eec3b8920596fed00e9ce7b`

## Funding

When Anvil is running with the standard test mnemonic, fund this wallet:

```bash
# Send 10,000 ETH from Anvil account 0
cast send 0xA66bbE4E307462d37457d363FBE4814428C9278A --value 10000ether --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

# Mint test tokens (run after deploying MockFheatherX)
# Token0: 0x5FbDB2315678afecb367f032d93F642f64180aa3
# Token1: 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
cast send 0x5FbDB2315678afecb367f032d93F642f64180aa3 "mint(address,uint256)" 0xA66bbE4E307462d37457d363FBE4814428C9278A 1000000000000000000000000 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
cast send 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512 "mint(address,uint256)" 0xA66bbE4E307462d37457d363FBE4814428C9278A 1000000000000000000000000 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

## MetaMask Import

1. Open MetaMask
2. Click account selector → "Add account or hardware wallet"
3. Select "Import account"
4. Paste the private key: `0xc8b6da05290c267f6917e4da157083ff3773a2414eec3b8920596fed00e9ce7b`
5. Click "Import"

## Network Configuration

Add Anvil network to MetaMask:
- Network Name: `Local Anvil`
- RPC URL: `http://127.0.0.1:8545`
- Chain ID: `31337`
- Currency Symbol: `ETH`
