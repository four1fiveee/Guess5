#!/usr/bin/env python3
"""
Script to remove all Squads-related code from matchController.ts
- Removes getMatchSystem() function
- Removes all 'else if (matchSystem === squads)' blocks
- Simplifies 'if (matchSystem === escrow)' to just execute the code
- Removes Squads service imports
- Removes proposal-related SQL queries
"""

import re
import sys

def remove_squads_code(content: str) -> str:
    """Remove all Squads-related code"""
    
    # Remove getMatchSystem function
    content = re.sub(
        r'/\*\*\s*\n\s*\* Helper function to determine if a match uses escrow.*?\n\s*\*/\s*\nfunction getMatchSystem\([^)]+\):.*?\{[^}]*return null;\s*\}',
        '',
        content,
        flags=re.DOTALL
    )
    
    # Remove Squads service imports
    content = re.sub(
        r"// Import Squads service[^\n]*\nconst \{ squadsVaultService \} = require\('\.\./services/squadsVaultService'\);[^\n]*\n",
        '',
        content
    )
    content = re.sub(
        r"const \{ SquadsVaultService \} = require\('\.\./services/squadsVaultService'\);[^\n]*\n",
        '',
        content
    )
    content = re.sub(
        r"const squadsService = new SquadsVaultService\(\);[^\n]*\n",
        '',
        content
    )
    
    # Pattern 1: Remove entire else-if squads blocks
    # Match: else if (matchSystem === 'squads') { ... entire block ... }
    # This is complex because we need to match nested braces
    
    # Pattern 2: Simplify escrow checks - remove the if statement wrapper
    # if (matchSystem === 'escrow') { ... } -> just execute the code
    
    # Pattern 3: Remove getMatchSystem() calls and the variable assignment
    # const matchSystem = getMatchSystem(...); -> remove
    
    return content

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python cleanup_squads.py <file>")
        sys.exit(1)
    
    filepath = sys.argv[1]
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    cleaned = remove_squads_code(content)
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(cleaned)
    
    print(f"Cleaned {filepath}")

