import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { API_URL } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";

const TOKEN_KEY = "ollama_token";
const authSchema = z.object({ email: z.string().email(), password: z.string().min(8) });
const schema = z.object({ message: z.string().min(1, "Message is required") });
type FormValues = z.infer<typeof schema>;
type Message = { role: "user" | "assistant"; content: string };

function authHeaders(): HeadersInit {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function App() {
  const [authed, setAuthed] = useState(!!localStorage.getItem(TOKEN_KEY));
  const [mode, setMode] = useState<"login" | "register">("login");
  const [models, setModels] = useState<string[]>(["llama3.2"]);
  const [model, setModel] = useState("llama3.2");
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string>();
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const authForm = useForm<z.infer<typeof authSchema>>({ resolver: zodResolver(authSchema), defaultValues: { email: "", password: "" } });
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { message: "" } });

  useEffect(() => {
    if (!authed) return;
    fetch(`${API_URL}/api/models`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        const names = (d.models ?? []).map((m: { name: string }) => m.name);
        if (names.length) { setModels(names); setModel(names[0]); }
      })
      .catch(() => undefined);
  }, [authed]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function onAuth(values: z.infer<typeof authSchema>) {
    const res = await fetch(`${API_URL}/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    const data = await res.json();
    if (data.token) {
      localStorage.setItem(TOKEN_KEY, data.token);
      setAuthed(true);
    }
  }

  async function onSubmit(values: FormValues) {
    setLoading(true);
    const userMsg: Message = { role: "user", content: values.message };
    setMessages((m) => [...m, userMsg, { role: "assistant", content: "" }]);
    form.reset();
    try {
      const res = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ message: values.message, model, conversationId }),
      });
      if (!res.ok || !res.body) throw new Error("Chat failed");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistant = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value).split("\n").filter(Boolean)) {
          try {
            assistant += JSON.parse(line).message?.content ?? "";
            setMessages((prev) => {
              const copy = [...prev];
              copy[copy.length - 1] = { role: "assistant", content: assistant };
              return copy;
            });
          } catch { /* skip */ }
        }
      }
    } catch {
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: "assistant", content: "Ollama unavailable or auth failed." };
        return copy;
      });
    } finally {
      setLoading(false);
    }
  }

  if (!authed) {
    return (
      <Card className="mx-auto mt-20 max-w-sm">
        <CardHeader><CardTitle className="text-primary">Ollama Chat</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={authForm.handleSubmit(onAuth)} className="space-y-3">
            <Input type="email" placeholder="Email" {...authForm.register("email")} />
            <Input type="password" placeholder="Password" {...authForm.register("password")} />
            <Button type="submit" className="w-full">{mode === "login" ? "Login" : "Register"}</Button>
            <Button type="button" variant="outline" className="w-full" onClick={() => setMode(mode === "login" ? "register" : "login")}>
              Switch to {mode === "login" ? "register" : "login"}
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto grid min-h-dvh max-w-5xl gap-4 p-4 lg:grid-cols-[240px_1fr]">
      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-primary">Ollama Chat</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Label htmlFor="model">Model</Label>
          <select id="model" value={model} onChange={(e) => setModel(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <Button variant="outline" className="w-full" onClick={() => { setMessages([]); setConversationId(undefined); }}>New chat</Button>
          <Button variant="outline" className="w-full" onClick={() => { localStorage.removeItem(TOKEN_KEY); setAuthed(false); }}>Logout</Button>
        </CardContent>
      </Card>
      <Card className="flex flex-col">
        <CardContent className="flex flex-1 flex-col pt-6">
          <div className="mb-4 flex-1 space-y-3 overflow-y-auto pr-1">
            {messages.map((msg, i) => (
              <div key={i} className={`rounded-lg px-4 py-3 text-sm ${msg.role === "user" ? "ml-12 bg-primary/15" : "mr-12 bg-muted"}`}>
                {msg.content || (loading && i === messages.length - 1 ? "…" : "")}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-2">
            <Label htmlFor="message">Message</Label>
            <Textarea id="message" {...form.register("message")} placeholder="Ask Ollama anything…" rows={3} />
            <Button type="submit" disabled={loading}>{loading ? "Sending…" : "Send"}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
