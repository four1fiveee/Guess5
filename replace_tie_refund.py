import sys
import os

# Change to working directory
os.chdir('/tmp/guess5-fix')

with open('backend/src/controllers/matchController.ts', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find losing tie section
start_idx = None
for i, line in enumerate(lines):
    if '// Losing tie - both players get 95% refund' in line:
        start_idx = i
        break

if start_idx is None:
    print('Could not find losing tie section')
    sys.exit(1)

# Find end by counting braces
brace_count = 0
end_idx = None
found_start = False
for i in range(start_idx, min(start_idx + 150, len(lines))):
    line = lines[i]
    if '{' in line:
        found_start = True
        brace_count += line.count('{')
    if '}' in line:
        brace_count -= line.count('}')
        if found_start and brace_count == 0:
            end_idx = i + 1
            break

if end_idx is None:
    print('Could not find end')
    sys.exit(1)

print(f'Replacing lines {start_idx + 1} to {end_idx}')

# Create replacement - using proper escape sequences for shell
replacement_lines = [
            "          // Losing tie - both players get 95% refund via Squads\n",
            "            console.log('🤝 Losing tie - processing 95% refunds to both players via Squads...');\n",
            "            \n",
            "            const entryFee = updatedMatch.entryFee;\n",
            "            const refundAmount = entryFee * 0.95; // 95% refund to each player\n",
            "            \n",
            "            // Check if vault address exists\n",
            "            if (!updatedMatch.squadsVaultAddress) {\n",
            "              console.error('❌ Cannot create tie refund proposal: missing squadsVaultAddress', {\n",
            "                matchId: updatedMatch.id,\n",
            "                player1: updatedMatch.player1,\n",
            "                player2: updatedMatch.player2,\n",
            "              });\n",
            "              throw new Error('Cannot create tie refund: missing squadsVaultAddress');\n",
            "            }\n",
            "            \n",
            "            // Create Squads proposal for tie refund\n",
            "            try {\n",
            "              const refundResult = await squadsVaultService.proposeTieRefund(\n",
            "                updatedMatch.squadsVaultAddress,\n",
            "                new PublicKey(updatedMatch.player1),\n",
            "                new PublicKey(updatedMatch.player2),\n",
            "                refundAmount\n",
            "              );\n",
            "              \n",
            "              if (refundResult.success) {\n",
            "                console.log('✅ Squads tie refund proposal created:', refundResult.proposalId);\n",
            "                \n",
            "                // Update match with proposal information\n",
            "                updatedMatch.payoutProposalId = refundResult.proposalId;\n",
            "                updatedMatch.proposalCreatedAt = new Date();\n",
            "                updatedMatch.proposalStatus = 'ACTIVE';\n",
            "                updatedMatch.needsSignatures = 2; // 2-of-3 multisig\n",
            "                updatedMatch.matchStatus = 'PROPOSAL_CREATED';\n",
            "                \n",
            "                // Save the match with proposal information\n",
            "                await matchRepository.save(updatedMatch);\n",
            "                console.log('✅ Match saved with tie refund proposal:', {\n",
            "                  matchId: updatedMatch.id,\n",
            "                  proposalId: refundResult.proposalId,\n",
            "                  proposalStatus: 'ACTIVE',\n",
            "                  needsSignatures: 2,\n",
            "                });\n",
            "                \n",
            "                // Create payment instructions for display\n",
            "                const paymentInstructions = {\n",
            "                  winner: 'tie',\n",
            "                  player1: updatedMatch.player1,\n",
            "                  player2: updatedMatch.player2,\n",
            "                  refundAmount: refundAmount,\n",
            "                  feeAmount: entryFee * 0.05 * 2,\n",
            "                  feeWallet: FEE_WALLET_ADDRESS,\n",
            "                  squadsProposal: true,\n",
            "                  proposalId: refundResult.proposalId,\n",
            "                  transactions: [\n",
            "                    {\n",
            "                      from: 'Squads Vault',\n",
            "                      to: updatedMatch.player1,\n",
            "                      amount: refundAmount,\n",
            "                      description: 'Losing tie refund (player 1)'\n",
            "                    },\n",
            "                    {\n",
            "                      from: 'Squads Vault',\n",
            "                      to: updatedMatch.player2,\n",
            "                      amount: refundAmount,\n",
            "                      description: 'Losing tie refund (player 2)'\n",
            "                    }\n",
            "                  ]\n",
            "                };\n",
            "                \n",
            "                (payoutResult as any).paymentInstructions = paymentInstructions;\n",
            "                (payoutResult as any).paymentSuccess = true;\n",
            "                \n",
            "              } else {\n",
            "                console.error('❌ Squads tie refund proposal failed:', refundResult.error);\n",
            "                throw new Error(`Squads proposal failed: ${refundResult.error}`);\n",
            "              }\n",
            "              \n",
            "            } catch (error: unknown) {\n",
            "              const errorMessage = error instanceof Error ? error.message : String(error);\n",
            "              console.warn('⚠️ Squads tie refund proposal failed, falling back to manual instructions:', errorMessage);\n",
            "              \n",
            "              // Fallback to manual payment instructions\n",
            "              const paymentInstructions = {\n",
            "                winner: 'tie',\n",
            "                player1: updatedMatch.player1,\n",
            "                player2: updatedMatch.player2,\n",
            "                refundAmount: refundAmount,\n",
            "                feeAmount: entryFee * 0.05 * 2,\n",
            "                feeWallet: FEE_WALLET_ADDRESS,\n",
            "                squadsProposal: false,\n",
            "                transactions: [\n",
            "                  {\n",
            "                    from: 'Squads Vault',\n",
            "                    to: updatedMatch.player1,\n",
            "                    amount: refundAmount,\n",
            "                    description: 'Manual losing tie refund (player 1) - contact support'\n",
            "                  },\n",
            "                  {\n",
            "                    from: 'Squads Vault',\n",
            "                    to: updatedMatch.player2,\n",
            "                    amount: refundAmount,\n",
            "                    description: 'Manual losing tie refund (player 2) - contact support'\n",
            "                  }\n",
            "                ]\n",
            "              };\n",
            "              \n",
            "              (payoutResult as any).paymentInstructions = paymentInstructions;\n",
            "              (payoutResult as any).paymentSuccess = false;\n",
            "              (payoutResult as any).paymentError = 'Squads proposal failed - contact support';\n",
            "              \n",
            "              console.log('⚠️ Manual losing tie refund instructions created');\n",
            "            }\n",
            "          }\n"
]

# Replace
new_lines = lines[:start_idx] + replacement_lines + lines[end_idx:]
with open('backend/src/controllers/matchController.ts', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print('Successfully replaced with Squads proposal')









