export const IDL = {
  "version": "0.1.0",
  "name": "guess5_escrow",
  "address": "ASLA3yCccjSoMAxoYBciM5vqdCZKcedd2QkbVWtjQEL4",
  "instructions": [
    {
      "name": "createMatch",
      "docs": [
        "Creates a new match with escrow vault"
      ],
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
          "name": "resultsAttestor",
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
          "name": "stakeLamports",
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
    },
    {
      "name": "deposit",
      "docs": [
        "Player deposits stake into the match vault"
      ],
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
          "name": "player",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "settleMatch",
      "docs": [
        "Settles the match and distributes funds"
      ],
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
          "name": "resultsAttestor",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "player1",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "player2",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "feeWallet",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "result",
          "type": {
            "defined": "MatchResult"
          }
        }
      ]
    },
    {
      "name": "refundTimeout",
      "docs": [
        "Refunds players if deadline has passed"
      ],
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
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "player2",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "feeWallet",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "Match",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player1",
            "type": "publicKey"
          },
          {
            "name": "player2",
            "type": "publicKey"
          },
          {
            "name": "stakeLamports",
            "type": "u64"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "deadlineSlot",
            "type": "u64"
          },
          {
            "name": "feeWallet",
            "type": "publicKey"
          },
          {
            "name": "resultsAttestor",
            "type": "publicKey"
          },
          {
            "name": "vault",
            "type": "publicKey"
          },
          {
            "name": "status",
            "type": {
              "defined": "MatchStatus"
            }
          },
          {
            "name": "result",
            "type": {
              "option": {
                "defined": "MatchResult"
              }
            }
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "settledAt",
            "type": {
              "option": "i64"
            }
          }
        ]
      }
    },
    {
      "name": "Vault",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "matchAccount",
            "type": "publicKey"
          },
          {
            "name": "balance",
            "type": "u64"
          },
          {
            "name": "player1Deposited",
            "type": "bool"
          },
          {
            "name": "player2Deposited",
            "type": "bool"
          }
        ]
      }
    }
  ],
  "types": [
    {
      "name": "MatchStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Active"
          },
          {
            "name": "Settled"
          },
          {
            "name": "Refunded"
          }
        ]
      }
    },
    {
      "name": "MatchResult",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Player1"
          },
          {
            "name": "Player2"
          },
          {
            "name": "WinnerTie"
          },
          {
            "name": "LosingTie"
          },
          {
            "name": "Timeout"
          },
          {
            "name": "Error"
          }
        ]
      }
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "InvalidMatchStatus",
      "msg": "Invalid match status"
    },
    {
      "code": 6001,
      "name": "MatchAlreadyFull",
      "msg": "Match is already full"
    },
    {
      "code": 6002,
      "name": "NotMatchParticipant",
      "msg": "Not a match participant"
    },
    {
      "code": 6003,
      "name": "IncorrectEntryFee",
      "msg": "Incorrect entry fee amount"
    }
  ]
};