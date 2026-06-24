import mongoose from "mongoose";
import type { Role } from "./types.js";

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["user", "assistant", "system"], required: true },
    content: { type: String, required: true },
  },
  { timestamps: true },
);

const conversationSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    model: { type: String, default: "llama3.2" },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    messages: [messageSchema],
  },
  { timestamps: true },
);

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    role: { type: String, enum: ["user", "admin"], default: "user" },
  },
  { timestamps: true },
);

export const User = mongoose.model("User", userSchema);
export const Conversation = mongoose.model("Conversation", conversationSchema);

export async function connectDb(uri: string) {
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);
  console.log("MongoDB connected");
}

export type UserDoc = mongoose.InferSchemaType<typeof userSchema> & { _id: mongoose.Types.ObjectId; role: Role };
