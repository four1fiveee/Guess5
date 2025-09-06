export const IDL = {
  "version": "0.1.0",
  "name": "guess5_escrow",
  "address": "HyejroGJD3TDPHzmCmtUSnsViENuPn6vHDPZZHw35fGC",
  "instructions": [
    {
      "name": "initializeMatch",
      "docs": [
        "Initialize a new match escrow"
      ],
      "accounts": [
        {
          "name": "matchEscrow",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "player1",
          "isMut": true,
          "isSigner": true
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
          "name": "matchId",
          "type": "string"
        },
        {
          "name": "entryFee",
          "type": "u64"
        }
      ]
    },
    {
      "name": "joinMatch",
      "docs": [
        "Join an existing match (second player)"
      ],
      "accounts": [
        {
          "name": "matchEscrow",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "player2",
          "isMut": false,
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
          "name": "player2EntryFee",
          "type": "u64"
        }
      ]
    },
    {
      "name": "lockEntryFee",
      "docs": [
        "Lock entry fee in escrow (called by each player)"
      ],
      "accounts": [
        {
          "name": "matchEscrow",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "player",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "vaultAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "vaultAccount",
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
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "submitResult",
      "docs": [
        "Submit game result (called by each player)"
      ],
      "accounts": [
        {
          "name": "matchEscrow",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "player",
          "isMut": false,
          "isSigner": true
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
          "name": "vaultAccount",
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
            "defined": "GameResult"
          }
        },
        {
          "name": "attempts",
          "type": "u8"
        },
        {
          "name": "solved",
          "type": "bool"
        }
      ]
    },
    {
      "name": "refundPlayers",
      "docs": [
        "Refund both players (for ties or timeouts)"
      ],
      "accounts": [
        {
          "name": "matchEscrow",
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
          "name": "vaultAccount",
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
      "name": "MatchEscrow",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "matchId",
            "type": "string"
          },
          {
            "name": "player1",
            "type": "publicKey"
          },
          {
            "name": "player2",
            "type": "publicKey"
          },
          {
            "name": "entryFee",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": "MatchStatus"
            }
          },
          {
            "name": "player1Locked",
            "type": "bool"
          },
          {
            "name": "player2Locked",
            "type": "bool"
          },
          {
            "name": "player1Result",
            "type": {
              "defined": "GameResult"
            }
          },
          {
            "name": "player2Result",
            "type": {
              "defined": "GameResult"
            }
          },
          {
            "name": "player1Attempts",
            "type": "u8"
          },
          {
            "name": "player2Attempts",
            "type": "u8"
          },
          {
            "name": "player1Solved",
            "type": "bool"
          },
          {
            "name": "player2Solved",
            "type": "bool"
          },
          {
            "name": "winner",
            "type": {
              "option": "publicKey"
            }
          },
          {
            "name": "feeWallet",
            "type": "publicKey"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "gameStartTime",
            "type": "i64"
          },
          {
            "name": "completedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "LockAccount",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "buyer",
            "type": "publicKey"
          },
          {
            "name": "amount",
            "type": "u64"
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
            "name": "Waiting"
          },
          {
            "name": "Escrow"
          },
          {
            "name": "Active"
          },
          {
            "name": "Completed"
          },
          {
            "name": "Refunded"
          }
        ]
      }
    },
    {
      "name": "GameResult",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "NotSubmitted"
          },
          {
            "name": "Win"
          },
          {
            "name": "Lose"
          },
          {
            "name": "Tie"
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