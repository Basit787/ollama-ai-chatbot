import { connectDb, Conversation, User } from "./db.js";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/ollama_chatbot";

async function reset() {
  await connectDb(MONGODB_URI);
  await Promise.all([Conversation.deleteMany({}), User.deleteMany({})]);
  console.log("MongoDB collections cleared (users, conversations)");
  process.exit(0);
}

reset().catch((err) => {
  console.error(err);
  process.exit(1);
});
