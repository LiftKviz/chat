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

admin.initializeApp();

const createHttpsFunction = (httpsFunction) =>
  functions.region('europe-west3').https.onRequest((request, response) => {
    cors(request, response, () => {
      httpsFunction(request, response);
    });
  });

// helper functions
const MESSAGE_QUEUE_SIZE = 15;
const messageQueue = admin.firestore().collection('message-queue');
const chatMessages = admin.firestore().collection('chat-messages');

const queueMessage = (message, player) =>
  messageQueue.doc(`${new Date().getTime()}`).set({ message, player });
const addChatMessages = (messages) => chatMessages.doc(`${new Date().getTime()}`).set({ messages });

const deleteAllDocumentsFromCollection = (collection) =>
  collection
    .select()
    .get()
    .then((querySnapshot) => {
      querySnapshot.docs.forEach((doc) => {
        doc.ref.delete();
      });
    });
const hasPriority = (player) =>
  player.has_priority_on_chat &&
  (player.has_priority_on_chat === true || player.has_priority_on_chat == 1);

// https functions
exports.smokeTest = createHttpsFunction((request, response) => {
  response.send('smoke test' + JSON.stringify(request.body));
});

exports.startChat = createHttpsFunction((request, response) => {
  deleteAllDocumentsFromCollection(messageQueue);
  deleteAllDocumentsFromCollection(chatMessages);
  response.send();
});

exports.endChat = createHttpsFunction((request, response) => {
  deleteAllDocumentsFromCollection(messageQueue);
  deleteAllDocumentsFromCollection(chatMessages);

  response.send();
});

exports.sendMessage = createHttpsFunction(async (request, response) => {
  try {
    let { message, player } = request.body;
    player = typeof player == 'string' ? JSON.parse(player) : player;
    if (hasPriority(player)) {
      addChatMessages(chatMessages, [{ message, player }]);
      return;
    }

    const queuedMessages = await messageQueue.select().get();
    if (queuedMessages.size >= MESSAGE_QUEUE_SIZE) {
      return;
    }

    queueMessage(message, player);
  } catch (err) {
    console.log(err);
  } finally {
    response.send();
  }
});

exports.broadcastMessageFromQueue = createHttpsFunction(async (request, response) => {
  try {
    const queuedMessages = await messageQueue.limit(3).get();
    if (!queuedMessages.size) {
      return;
    }

    const newMessages = [];
    queuedMessages.docs.forEach((message) => {
      newMessages.push(message.data());
      message.ref.delete();
    });
    addChatMessages(newMessages);
  } catch (err) {
    console.log(err);
  } finally {
    response.send();
  }
});
