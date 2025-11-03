export const IDL = {
  "version": "0.1.0",
  "name": "guess5_escrow",
  "instructions": [
    {
      "name": "createMatch",
      "accounts": [
        { "name": "matchAccount", "isMut": true, "isSigner": false },
        { "name": "vault", "isMut": true, "isSigner": false },
        { "name": "player1", "isMut": false, "isSigner": false },
        { "name": "player2", "isMut": false, "isSigner": false },
        { "name": "feeWallet", "isMut": true, "isSigner": true },
        { "name": "systemProgram", "isMut": false, "isSigner": false }
      ],
      "args": [
        { "name": "stakeAmount", "type": "u64" },
        { "name": "feeBps", "type": "u16" },
        { "name": "deadlineSlot", "type": "u64" }
      ]
    }
  ],
  "accounts": [],
  "types": [],
  "errors": []
};
