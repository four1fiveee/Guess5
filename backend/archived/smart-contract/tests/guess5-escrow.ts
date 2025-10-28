import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Guess5Escrow } from "../target/types/guess5_escrow";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";

describe("guess5-escrow", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.Guess5Escrow as Program<Guess5Escrow>;
  const provider = anchor.getProvider();

  // Test accounts
  let feeWallet: Keypair;
  let resultsAttestor: Keypair;
  let player1: Keypair;
  let player2: Keypair;
  let matchAccount: PublicKey;
  let vaultAccount: PublicKey;

  const stakeAmount = new anchor.BN(0.1 * LAMPORTS_PER_SOL); // 0.1 SOL
  const feeBps = 500; // 5%
  const deadlineSlot = new anchor.BN(provider.connection.getSlot() + 1000); // 1000 slots from now

  before(async () => {
    // Create test keypairs
    feeWallet = Keypair.generate();
    resultsAttestor = Keypair.generate();
    player1 = Keypair.generate();
    player2 = Keypair.generate();

    // Airdrop SOL to test accounts
    await provider.connection.requestAirdrop(feeWallet.publicKey, 2 * LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(player1.publicKey, 1 * LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(player2.publicKey, 1 * LAMPORTS_PER_SOL);

    // Wait for airdrops to confirm
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Derive PDAs
    [matchAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("match"),
        player1.publicKey.toBuffer(),
        player2.publicKey.toBuffer(),
        stakeAmount.toArrayLike(Buffer, "le", 8)
      ],
      program.programId
    );

    [vaultAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), matchAccount.toBuffer()],
      program.programId
    );
  });

  it("Creates a match successfully", async () => {
    const tx = await program.methods
      .createMatch(stakeAmount, feeBps, deadlineSlot)
      .accounts({
        matchAccount,
        vault: vaultAccount,
        player1: player1.publicKey,
        player2: player2.publicKey,
        feeWallet: feeWallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([feeWallet])
      .rpc();

    console.log("Create match transaction:", tx);

    // Verify match account was created
    const matchData = await program.account.matchAccount.fetch(matchAccount);
    expect(matchData.player1.toString()).to.equal(player1.publicKey.toString());
    expect(matchData.player2.toString()).to.equal(player2.publicKey.toString());
    expect(matchData.stakeAmount.toString()).to.equal(stakeAmount.toString());
    expect(matchData.feeBps).to.equal(feeBps);
    expect(matchData.status.created).to.be.true;
  });

  it("Player1 deposits successfully", async () => {
    const tx = await program.methods
      .deposit(stakeAmount)
      .accounts({
        matchAccount,
        vault: vaultAccount,
        player: player1.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([player1])
      .rpc();

    console.log("Player1 deposit transaction:", tx);

    // Verify deposit
    const matchData = await program.account.matchAccount.fetch(matchAccount);
    expect(matchData.player1Deposited.toString()).to.equal(stakeAmount.toString());
    expect(matchData.status.created).to.be.true; // Still created, waiting for player2
  });

  it("Player2 deposits successfully and match becomes active", async () => {
    const tx = await program.methods
      .deposit(stakeAmount)
      .accounts({
        matchAccount,
        vault: vaultAccount,
        player: player2.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([player2])
      .rpc();

    console.log("Player2 deposit transaction:", tx);

    // Verify match is now active
    const matchData = await program.account.matchAccount.fetch(matchAccount);
    expect(matchData.player1Deposited.toString()).to.equal(stakeAmount.toString());
    expect(matchData.player2Deposited.toString()).to.equal(stakeAmount.toString());
    expect(matchData.status.active).to.be.true;
  });

  it("Settles match with Player1 winning", async () => {
    const tx = await program.methods
      .settleMatch({ player1: {} })
      .accounts({
        matchAccount,
        vault: vaultAccount,
        player1: player1.publicKey,
        player2: player2.publicKey,
        feeWallet: feeWallet.publicKey,
        resultsAttestor: resultsAttestor.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([resultsAttestor])
      .rpc();

    console.log("Settle match transaction:", tx);

    // Verify match is settled
    const matchData = await program.account.matchAccount.fetch(matchAccount);
    expect(matchData.status.settled).to.be.true;
    expect(matchData.result.player1).to.be.true;
  });

  it("Handles timeout refund correctly", async () => {
    // Create a new match that will timeout
    const timeoutMatchKeypair = Keypair.generate();
    const timeoutPlayer1 = Keypair.generate();
    const timeoutPlayer2 = Keypair.generate();
    
    // Airdrop SOL to timeout test accounts
    await provider.connection.requestAirdrop(timeoutPlayer1.publicKey, 1 * LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(timeoutPlayer2.publicKey, 1 * LAMPORTS_PER_SOL);
    await new Promise(resolve => setTimeout(resolve, 2000));

    const [timeoutMatchAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("match"),
        timeoutPlayer1.publicKey.toBuffer(),
        timeoutPlayer2.publicKey.toBuffer(),
        stakeAmount.toArrayLike(Buffer, "le", 8)
      ],
      program.programId
    );

    const [timeoutVaultAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), timeoutMatchAccount.toBuffer()],
      program.programId
    );

    // Create match with past deadline
    const pastDeadline = new anchor.BN(provider.connection.getSlot() - 100);
    
    await program.methods
      .createMatch(stakeAmount, feeBps, pastDeadline)
      .accounts({
        matchAccount: timeoutMatchAccount,
        vault: timeoutVaultAccount,
        player1: timeoutPlayer1.publicKey,
        player2: timeoutPlayer2.publicKey,
        feeWallet: feeWallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([feeWallet])
      .rpc();

    // Both players deposit
    await program.methods
      .deposit(stakeAmount)
      .accounts({
        matchAccount: timeoutMatchAccount,
        vault: timeoutVaultAccount,
        player: timeoutPlayer1.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([timeoutPlayer1])
      .rpc();

    await program.methods
      .deposit(stakeAmount)
      .accounts({
        matchAccount: timeoutMatchAccount,
        vault: timeoutVaultAccount,
        player: timeoutPlayer2.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([timeoutPlayer2])
      .rpc();

    // Refund timeout
    const refundTx = await program.methods
      .refundTimeout()
      .accounts({
        matchAccount: timeoutMatchAccount,
        vault: timeoutVaultAccount,
        player1: timeoutPlayer1.publicKey,
        player2: timeoutPlayer2.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("Timeout refund transaction:", refundTx);

    // Verify timeout refund
    const timeoutMatchData = await program.account.matchAccount.fetch(timeoutMatchAccount);
    expect(timeoutMatchData.status.settled).to.be.true;
    expect(timeoutMatchData.result.timeout).to.be.true;
  });
});





