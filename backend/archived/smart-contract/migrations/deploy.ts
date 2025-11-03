import * as anchor from "@coral-xyz/anchor";

module.exports = async function (provider) {
  // Configure client to use the provider.
  anchor.setProvider(provider);

  // Add your deploy script here.
  console.log("Deploying Guess5 Escrow smart contract...");
};





