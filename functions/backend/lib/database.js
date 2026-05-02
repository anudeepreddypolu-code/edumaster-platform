const mongoose = require('mongoose');
const { appConfig } = require('./config.js');
const { initializePostgres, isPostgresReady } = require('./postgres.js');
const { connectFirestoreState, isFirestoreStateEnabled } = require('./firebase-state.js');

const isValidMongoUri = (value) => typeof value === 'string' && /^mongodb(\+srv)?:\/\//.test(value.trim());

const getMongoUri = () => {
  const rawUri = appConfig.mongoUri;
  return isValidMongoUri(rawUri) ? rawUri.trim() : null;
};

const hasPersistentDatabaseConfigured = () => Boolean(appConfig.postgresUrl || getMongoUri() || isFirestoreStateEnabled());
const shouldAllowMemoryFallback = () => appConfig.allowMemoryFallback || !hasPersistentDatabaseConfigured();

const connectDatabase = async () => {
  const postgresState = await initializePostgres();
  if (postgresState.connected) {
    return postgresState;
  }

  if (isFirestoreStateEnabled()) {
    try {
      await connectFirestoreState();
      return {
        connected: true,
        mode: 'firestore',
      };
    } catch (error) {
      if (!shouldAllowMemoryFallback()) {
        return {
          connected: false,
          mode: 'unavailable',
          reason: error.message,
        };
      }

      return {
        connected: false,
        mode: 'memory',
        reason: error.message,
      };
    }
  }

  const mongoUri = getMongoUri();

  if (!mongoUri) {
    if (!shouldAllowMemoryFallback()) {
      return {
        connected: false,
        mode: 'unavailable',
        reason: postgresState.enabled
          ? `Postgres unavailable: ${postgresState.reason}`
          : 'Persistent database is required but not configured',
      };
    }

    return {
      connected: false,
      mode: 'memory',
      reason: postgresState.enabled
        ? `Postgres unavailable: ${postgresState.reason}`
        : 'No valid MONGODB_URI configured',
    };
  }

  try {
    await mongoose.connect(mongoUri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5_000,
      autoIndex: appConfig.nodeEnv !== 'production',
    });
    return {
      connected: true,
      mode: 'mongodb',
    };
  } catch (error) {
    if (!shouldAllowMemoryFallback()) {
      return {
        connected: false,
        mode: 'unavailable',
        reason: error.message,
      };
    }

    return {
      connected: false,
      mode: 'memory',
      reason: error.message,
    };
  }
};

const isMongoConnected = () => mongoose.connection.readyState === 1;
const isDatabaseConnected = () => isPostgresReady() || isMongoConnected() || isFirestoreStateEnabled();
const getDatabaseMode = () => (isPostgresReady() ? 'postgres' : (isMongoConnected() ? 'mongodb' : (isFirestoreStateEnabled() ? 'firestore' : 'memory')));

module.exports = {
  connectDatabase,
  getMongoUri,
  hasPersistentDatabaseConfigured,
  isMongoConnected,
  isDatabaseConnected,
  getDatabaseMode,
  shouldAllowMemoryFallback,
};
