/**
 * Workflows Module
 *
 * Exports all workflow classes for multi-signature operations.
 */

const WorkflowOrchestrator = require('./WorkflowOrchestrator');
const InteractiveWorkflow = require('./InteractiveWorkflow');
const OfflineWorkflow = require('./OfflineWorkflow');

module.exports = {
  WorkflowOrchestrator,
  InteractiveWorkflow,
  OfflineWorkflow
};
