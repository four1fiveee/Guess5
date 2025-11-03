export const IDL = {
  "version": "0.1.0",
  "name": "guess5_escrow",
  "address": "ASLA3yCccjSoMAxoYBciM5vqdCZKcedd2QkbVWtjQEL4",
  "instructions": [
    {
      "name": "createMatch",
      "docs": ["Creates a new match with escrow vault"],
      "accounts": [
        {
          "name": "matchAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "player1",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "player2",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "feeWallet",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "stakeAmount",
          "type": "u64"
        },
        {
          "name": "feeBps",
          "type": "u16"
        },
        {
          "name": "deadlineSlot",
          "type": "u64"
        }
      ]
    }
  ],
  "types": []
};
