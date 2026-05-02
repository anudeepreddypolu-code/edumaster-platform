const { appConfig } = require('./config.js');

let admin = null;
let firestore = null;
let bootPromise = null;

const isFirestoreStateEnabled = () => appConfig.firebaseStateStorage;

const getAdmin = () => {
  if (!admin) {
    // Lazy require so local dev does not need firebase-admin unless this mode is enabled.
    // eslint-disable-next-line global-require
    admin = require('firebase-admin');
  }
  return admin;
};

const connectFirestoreState = async () => {
  if (!isFirestoreStateEnabled()) {
    return null;
  }

  if (firestore) {
    return firestore;
  }

  if (bootPromise) {
    return bootPromise;
  }

  bootPromise = (async () => {
    const firebaseAdmin = getAdmin();
    const app = firebaseAdmin.apps.length
      ? firebaseAdmin.app()
      : firebaseAdmin.initializeApp();
    // eslint-disable-next-line global-require
    const { getFirestore } = require('firebase-admin/firestore');
    firestore = appConfig.firebaseStateDatabaseId
      ? getFirestore(app, appConfig.firebaseStateDatabaseId)
      : getFirestore(app);
    return firestore;
  })();

  return bootPromise;
};

const getStateDocumentRef = async () => {
  const db = await connectFirestoreState();
  if (!db) {
    return null;
  }

  return db.collection(appConfig.firebaseStateCollection).doc(appConfig.firebaseStateDocument);
};

module.exports = {
  isFirestoreStateEnabled,
  connectFirestoreState,
  getStateDocumentRef,
};
