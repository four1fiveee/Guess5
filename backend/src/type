export type Guess5 = {
  "version": "0.1.0",
  "name": "guess5",
  "instructions": [
    {
      "name": "initGame",
      "accounts": [
        {
          "name": "game",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "payer",
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
        }
      ]
    },
    {
      "name": "submitResult",
      "accounts": [
        {
          "name": "game",
          "isMut": true,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "player",
          "type": "publicKey"
        },
        {
          "name": "solved",
          "type": "bool"
        },
        {
          "name": "numGuesses",
          "type": "u8"
        },
        {
          "name": "totalTime",
          "type": "u16"
        }
      ]
    },
    {
      "name": "payout",
      "accounts": [
        {
          "name": "game",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "player1",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "player2",
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
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "game",
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
            "name": "entryFee",
            "type": "u64"
          },
          {
            "name": "status",
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
            "name": "player1Guesses",
            "type": "u8"
          },
          {
            "name": "player2Guesses",
            "type": "u8"
          },
          {
            "name": "player1Time",
            "type": "u16"
          },
          {
            "name": "player2Time",
            "type": "u16"
          }
        ]
      }
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "InvalidFeeWallet",
      "msg": "Invalid fee wallet address."
    }
  ]
};

export const IDL: Guess5 = {
  "version": "0.1.0",
  "name": "guess5",
  "instructions": [
    {
      "name": "initGame",
      "accounts": [
        {
          "name": "game",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "payer",
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
        }
      ]
    },
    {
      "name": "submitResult",
      "accounts": [
        {
          "name": "game",
          "isMut": true,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "player",
          "type": "publicKey"
        },
        {
          "name": "solved",
          "type": "bool"
        },
        {
          "name": "numGuesses",
          "type": "u8"
        },
        {
          "name": "totalTime",
          "type": "u16"
        }
      ]
    },
    {
      "name": "payout",
      "accounts": [
        {
          "name": "game",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "player1",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "player2",
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
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "game",
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
            "name": "entryFee",
            "type": "u64"
          },
          {
            "name": "status",
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
            "name": "player1Guesses",
            "type": "u8"
          },
          {
            "name": "player2Guesses",
            "type": "u8"
          },
          {
            "name": "player1Time",
            "type": "u16"
          },
          {
            "name": "player2Time",
            "type": "u16"
          }
        ]
      }
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "InvalidFeeWallet",
      "msg": "Invalid fee wallet address."
    }
  ]
};
