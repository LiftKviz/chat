const functions = require('firebase-functions');
const admin = require('firebase-admin');
const cors = require('cors')({
  origin: [
    'http://localhost:8000',
    'https://web-staging.liftkviz.rs',
    'http://web-staging.liftkviz.rs',
    'https://web-production.liftkviz.rs',
    'http://web-production.liftkviz.rs',
  ],
});

admin.initializeApp({
  databaseURL: 'secret',
  credential: admin.credential.cert({
    projectId: 'secret',
    clientEmail: 'secret',
    privateKey:
      'secret',
  }),
});

const createHttpsFunction = (httpsFunction) =>
  functions.region('europe-west3').https.onRequest((request, response) => {
    cors(request, response, () => {
      httpsFunction(request, response);
    });
  });

// helper functions
const MESSAGE_QUEUE_SIZE = 15;
const currentState = () => admin.firestore().collection('chat-data').doc('current-state');
const messageQueue = () => admin.firestore().collection('message-queue');
const chatMessages = () => admin.firestore().collection('chat-messages');
const addMessage = (collection, data) => collection.doc(`${new Date().getTime()}`).set(data);
const deleteAllDocumentsFromCollection = (collection) =>
  collection
    .select()
    .get()
    .then((querySnapshot) => {
      querySnapshot.docs.forEach((doc) => {
        doc.ref.delete();
      });
    });

// https functions
exports.smokeTest = createHttpsFunction((request, response) => {
  response.send('smoke test' + JSON.stringify(request.body));
});

exports.startChat = createHttpsFunction((request, response) => {
  currentState().set({ isActive: true });
  response.send();
});

exports.endChat = createHttpsFunction((request, response) => {
  currentState().set({ isActive: false });
  deleteAllDocumentsFromCollection(messageQueue());
  deleteAllDocumentsFromCollection(chatMessages());

  response.send();
});

exports.sendMessage = createHttpsFunction(async (request, response) => {
  try {
    const currentStateDoc = await currentState().get();
    if (!currentStateDoc.data().isActive) {
      return;
    }

    if (request.body.player && request.body.player.has_priority_on_chat) {
      addMessage(chatMessages(), request.body);
      return;
    }

    const queuedMessages = await messageQueue().select().get();
    if (queuedMessages.size >= MESSAGE_QUEUE_SIZE) {
      return;
    }

    addMessage(messageQueue(), request.body);
  } catch (err) {
    console.log(err);
  } finally {
    response.send();
  }
});

exports.broadcastMessageFromQueue = createHttpsFunction(async (request, response) => {
  try {
    const queuedMessages = await messageQueue().limit(3).get();
    if (!queuedMessages.size) {
      return;
    }

    queuedMessages.docs.forEach((message) => {
      addMessage(chatMessages(), message.data());
      message.ref.delete();
    });
  } catch (err) {
    console.log(err);
  } finally {
    response.send();
  }
});
