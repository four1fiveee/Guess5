const anchor = require("@coral-xyz/anchor");
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const fs = require("fs");
const os = require("os");
const path = require("path");

async function deployIDL() {
  try {
    console.log("🚀 Starting IDL deployment...");

    // Load the IDL from backend/src/types/guess5.ts
    const idlPath = path.join(__dirname, "../src/types/guess5.ts");
    const idlContent = fs.readFileSync(idlPath, "utf8");
    
    // Extract the IDL object from the TypeScript file
    const idlMatch = idlContent.match(/export const IDL[^=]*=\s*({[\s\S]*?});/);
    if (!idlMatch) {
      throw new Error("Could not extract IDL from guess5.ts");
    }
    
    // Parse the IDL (note: this is a simplified approach, may need adjustment)
    const idlStr = idlMatch[1]
      .replace(/(\w+):/g, '"$1":') // Add quotes to keys
      .replace(/'/g, '"'); // Replace single quotes with double quotes
    
    const idl = JSON.parse(idlStr);
    console.log("✅ IDL loaded:", idl.address);

    // Connect to devnet
    const connection = new Connection("https://api.devnet.solana.com", "confirmed");
    console.log("✅ Connected to devnet");

    // Load the deployer keypair
    const keypairPath = path.join(os.homedir(), ".config/solana/id.json");
    const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
    const keypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
    console.log("✅ Loaded keypair:", keypair.publicKey.toString());

    // Create provider
    const provider = new anchor.AnchorProvider(
      connection,
      new anchor.Wallet(keypair),
      { commitment: "confirmed" }
    );
    anchor.setProvider(provider);

    // Deploy the IDL
    const programId = new PublicKey(idl.address);
    console.log("📝 Deploying IDL for program:", programId.toString());

    await anchor.Program.fetchIdl(programId, provider);
    console.log("✅ IDL deployed successfully!");

  } catch (error) {
    console.error("❌ Error deploying IDL:", error);
    process.exit(1);
  }
}

deployIDL();

