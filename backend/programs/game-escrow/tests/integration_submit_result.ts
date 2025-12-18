import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { GameEscrow } from "../target/types/game_escrow";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Ed25519Program,
} from "@solana/web3.js";
import nacl from "tweetnacl";
import { expect } from "chai";

describe("game-escrow submit_result + settle integration", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.GameEscrow as Program<GameEscrow>;

  // Test accounts
  const backendKeypair = nacl.sign.keyPair(); // Ed25519 keypair for backend signer
  let backendPubkey: PublicKey;
  let feeWallet: Keypair;
  let playerA: Keypair;
  let playerB: Keypair;
  let matchId: anchor.BN;
  let escrowPda: PublicKey;

  const entryFeeLamports = new anchor.BN(0.1 * LAMPORTS_PER_SOL); // 0.1 SOL

  before(async () => {
    backendPubkey = new PublicKey(backendKeypair.publicKey);
    feeWallet = Keypair.generate();
    playerA = Keypair.generate();
    playerB = Keypair.generate();

    // Fund test accounts
    for (const kp of [feeWallet, playerA, playerB]) {
      const sig = await provider.connection.requestAirdrop(
        kp.publicKey,
        2 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig, "confirmed");
    }

    // Unique match id as u128-compatible BN (use timestamp, safely < 2^53)
    matchId = new anchor.BN(Date.now());

    // Derive PDA with same seeds as program: ["match", match_id (u128 LE)]
    [escrowPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("match"), matchId.toArrayLike(Buffer, "le", 16)],
      program.programId
    );

    // Initialize match
    await program.methods
      .initializeMatch(matchId, entryFeeLamports)
      .accounts({
        gameEscrow: escrowPda,
        playerA: playerA.publicKey,
        playerB: playerB.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([playerA])
      .rpc();

    // Player A deposit
    await program.methods
      .deposit()
      .accounts({
        gameEscrow: escrowPda,
        player: playerA.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([playerA])
      .rpc();

    // Player B deposit
    await program.methods
      .deposit()
      .accounts({
        gameEscrow: escrowPda,
        player: playerB.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([playerB])
      .rpc();
  });

  it("submits a backend-signed result and settles correctly", async () => {
    // Build MatchResult message exactly as on-chain (u128, [u8;32], u8)
    const winnerBytes = playerA.publicKey.toBytes();
    const resultType = 1; // 1 = Win

    const buf = Buffer.alloc(16 + 32 + 1);
    let offset = 0;

    // match_id as u128 LE (16 bytes) from BN
    const matchIdBytes = matchId.toArrayLike(Buffer, "le", 16);
    matchIdBytes.copy(buf, offset);
    offset += 16;

    // winner_pubkey [u8; 32]
    Buffer.from(winnerBytes).copy(buf, offset);
    offset += 32;

    // result_type u8
    buf.writeUInt8(resultType, offset);

    const message = new Uint8Array(buf);

    // Sign with backend Ed25519 keypair
    const signature = nacl.sign.detached(message, backendKeypair.secretKey);

    // Ed25519 precompile instruction (must appear before submit_result)
    const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
      publicKey: backendPubkey.toBytes(),
      message,
      signature,
    });

    // Call submit_result with MatchResult struct + signature
    const txSig = await program.methods
      .submitResult(
        {
          matchId,
          winnerPubkey: Array.from(winnerBytes),
          resultType,
        } as any,
        Array.from(signature)
      )
      .accounts({
        gameEscrow: escrowPda,
        backendSigner: backendPubkey,
        player: playerA.publicKey,
        instructionsSysvar: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .preInstructions([ed25519Ix])
      .signers([playerA])
      .rpc();

    console.log("✅ submit_result tx:", txSig);

    // Settle the match
    const settleSig = await program.methods
      .settle()
      .accounts({
        gameEscrow: escrowPda,
        winner: playerA.publicKey,
        playerA: playerA.publicKey,
        playerB: playerB.publicKey,
        feeWallet: feeWallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([playerA])
      .rpc();

    console.log("✅ settle tx:", settleSig);

    // Verify on-chain state
    const escrowData = await program.account.gameEscrow.fetch(escrowPda);
    expect(escrowData.gameStatus.settled).to.be.true;
    expect(escrowData.winner!.toString()).to.equal(
      playerA.publicKey.toString()
    );
    expect(escrowData.resultType.win).to.be.true;
  });
});


