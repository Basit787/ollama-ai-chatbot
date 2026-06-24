import { connectDb, User } from "./db.js";
import { hashPassword } from "./lib/auth.js";
import { ROLES } from "./types.js";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/ollama_chatbot";

async function seed() {
  await connectDb(MONGODB_URI);
  const email = process.env.ADMIN_EMAIL || "admin@example.com";
  const password = process.env.ADMIN_PASSWORD || "Admin123!";
  const existing = await User.findOne({ email });
  if (!existing) {
    await User.create({ email, password: await hashPassword(password), role: ROLES.ADMIN });
    console.log(`Admin seeded: ${email}`);
  } else {
    console.log("Admin already exists");
  }
  process.exit(0);
}

seed();
