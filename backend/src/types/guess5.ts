export const IDL = {
  "address": "ASLA3yCccjSoMAxoYBciM5vqdCZKcedd2QkbVWtjQEL4",
  "metadata": {
    "name": "guess5_escrow",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Non-custodial escrow system for Guess5 game"
  },
  "types": [
    {
      "name": "DepositMade",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "match_account",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "is_player1",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "Match",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player1",
            "type": "pubkey"
          },
          {
            "name": "player2",
            "type": "pubkey"
          },
          {
            "name": "stake_lamports",
            "type": "u64"
          },
          {
            "name": "fee_bps",
            "type": "u16"
          },
          {
            "name": "deadline_slot",
            "type": "u64"
          },
          {
            "name": "fee_wallet",
            "type": "pubkey"
          },
          {
            "name": "results_attestor",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "MatchStatus"
              }
            }
          },
          {
            "name": "result",
            "type": {
              "option": {
                "defined": {
                  "name": "MatchResult"
                }
              }
            }
          },
          {
            "name": "created_at",
            "type": "i64"
          },
          {
            "name": "settled_at",
            "type": {
              "option": "i64"
            }
          }
        ]
      }
    },
    {
      "name": "MatchCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "match_account",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "player1",
            "type": "pubkey"
          },
          {
            "name": "player2",
            "type": "pubkey"
          },
          {
            "name": "stake_lamports",
            "type": "u64"
          },
          {
            "name": "fee_bps",
            "type": "u16"
          },
          {
            "name": "deadline_slot",
            "type": "u64"
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
      "name": "MatchSettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "match_account",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "result",
            "type": {
              "defined": {
                "name": "MatchResult"
              }
            }
          },
          {
            "name": "winner_amount",
            "type": "u64"
          },
          {
            "name": "fee_amount",
            "type": "u64"
          }
        ]
      }
    },
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
            "name": "match_account",
            "type": "pubkey"
          },
          {
            "name": "balance",
            "type": "u64"
          },
          {
            "name": "player1_deposited",
            "type": "bool"
          },
          {
            "name": "player2_deposited",
            "type": "bool"
          }
        ]
      }
    }
  ],
  "instructions": [
    {
      "name": "create_match",
      "docs": [
        "Creates a new match with escrow vault",
        "Players will deposit directly into the vault PDA"
      ],
      "discriminator": [
        107,
        2,
        184,
        145,
        70,
        142,
        17,
        165
      ],
      "accounts": [
        {
          "name": "match_account",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  116,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "player1"
              },
              {
                "kind": "account",
                "path": "player2"
              },
              {
                "kind": "arg",
                "path": "stake_lamports"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "match_account"
              }
            ]
          }
        },
        {
          "name": "player1"
        },
        {
          "name": "player2"
        },
        {
          "name": "results_attestor"
        },
        {
          "name": "fee_wallet",
          "writable": true,
          "signer": true
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "stake_lamports",
          "type": "u64"
        },
        {
          "name": "fee_bps",
          "type": "u16"
        },
        {
          "name": "deadline_slot",
          "type": "u64"
        }
      ]
    },
    {
      "name": "deposit",
      "docs": [
        "Player deposits stake into the match vault",
        "This is called by each player individually"
      ],
      "discriminator": [
        242,
        35,
        198,
        137,
        82,
        225,
        242,
        182
      ],
      "accounts": [
        {
          "name": "match_account",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "match_account"
              }
            ]
          }
        },
        {
          "name": "player",
          "writable": true,
          "signer": true
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "refund_timeout",
      "docs": [
        "Refunds players if deadline has passed",
        "Anyone can call this to trigger automatic refunds"
      ],
      "discriminator": [
        142,
        147,
        135,
        70,
        231,
        198,
        23,
        207
      ],
      "accounts": [
        {
          "name": "match_account",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "match_account"
              }
            ]
          }
        },
        {
          "name": "player1",
          "writable": true
        },
        {
          "name": "player2",
          "writable": true
        },
        {
          "name": "fee_wallet",
          "writable": true
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "settle_match",
      "docs": [
        "Settles the match and distributes funds",
        "Only callable by the results attestor"
      ],
      "discriminator": [
        71,
        124,
        117,
        96,
        191,
        217,
        116,
        24
      ],
      "accounts": [
        {
          "name": "match_account",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "match_account"
              }
            ]
          }
        },
        {
          "name": "results_attestor"
        },
        {
          "name": "player1",
          "writable": true
        },
        {
          "name": "player2",
          "writable": true
        },
        {
          "name": "fee_wallet",
          "writable": true
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "result",
          "type": {
            "defined": {
              "name": "MatchResult"
            }
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "Match",
      "discriminator": [
        236,
        63,
        169,
        38,
        15,
        56,
        196,
        162
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player1",
            "type": "pubkey"
          },
          {
            "name": "player2",
            "type": "pubkey"
          },
          {
            "name": "stake_lamports",
            "type": "u64"
          },
          {
            "name": "fee_bps",
            "type": "u16"
          },
          {
            "name": "deadline_slot",
            "type": "u64"
          },
          {
            "name": "fee_wallet",
            "type": "pubkey"
          },
          {
            "name": "results_attestor",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "MatchStatus"
              }
            }
          },
          {
            "name": "result",
            "type": {
              "option": {
                "defined": {
                  "name": "MatchResult"
                }
              }
            }
          },
          {
            "name": "created_at",
            "type": "i64"
          },
          {
            "name": "settled_at",
            "type": {
              "option": "i64"
            }
          }
        ]
      }
    },
    {
      "name": "Vault",
      "discriminator": [
        211,
        8,
        232,
        43,
        2,
        152,
        117,
        119
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "match_account",
            "type": "pubkey"
          },
          {
            "name": "balance",
            "type": "u64"
          },
          {
            "name": "player1_deposited",
            "type": "bool"
          },
          {
            "name": "player2_deposited",
            "type": "bool"
          }
        ]
      }
    }
  ],
  "events": [
    {
      "name": "DepositMade",
      "discriminator": [
        210,
        201,
        130,
        183,
        244,
        203,
        155,
        199
      ]
    },
    {
      "name": "MatchCreated",
      "discriminator": [
        151,
        176,
        11,
        24,
        34,
        225,
        227,
        16
      ]
    },
    {
      "name": "MatchSettled",
      "discriminator": [
        243,
        201,
        134,
        151,
        193,
        131,
        223,
        150
      ]
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
    }
  ]
} as const;

export type Guess5Escrow = typeof IDL;