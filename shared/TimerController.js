/**
 * TimerController
 *
 * Centralized timer management for the multi-sig server.
 * Provides a single point of control for all timeouts and intervals.
 * Enables clean shutdown and debugging of active timers.
 */

class TimerController {
  constructor() {
    this.timers = new Map();      // id -> { type, handle, name, createdAt }
    this.nextId = 1;
    this.isShuttingDown = false;
  }

  /**
   * Create a setTimeout with tracking
   *
   * @param {Function} callback - Function to execute
   * @param {number} delay - Delay in milliseconds
   * @param {string} [name] - Optional name for debugging
   * @returns {number} Timer ID
   */
  setTimeout(callback, delay, name = null) {
    if (this.isShuttingDown) {
      return null;
    }

    const id = this.nextId++;
    const handle = setTimeout(() => {
      this.timers.delete(id);
      callback();
    }, delay);

    this.timers.set(id, {
      type: 'timeout',
      handle,
      name: name || `timeout-${id}`,
      createdAt: Date.now(),
      delay
    });

    return id;
  }

  /**
   * Create a setInterval with tracking
   *
   * @param {Function} callback - Function to execute
   * @param {number} interval - Interval in milliseconds
   * @param {string} [name] - Optional name for debugging
   * @returns {number} Timer ID
   */
  setInterval(callback, interval, name = null) {
    if (this.isShuttingDown) {
      return null;
    }

    const id = this.nextId++;
    const handle = setInterval(callback, interval);

    this.timers.set(id, {
      type: 'interval',
      handle,
      name: name || `interval-${id}`,
      createdAt: Date.now(),
      interval
    });

    return id;
  }

  /**
   * Clear a specific timer
   *
   * @param {number} id - Timer ID returned from setTimeout/setInterval
   * @returns {boolean} True if timer was found and cleared
   */
  clear(id) {
    const timer = this.timers.get(id);
    if (!timer) {
      return false;
    }

    if (timer.type === 'timeout') {
      clearTimeout(timer.handle);
    } else {
      clearInterval(timer.handle);
    }

    this.timers.delete(id);
    return true;
  }

  /**
   * Clear all timers with a specific name prefix
   *
   * @param {string} prefix - Name prefix to match
   * @returns {number} Number of timers cleared
   */
  clearByPrefix(prefix) {
    let count = 0;
    for (const [id, timer] of this.timers) {
      if (timer.name && timer.name.startsWith(prefix)) {
        this.clear(id);
        count++;
      }
    }
    return count;
  }

  /**
   * Get list of active timers for debugging
   *
   * @returns {Array} Array of timer info objects
   */
  getActiveTimers() {
    const timers = [];
    for (const [id, timer] of this.timers) {
      timers.push({
        id,
        type: timer.type,
        name: timer.name,
        createdAt: timer.createdAt,
        age: Date.now() - timer.createdAt
      });
    }
    return timers;
  }

  /**
   * Get count of active timers
   *
   * @returns {Object} Counts by type
   */
  getStats() {
    let timeouts = 0;
    let intervals = 0;

    for (const timer of this.timers.values()) {
      if (timer.type === 'timeout') {
        timeouts++;
      } else {
        intervals++;
      }
    }

    return { timeouts, intervals, total: timeouts + intervals };
  }

  /**
   * Clear all timers (for shutdown)
   *
   * @returns {number} Number of timers cleared
   */
  clearAll() {
    this.isShuttingDown = true;
    const count = this.timers.size;

    for (const [id, timer] of this.timers) {
      if (timer.type === 'timeout') {
        clearTimeout(timer.handle);
      } else {
        clearInterval(timer.handle);
      }
    }

    this.timers.clear();
    return count;
  }

  /**
   * Reset controller state (for testing)
   */
  reset() {
    this.clearAll();
    this.isShuttingDown = false;
    this.nextId = 1;
  }
}

// Export singleton instance for server-wide use
const globalTimerController = new TimerController();

module.exports = {
  TimerController,
  timerController: globalTimerController
};
