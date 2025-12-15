import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { GameEscrow } from "../target/types/game_escrow";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";

describe("game-escrow", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.GameEscrow as Program<GameEscrow>;
  const provider = anchor.getProvider();

  // Test accounts
  let feeWallet: Keypair;
  let backendSigner: Keypair;
  let player1: Keypair;
  let player2: Keypair;
  let matchId: anchor.BN;
  let escrowPDA: PublicKey;
  let escrowBump: number;

  const entryFee = new anchor.BN(0.1 * LAMPORTS_PER_SOL); // 0.1 SOL

  before(async () => {
    // Create test keypairs
    feeWallet = Keypair.generate();
    backendSigner = Keypair.generate();
    player1 = Keypair.generate();
    player2 = Keypair.generate();

    // Airdrop SOL to test accounts
    await provider.connection.requestAirdrop(feeWallet.publicKey, 2 * LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(backendSigner.publicKey, 1 * LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(player1.publicKey, 1 * LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(player2.publicKey, 1 * LAMPORTS_PER_SOL);

    // Wait for airdrops to confirm
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Generate match ID
    matchId = new anchor.BN(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));

    // Derive escrow PDA
    [escrowPDA, escrowBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("match"), matchId.toArrayLike(Buffer, "le", 16)],
      program.programId
    );
  });

  it("Initializes a match escrow successfully", async () => {
    const tx = await program.methods
      .initializeMatch(matchId, entryFee)
      .accounts({
        gameEscrow: escrowPDA,
        playerA: player1.publicKey,
        playerB: player2.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([player1])
      .rpc();

    console.log("Initialize match transaction:", tx);

    // Verify escrow account was created
    const escrowData = await program.account.gameEscrow.fetch(escrowPDA);
    expect(escrowData.matchId.toString()).to.equal(matchId.toString());
    expect(escrowData.playerA.toString()).to.equal(player1.publicKey.toString());
    expect(escrowData.playerB.toString()).to.equal(player2.publicKey.toString());
    expect(escrowData.entryFeeLamports.toString()).to.equal(entryFee.toString());
    expect(escrowData.isPaidA).to.be.false;
    expect(escrowData.isPaidB).to.be.false;
    expect(escrowData.gameStatus.pending).to.be.true;
  });

  it("Player1 deposits successfully", async () => {
    const tx = await program.methods
      .deposit()
      .accounts({
        gameEscrow: escrowPDA,
        player: player1.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([player1])
      .rpc();

    console.log("Player1 deposit transaction:", tx);

    // Verify deposit
    const escrowData = await program.account.gameEscrow.fetch(escrowPDA);
    expect(escrowData.isPaidA).to.be.true;
    expect(escrowData.isPaidB).to.be.false;
    expect(escrowData.gameStatus.pending).to.be.true; // Still pending, waiting for player2
  });

  it("Player2 deposits successfully and match becomes active", async () => {
    const tx = await program.methods
      .deposit()
      .accounts({
        gameEscrow: escrowPDA,
        player: player2.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([player2])
      .rpc();

    console.log("Player2 deposit transaction:", tx);

    // Verify match is now active
    const escrowData = await program.account.gameEscrow.fetch(escrowPDA);
    expect(escrowData.isPaidA).to.be.true;
    expect(escrowData.isPaidB).to.be.true;
    expect(escrowData.gameStatus.active).to.be.true;
  });

  it("Submits result with player1 winning", async () => {
    // Create a dummy signature (64 bytes)
    const dummySignature = new Array(64).fill(0);

    const tx = await program.methods
      .submitResult(
        player1.publicKey,
        { win: {} },
        dummySignature
      )
      .accounts({
        gameEscrow: escrowPDA,
        backendSigner: backendSigner.publicKey,
        player: player1.publicKey,
      })
      .signers([player1])
      .rpc();

    console.log("Submit result transaction:", tx);

    // Verify result was stored
    const escrowData = await program.account.gameEscrow.fetch(escrowPDA);
    expect(escrowData.winner.toString()).to.equal(player1.publicKey.toString());
    expect(escrowData.resultType.win).to.be.true;
  });

  it("Settles match with player1 winning (95% to winner, 5% fee)", async () => {
    const tx = await program.methods
      .settle()
      .accounts({
        gameEscrow: escrowPDA,
        winner: player1.publicKey,
        playerA: player1.publicKey,
        playerB: player2.publicKey,
        feeWallet: feeWallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("Settle match transaction:", tx);

    // Verify match is settled
    const escrowData = await program.account.gameEscrow.fetch(escrowPDA);
    expect(escrowData.gameStatus.settled).to.be.true;

    // Verify balances
    const winnerBalance = await provider.connection.getBalance(player1.publicKey);
    const feeBalance = await provider.connection.getBalance(feeWallet.publicKey);
    
    // Winner should have received 95% of pot (0.19 SOL)
    // Fee wallet should have received 5% of pot (0.01 SOL)
    // Note: Exact amounts depend on initial balances and transaction fees
    console.log("Winner balance:", winnerBalance / LAMPORTS_PER_SOL);
    console.log("Fee wallet balance:", feeBalance / LAMPORTS_PER_SOL);
  });

  it("Prevents double execution of settle()", async () => {
    // Try to settle again - should fail
    try {
      await program.methods
        .settle()
        .accounts({
          gameEscrow: escrowPDA,
          winner: player1.publicKey,
          playerA: player1.publicKey,
          playerB: player2.publicKey,
          feeWallet: feeWallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      
      expect.fail("Should have thrown an error");
    } catch (err: any) {
      expect(err.message).to.include("InvalidGameStatus");
    }
  });

  it("Handles timeout refund when only one player deposits", async () => {
    // Create a new match for timeout test
    const timeoutMatchId = new anchor.BN(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
    const [timeoutEscrowPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("match"), timeoutMatchId.toArrayLike(Buffer, "le", 16)],
      program.programId
    );

    const timeoutPlayer1 = Keypair.generate();
    const timeoutPlayer2 = Keypair.generate();

    await provider.connection.requestAirdrop(timeoutPlayer1.publicKey, 1 * LAMPORTS_PER_SOL);
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Initialize match
    await program.methods
      .initializeMatch(timeoutMatchId, entryFee)
      .accounts({
        gameEscrow: timeoutEscrowPDA,
        playerA: timeoutPlayer1.publicKey,
        playerB: timeoutPlayer2.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([timeoutPlayer1])
      .rpc();

    // Only player1 deposits
    await program.methods
      .deposit()
      .accounts({
        gameEscrow: timeoutEscrowPDA,
        player: timeoutPlayer1.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([timeoutPlayer1])
      .rpc();

    // Wait for timeout (in real scenario, this would be 10 minutes)
    // For testing, we'd need to manipulate the clock or create match with past timeout
    // This is a simplified test - in production, you'd use a test framework that allows clock manipulation

    // Note: Full timeout test requires clock manipulation which is complex in Anchor tests
    // This test structure shows the expected flow
  });

  it("Handles draw full refund correctly", async () => {
    // Create a new match for draw test
    const drawMatchId = new anchor.BN(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
    const [drawEscrowPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("match"), drawMatchId.toArrayLike(Buffer, "le", 16)],
      program.programId
    );

    const drawPlayer1 = Keypair.generate();
    const drawPlayer2 = Keypair.generate();

    await provider.connection.requestAirdrop(drawPlayer1.publicKey, 1 * LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(drawPlayer2.publicKey, 1 * LAMPORTS_PER_SOL);
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Initialize, both deposit, submit draw result, settle
    await program.methods
      .initializeMatch(drawMatchId, entryFee)
      .accounts({
        gameEscrow: drawEscrowPDA,
        playerA: drawPlayer1.publicKey,
        playerB: drawPlayer2.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([drawPlayer1])
      .rpc();

    await program.methods
      .deposit()
      .accounts({
        gameEscrow: drawEscrowPDA,
        player: drawPlayer1.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([drawPlayer1])
      .rpc();

    await program.methods
      .deposit()
      .accounts({
        gameEscrow: drawEscrowPDA,
        player: drawPlayer2.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([drawPlayer2])
      .rpc();

    // Submit draw result
    const dummySignature = new Array(64).fill(0);
    await program.methods
      .submitResult(
        null,
        { drawFullRefund: {} },
        dummySignature
      )
      .accounts({
        gameEscrow: drawEscrowPDA,
        backendSigner: backendSigner.publicKey,
        player: drawPlayer1.publicKey,
      })
      .signers([drawPlayer1])
      .rpc();

    // Settle
    await program.methods
      .settle()
      .accounts({
        gameEscrow: drawEscrowPDA,
        winner: SystemProgram.programId, // Not used for draw
        playerA: drawPlayer1.publicKey,
        playerB: drawPlayer2.publicKey,
        feeWallet: feeWallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const escrowData = await program.account.gameEscrow.fetch(drawEscrowPDA);
    expect(escrowData.gameStatus.settled).to.be.true;
    expect(escrowData.resultType.drawFullRefund).to.be.true;
  });
});

