import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Guess5Escrow } from "../target/types/guess5_escrow";

describe("guess5-escrow", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.guess5Escrow as Program<Guess5Escrow>;

  it("Creates a match!", async () => {
    // Add your test here.
    const player1 = anchor.web3.Keypair.generate();
    const player2 = anchor.web3.Keypair.generate();
    const stakeAmount = new anchor.BN(1000000); // 0.001 SOL
    const feeBps = 500; // 5%
    const deadlineSlot = new anchor.BN(1000000);
    
    const tx = await program.methods
      .createMatch(stakeAmount, feeBps, deadlineSlot)
      .accounts({
        matchAccount: anchor.web3.Keypair.generate().publicKey,
        vault: anchor.web3.Keypair.generate().publicKey,
        player1: player1.publicKey,
        player2: player2.publicKey,
        resultsAttestor: anchor.web3.Keypair.generate().publicKey,
        feeWallet: anchor.web3.Keypair.generate(),
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    console.log("Your transaction signature", tx);
  });
});
