/**
 * PolicyEngine
 *
 * Composable policy rules for automated transaction approval.
 * Used with AgentSigningClient to define approval criteria.
 *
 * Rules compose with AND logic — all rules must pass for approval.
 * Each rule returns { approved: boolean, reason?: string }.
 *
 * Usage:
 *   const policy = new PolicyEngine()
 *     .addRule(new MaxAmountRule(1000))
 *     .addRule(new AllowedRecipientsRule(['0.0.123', '0.0.456']))
 *     .addRule(new AllowedTransactionTypesRule(['TransferTransaction']));
 *
 *   const agent = new AgentSigningClient({ approvalPolicy: policy.evaluate.bind(policy) });
 */

class PolicyEngine {
  constructor() {
    this.rules = [];
  }

  /**
   * Add a rule to the policy.
   * @param {PolicyRule} rule - Rule implementing evaluate(txDetails, metadata)
   * @returns {PolicyEngine} this (for chaining)
   */
  addRule(rule) {
    if (!rule || typeof rule.evaluate !== 'function') {
      throw new Error('Rule must implement evaluate(txDetails, metadata)');
    }
    this.rules.push(rule);
    return this;
  }

  /**
   * Evaluate all rules against a transaction.
   * All rules must pass (AND logic).
   *
   * @param {Object} txDetails - Decoded transaction details
   * @param {Object} metadata - Coordinator-provided metadata
   * @returns {Promise<{ approved: boolean, reason?: string, failedRules?: string[] }>}
   */
  async evaluate(txDetails, metadata) {
    const failedRules = [];

    for (const rule of this.rules) {
      try {
        const result = await rule.evaluate(txDetails, metadata);
        if (!result.approved) {
          failedRules.push(`${rule.constructor.name}: ${result.reason || 'rejected'}`);
        }
      } catch (error) {
        failedRules.push(`${rule.constructor.name}: error — ${error.message}`);
      }
    }

    if (failedRules.length > 0) {
      return {
        approved: false,
        reason: failedRules.join('; '),
        failedRules,
      };
    }

    return { approved: true };
  }
}

// ============================================================================
// Built-in Rules
// ============================================================================

/**
 * Reject transactions that exceed a maximum HBAR amount.
 */
class MaxAmountRule {
  /**
   * @param {number} maxHbar - Maximum HBAR amount per transaction
   */
  constructor(maxHbar) {
    this.maxHbar = maxHbar;
  }

  async evaluate(txDetails) {
    if (!txDetails.transfers) {
      return { approved: true }; // No transfers = no amount to check
    }

    for (const transfer of txDetails.transfers) {
      const amountHbar = Math.abs(parseFloat(transfer.amount)) / 100_000_000;
      if (amountHbar > this.maxHbar) {
        return {
          approved: false,
          reason: `Transfer amount ${amountHbar} HBAR exceeds limit of ${this.maxHbar} HBAR`,
        };
      }
    }

    return { approved: true };
  }
}

/**
 * Only approve transactions to whitelisted recipient accounts.
 */
class AllowedRecipientsRule {
  /**
   * @param {string[]} allowedAccountIds - Allowed Hedera account IDs
   */
  constructor(allowedAccountIds) {
    this.allowedAccountIds = new Set(allowedAccountIds);
  }

  async evaluate(txDetails) {
    if (!txDetails.transfers) {
      return { approved: true };
    }

    for (const transfer of txDetails.transfers) {
      const amount = parseFloat(transfer.amount);
      // Only check recipients (positive amounts)
      if (amount > 0 && !this.allowedAccountIds.has(transfer.accountId)) {
        return {
          approved: false,
          reason: `Recipient ${transfer.accountId} is not in the allowed list`,
        };
      }
    }

    return { approved: true };
  }
}

/**
 * Only approve specific transaction types.
 */
