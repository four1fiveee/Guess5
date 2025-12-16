#!/usr/bin/env python3
"""
Batch replacement script to wrap all Squads calls with escrow checks
"""
import re

# Read the file
with open('matchController.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Pattern 1: Wrap proposeWinnerPayout calls
def wrap_propose_winner_payout(match):
    pattern = r'(\s+)(const proposalResult = await (?:squadsVaultService|squadsService)\.proposeWinnerPayout\()'
    
    def replacement(m):
        indent = m.group(1)
        call_start = m.group(2)
        return f"""{indent}// Check if match uses escrow or Squads
{indent}const matchSystem = getMatchSystem({'reloadedMatch' if 'reloadedMatch' in match else 'updatedMatch' if 'updatedMatch' in match else 'match' if 'match' in match else 'freshMatch'});
{indent}if (matchSystem === 'escrow') {{
{indent}  // NEW ESCROW SYSTEM: Settlement is handled by frontend/player calling settleMatch
{indent}  console.log('✅ Escrow match - winner payout settlement will be triggered by player or frontend');
{indent}  return; // Escrow settlement is handled separately
{indent}}} else if (matchSystem === 'squads') {{
{indent}  // OLD SQUADS SYSTEM: Use Squads proposal
{indent}{call_start}"""
    
    return re.sub(pattern, replacement, content)

# For now, let's just count and show what needs to be replaced
print("This script would wrap all Squads calls. Manual replacement is safer for this large file.")
print("Total file size:", len(content), "characters")

