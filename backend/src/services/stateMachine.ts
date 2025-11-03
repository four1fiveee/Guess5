import { enhancedLogger } from '../utils/enhancedLogger';

// Match state enum
export enum MatchState {
  WAITING = 'waiting',
  MATCHED = 'matched',
  PAYMENT_REQUIRED = 'payment_required',
  PAYMENT_VERIFIED = 'payment_verified',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  ERROR = 'error'
}

// State transition interface
interface StateTransition {
  from: MatchState[];
  to: MatchState;
  condition?: (match: any) => boolean;
  action?: (match: any) => Promise<void>;
  description: string;
}

// State machine class
class MatchStateMachine {
  private transitions: Map<MatchState, StateTransition[]> = new Map();

  constructor() {
    this.initializeTransitions();
  }

  private initializeTransitions() {
    // WAITING -> MATCHED (when opponent found)
    this.addTransition({
      from: [MatchState.WAITING],
      to: MatchState.MATCHED,
      description: 'Opponent found, match created'
    });

    // MATCHED -> PAYMENT_REQUIRED (when match is created)
    this.addTransition({
      from: [MatchState.MATCHED],
      to: MatchState.PAYMENT_REQUIRED,
      description: 'Match created, payment required'
    });

    // PAYMENT_REQUIRED -> PAYMENT_VERIFIED (when one player pays)
    this.addTransition({
      from: [MatchState.PAYMENT_REQUIRED],
      to: MatchState.PAYMENT_VERIFIED,
      condition: (match) => match.player1Paid || match.player2Paid,
      description: 'First payment received'
    });

    // PAYMENT_VERIFIED -> ACTIVE (when both players pay)
    this.addTransition({
      from: [MatchState.PAYMENT_VERIFIED],
      to: MatchState.ACTIVE,
      condition: (match) => match.player1Paid && match.player2Paid,
      description: 'Both payments received, game active'
    });

    // PAYMENT_REQUIRED -> ACTIVE (when both players pay directly)
    this.addTransition({
      from: [MatchState.PAYMENT_REQUIRED],
      to: MatchState.ACTIVE,
      condition: (match) => match.player1Paid && match.player2Paid,
      description: 'Both payments received, game active'
    });

    // PAYMENT_REQUIRED -> CANCELLED (payment timeout)
    this.addTransition({
      from: [MatchState.PAYMENT_REQUIRED],
      to: MatchState.CANCELLED,
      description: 'Payment timeout, match cancelled'
    });

    // PAYMENT_VERIFIED -> CANCELLED (payment timeout)
    this.addTransition({
      from: [MatchState.PAYMENT_VERIFIED],
      to: MatchState.CANCELLED,
      description: 'Payment timeout, match cancelled'
    });

    // ACTIVE -> COMPLETED (game finished)
    this.addTransition({
      from: [MatchState.ACTIVE],
      to: MatchState.COMPLETED,
      description: 'Game completed'
    });

    // Any state -> ERROR (system error)
    this.addTransition({
      from: Object.values(MatchState),
      to: MatchState.ERROR,
      description: 'System error occurred'
    });
  }

  private addTransition(transition: StateTransition) {
    for (const fromState of transition.from) {
      if (!this.transitions.has(fromState)) {
        this.transitions.set(fromState, []);
      }
      this.transitions.get(fromState)!.push(transition);
    }
  }

  // Check if transition is valid
  public canTransition(fromState: MatchState, toState: MatchState, match?: any): boolean {
    const availableTransitions = this.transitions.get(fromState);
    if (!availableTransitions) return false;

    const transition = availableTransitions.find(t => t.to === toState);
    if (!transition) return false;

    // Check condition if provided
    if (transition.condition && match) {
      return transition.condition(match);
    }

    return true;
  }

  // Get available transitions for current state
  public getAvailableTransitions(currentState: MatchState, match?: any): StateTransition[] {
    const availableTransitions = this.transitions.get(currentState);
    if (!availableTransitions) return [];

    return availableTransitions.filter(transition => {
      if (transition.condition && match) {
        return transition.condition(match);
      }
      return true;
    });
  }

  // Execute state transition
  public async transition(match: any, toState: MatchState, context?: any): Promise<boolean> {
    const currentState = match.status as MatchState;
    
    enhancedLogger.info('🔄 State machine transition attempt', {
      matchId: match.id,
      fromState: currentState,
      toState,
      context
    });

    // Validate transition
    if (!this.canTransition(currentState, toState, match)) {
      enhancedLogger.error('❌ Invalid state transition', {
        matchId: match.id,
        fromState: currentState,
        toState,
        availableTransitions: this.getAvailableTransitions(currentState, match).map(t => t.to)
      });
      return false;
    }

    // Get transition details
    const availableTransitions = this.transitions.get(currentState);
    const transition = availableTransitions?.find(t => t.to === toState);
    
    if (!transition) {
      enhancedLogger.error('❌ Transition not found', {
        matchId: match.id,
        fromState: currentState,
        toState
      });
      return false;
    }

    try {
      // Execute transition action if provided
      if (transition.action) {
        await transition.action(match);
      }

      // Update match state
      match.status = toState;
      match.updatedAt = new Date();

      enhancedLogger.info('✅ State transition successful', {
        matchId: match.id,
        fromState: currentState,
        toState,
        description: transition.description,
        context
      });

      return true;
    } catch (error) {
      enhancedLogger.error('❌ State transition failed', {
        matchId: match.id,
        fromState: currentState,
        toState,
        error
      });
      return false;
    }
  }

  // Validate current state
  public validateState(match: any): { isValid: boolean; issues: string[] } {
    const issues: string[] = [];
    const currentState = match.status as MatchState;

    // Check if state exists
    if (!Object.values(MatchState).includes(currentState)) {
      issues.push(`Invalid state: ${currentState}`);
    }

    // State-specific validations
    switch (currentState) {
      case MatchState.WAITING:
        if (match.player2) {
          issues.push('Waiting state should not have player2');
        }
        if (match.word) {
          issues.push('Waiting state should not have game word');
        }
        break;

      case MatchState.MATCHED:
      case MatchState.PAYMENT_REQUIRED:
        if (!match.player1 || !match.player2) {
          issues.push('Matched state must have both players');
        }
        if (!match.word) {
          issues.push('Matched state must have game word');
        }
        break;

      case MatchState.PAYMENT_VERIFIED:
        if (!match.player1Paid && !match.player2Paid) {
          issues.push('Payment verified state must have at least one payment');
        }
        break;

      case MatchState.ACTIVE:
        if (!match.player1Paid || !match.player2Paid) {
          issues.push('Active state must have both payments');
        }
        if (!match.gameStartTime) {
          issues.push('Active state must have game start time');
        }
        break;

      case MatchState.COMPLETED:
        if (!match.winner && match.winner !== 'tie') {
          issues.push('Completed state must have winner');
        }
        break;
    }

    return {
      isValid: issues.length === 0,
      issues
    };
  }

  // Get state machine statistics
  public getStats(): any {
    const stats: any = {};
    
    for (const [state, transitions] of this.transitions.entries()) {
      stats[state] = {
        availableTransitions: transitions.map(t => t.to),
        transitionCount: transitions.length
      };
    }

    return stats;
  }
}

// Export singleton instance
export const matchStateMachine = new MatchStateMachine();
