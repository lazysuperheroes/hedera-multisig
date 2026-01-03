/**
 * Session Stores
 *
 * Available session storage backends:
 * - MemorySessionStore: In-memory storage (default)
 * - RedisSessionStore: Redis-backed storage for persistence
 */

const SessionStore = require('../SessionStore');
const RedisSessionStore = require('./RedisSessionStore');

/**
 * Create a session store based on configuration
 *
 * @param {Object} options - Store options
 * @param {string} options.type - Store type: 'memory' or 'redis'
 * @param {Object} options.redis - Redis configuration (if type is 'redis')
 * @returns {SessionStore|RedisSessionStore} Session store instance
 */
function createSessionStore(options = {}) {
  const type = options.type || 'memory';

  if (type === 'redis') {
    return new RedisSessionStore({
      defaultTimeout: options.defaultTimeout,
      redisHost: options.redis?.host,
      redisPort: options.redis?.port,
      redisPassword: options.redis?.password,
      redisDb: options.redis?.db,
      keyPrefix: options.redis?.keyPrefix
    });
  }

  // Default to in-memory
  return new SessionStore({
    defaultTimeout: options.defaultTimeout,
    cleanupInterval: options.cleanupInterval
  });
}

module.exports = {
  SessionStore,
  RedisSessionStore,
  createSessionStore
};
