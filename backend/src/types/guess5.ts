export const IDL = {
  "version": "0.1.0",
  "name": "guess5_escrow",
  "address": "HyejroGJD3TDPHzmCmtUSnsViENuPn6vHDPZZHw35fGC",
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
    },
    {
      "name": "refundPartialDeposit",
      "docs": [
        "Refunds a single player if they deposited but the other player didn't"
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
            "name": "Deposited"
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
    },
    {
      "name": "result",
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
      "name": "FeeTooHigh",
      "msg": "Fee is too high (max 5%)"
    },
    {
      "code": 6001,
      "name": "StakeTooLow",
      "msg": "Stake amount is too low (min 0.001 SOL)"
    },
    {
      "code": 6002,
      "name": "InvalidDeadline",
      "msg": "Invalid deadline"
    },
    {
      "code": 6003,
      "name": "MatchNotActive",
      "msg": "Match is not active"
    },
    {
      "code": 6004,
      "name": "DeadlinePassed",
      "msg": "Deadline has passed"
    },
    {
      "code": 6005,
      "name": "InvalidPlayer",
      "msg": "Invalid player"
    },
    {
      "code": 6006,
      "name": "AlreadyDeposited",
      "msg": "Player has already deposited"
    },
    {
      "code": 6007,
      "name": "NotAllDeposited",
      "msg": "Not all players have deposited"
    },
    {
      "code": 6008,
      "name": "UnauthorizedAttestor",
      "msg": "Unauthorized results attestor"
    },
    {
      "code": 6009,
      "name": "DeadlineNotPassed",
      "msg": "Deadline has not passed yet"
    },
    {
      "code": 6010,
      "name": "InvalidPartialDeposit",
      "msg": "Invalid partial deposit state"
    }
  ]
} as const;