class AllowedTransactionTypesRule {
  /**
   * @param {string[]} allowedTypes - Allowed transaction type names
   */
  constructor(allowedTypes) {
    this.allowedTypes = new Set(allowedTypes);
  }

  async evaluate(txDetails) {
    const txType = txDetails.type || txDetails.transactionType;
    if (!txType) {
      return { approved: false, reason: 'Unknown transaction type' };
    }

    if (!this.allowedTypes.has(txType)) {
      return {
        approved: false,
        reason: `Transaction type ${txType} is not allowed. Allowed: ${[...this.allowedTypes].join(', ')}`,
      };
    }

    return { approved: true };
  }
}

/**
 * Only approve during specific time windows (UTC).
 */
class TimeWindowRule {
  /**
   * @param {number} startHour - Start hour (UTC, 0-23)
   * @param {number} endHour - End hour (UTC, 0-23)
   */
  constructor(startHour, endHour) {
    this.startHour = startHour;
    this.endHour = endHour;
  }

  async evaluate() {
    const hour = new Date().getUTCHours();
    const inWindow = this.startHour <= this.endHour
      ? (hour >= this.startHour && hour < this.endHour)
      : (hour >= this.startHour || hour < this.endHour); // Wraps midnight

    if (!inWindow) {
      return {
        approved: false,
        reason: `Current time (${hour}:00 UTC) is outside allowed window (${this.startHour}:00-${this.endHour}:00 UTC)`,
      };
    }

    return { approved: true };
  }
}

/**
 * Rate limit: maximum number of approvals per time period.
 */
class RateLimitRule {
  /**
   * @param {number} maxPerHour - Maximum approvals per hour
   */
  constructor(maxPerHour) {
    this.maxPerHour = maxPerHour;
    this.approvalTimestamps = [];
  }

  async evaluate() {
    const now = Date.now();
    const oneHourAgo = now - 3600000;

    // Clean old timestamps
    this.approvalTimestamps = this.approvalTimestamps.filter(t => t > oneHourAgo);

    if (this.approvalTimestamps.length >= this.maxPerHour) {
      return {
        approved: false,
        reason: `Rate limit exceeded: ${this.approvalTimestamps.length}/${this.maxPerHour} approvals in the last hour`,
      };
    }

    // Record this approval
    this.approvalTimestamps.push(now);
    return { approved: true };
  }
}

// ============================================================================
// Policy Presets
// ============================================================================

/**
 * Create a treasury agent policy preset.
 * Limits: amount, recipients, transfer types only.
 */
function createTreasuryAgentPolicy(options = {}) {
  const policy = new PolicyEngine();

  if (options.maxHbar) {
    policy.addRule(new MaxAmountRule(options.maxHbar));
  }

  if (options.allowedRecipients) {
    policy.addRule(new AllowedRecipientsRule(options.allowedRecipients));
  }

  policy.addRule(new AllowedTransactionTypesRule(
    options.allowedTypes || ['TransferTransaction', 'TokenAssociateTransaction']
  ));

  if (options.maxPerHour) {
    policy.addRule(new RateLimitRule(options.maxPerHour));
  }

  return policy;
}

/**
 * Create an approval bot policy preset.
 * Type restrictions + time windows.
 */
function createApprovalBotPolicy(options = {}) {
  const policy = new PolicyEngine();

  policy.addRule(new AllowedTransactionTypesRule(
    options.allowedTypes || ['TransferTransaction']
  ));

  if (options.startHour != null && options.endHour != null) {
    policy.addRule(new TimeWindowRule(options.startHour, options.endHour));
  }

  if (options.maxPerHour) {
    policy.addRule(new RateLimitRule(options.maxPerHour));
  }

  return policy;
}

module.exports = {
  PolicyEngine,
  // Built-in rules
  MaxAmountRule,
  AllowedRecipientsRule,
  AllowedTransactionTypesRule,
  TimeWindowRule,
  RateLimitRule,
  // Presets
  createTreasuryAgentPolicy,
  createApprovalBotPolicy,
};
