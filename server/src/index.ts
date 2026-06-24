import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { z } from "zod";
import { connectDb, Conversation, User } from "./db.js";
import { hashPassword, signToken, verifyPassword } from "./lib/auth.js";
import {
  authenticate,
  errorHandler,
  requireRole,
  validateBody,
  validateParams,
} from "./middleware/index.js";
import { ROLES } from "./types.js";

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/ollama_chatbot";

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") ?? true, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true }));

app.get("/health", (_req, res) => res.json({ ok: true, service: "ollama-ai-chatbot" }));

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

app.post("/api/auth/register", validateBody(registerSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ error: "Email already registered" });
    const user = await User.create({ email, password: await hashPassword(password), role: ROLES.USER });
    const token = signToken({ id: user._id.toString(), role: user.role, email: user.email });
    return res.status(201).json({ token, user: { id: user._id, email: user.email, role: user.role } });
  } catch (e) {
    next(e);
  }
});

app.post("/api/auth/login", validateBody(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await verifyPassword(password, user.password))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const token = signToken({ id: user._id.toString(), role: user.role, email: user.email });
    return res.json({ token, user: { id: user._id, email: user.email, role: user.role } });
  } catch (e) {
    next(e);
  }
});

app.get("/api/auth/me", authenticate, (req, res) => {
  res.json({ user: req.user });
});

app.get("/api/conversations", authenticate, async (req, res, next) => {
  try {
    const filter = req.user!.role === ROLES.ADMIN ? {} : { userId: req.user!.id };
    const list = await Conversation.find(filter).select("title model updatedAt userId").sort({ updatedAt: -1 }).limit(50);
    res.json(list);
  } catch (e) {
    next(e);
  }
});

app.post(
  "/api/conversations",
  authenticate,
  validateBody(z.object({ title: z.string().min(1).max(200), model: z.string().default("llama3.2") })),
  async (req, res, next) => {
    try {
      const conv = await Conversation.create({ ...req.body, userId: req.user!.id });
      res.status(201).json(conv);
    } catch (e) {
      next(e);
    }
  },
);

app.get(
  "/api/conversations/:id",
  authenticate,
  validateParams(z.object({ id: z.string().min(1) })),
  async (req, res, next) => {
    try {
      const conv = await Conversation.findById(req.params.id);
      if (!conv) return res.status(404).json({ error: "Not found" });
      if (req.user!.role !== ROLES.ADMIN && conv.userId.toString() !== req.user!.id) {
        return res.status(403).json({ error: "Forbidden" });
      }
      res.json(conv);
    } catch (e) {
      next(e);
    }
  },
);

app.delete(
  "/api/conversations/:id",
  authenticate,
  validateParams(z.object({ id: z.string().min(1) })),
  async (req, res, next) => {
    try {
      const conv = await Conversation.findById(req.params.id);
      if (!conv) return res.status(404).json({ error: "Not found" });
      if (req.user!.role !== ROLES.ADMIN && conv.userId.toString() !== req.user!.id) {
        return res.status(403).json({ error: "Forbidden" });
      }
      await conv.deleteOne();
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },
);

app.post(
  "/api/chat",
  authenticate,
  validateBody(z.object({ conversationId: z.string().optional(), model: z.string().default("llama3.2"), message: z.string().min(1).max(8000) })),
  async (req, res, next) => {
    try {
      const { conversationId, model, message } = req.body;
      let conv = conversationId ? await Conversation.findById(conversationId) : null;
      if (conv && req.user!.role !== ROLES.ADMIN && conv.userId.toString() !== req.user!.id) {
        return res.status(403).json({ error: "Forbidden" });
      }
      if (!conv) {
        conv = await Conversation.create({ title: message.slice(0, 48), model, messages: [], userId: req.user!.id });
      }
      conv.messages.push({ role: "user", content: message });
      const ollamaMessages = conv.messages.map((m) => ({ role: m.role, content: m.content }));

      const response = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: ollamaMessages, stream: true }),
      });
      if (!response.ok || !response.body) return res.status(503).json({ error: "Ollama unavailable" });

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      let assistant = "";
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        res.write(chunk);
        for (const line of chunk.split("\n").filter(Boolean)) {
          try {
            assistant += JSON.parse(line).message?.content ?? "";
          } catch {
            /* partial */
          }
        }
      }
      conv.messages.push({ role: "assistant", content: assistant });
      conv.model = model;
      await conv.save();
      res.end();
    } catch (e) {
      next(e);
    }
  },
);

app.get("/api/models", authenticate, async (_req, res) => {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`);
    res.json(await r.json());
  } catch {
    res.status(503).json({ error: "Ollama not reachable" });
  }
});

app.get("/api/admin/users", authenticate, requireRole(ROLES.ADMIN), async (_req, res, next) => {
  try {
    const users = await User.find().select("email role createdAt");
    res.json(users);
  } catch (e) {
    next(e);
  }
});

app.use(errorHandler);

connectDb(MONGODB_URI)
  .then(() => app.listen(PORT, () => console.log(`API http://localhost:${PORT}`)))
  .catch((err) => {
    console.error("DB connection failed", err);
    process.exit(1);
  });
