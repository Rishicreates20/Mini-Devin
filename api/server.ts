import express from "express";
import { createServer as createViteServer } from "vite";
import { Server } from "socket.io";
import { createServer } from "http";
import path from "path";
import fs from "fs/promises";
import { spawn } from "child_process";
import { v4 as uuidv4 } from "uuid";
import os from "os";
import cookieSession from "cookie-session";
import { Octokit } from "octokit";

declare global {
  namespace Express {
    interface Request {
      session?: {
        githubToken?: string;
      };
    }
  }
}

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
const PORT = 3000;

app.use(express.json());
app.use(cookieSession({
  name: 'session',
  keys: [process.env.SESSION_SECRET || 'mini-devin-secret'],
  maxAge: 24 * 60 * 60 * 1000, // 24 hours
  secure: true,
  sameSite: 'none'
}));

// Sandbox storage
const sandboxes = new Map<string, string>();

app.post("/api/sandbox/init", async (req, res) => {
  const id = uuidv4();
  const sandboxPath = path.join(os.tmpdir(), `mini-devin-${id}`);
  await fs.mkdir(sandboxPath, { recursive: true });
  sandboxes.set(id, sandboxPath);
  res.json({ id });
});

app.post("/api/sandbox/write", async (req, res) => {
  const { id, filename, content } = req.body;
  const sandboxPath = sandboxes.get(id);
  if (!sandboxPath) return res.status(404).json({ error: "Sandbox not found" });

  const filePath = path.join(sandboxPath, filename);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
  res.json({ success: true });
});

// GitHub OAuth
app.get("/api/auth/github/url", (req, res) => {
  const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/github/callback`;
  const url = `https://github.com/login/oauth/authorize?client_id=${process.env.GITHUB_CLIENT_ID}&redirect_uri=${redirectUri}&scope=repo`;
  res.json({ url });
});

app.get("/api/auth/github/callback", async (req, res) => {
  const { code } = req.query;
  try {
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      }),
    });
    const data = await response.json();
    if (data.access_token) {
      if (req.session) {
        req.session.githubToken = data.access_token;
      }
      res.send(`
        <html>
          <body>
            <script>
              window.opener.postMessage({ type: 'GITHUB_AUTH_SUCCESS' }, '*');
              window.close();
            </script>
          </body>
        </html>
      `);
    } else {
      res.status(400).send("Failed to get access token");
    }
  } catch (error) {
    res.status(500).send("Internal server error");
  }
});

app.get("/api/auth/github/status", (req, res) => {
  res.json({ connected: !!req.session?.githubToken });
});

app.post("/api/github/push", async (req, res) => {
  const { id, repoName } = req.body;
  const token = req.session?.githubToken;
  if (!token) return res.status(401).json({ error: "Not authenticated with GitHub" });

  const sandboxPath = sandboxes.get(id);
  if (!sandboxPath) return res.status(404).json({ error: "Sandbox not found" });

  try {
    const octokit = new Octokit({ auth: token });
    
    // 1. Create Repository
    const { data: repo } = await octokit.rest.repos.createForAuthenticatedUser({
      name: repoName,
      auto_init: false,
    });

    // 2. Initialize Git and Push
    const remoteUrl = repo.clone_url.replace("https://", `https://x-access-token:${token}@`);
    
    // Write a basic .gitignore to avoid pushing large generated folders if created during testing
    await fs.writeFile(path.join(sandboxPath, '.gitignore'), 'node_modules\n__pycache__\n.env\n');

    const runScript = (script: string) => {
      return new Promise((resolve, reject) => {
        const child = spawn("sh", ["-c", script], { cwd: sandboxPath });
        child.on("close", (code) => code === 0 ? resolve(true) : reject(new Error(`Git export failed with code ${code}`)));
      });
    };

    const gitScript = `
      git init && \\
      git config user.email "mini-devin@example.com" && \\
      git config user.name "Mini Devin" && \\
      git add . && \\
      git commit -m "Initial commit from Mini Devin" && \\
      git branch -M main && \\
      git remote add origin "${remoteUrl}" && \\
      git push -u origin main
    `;
    
    await runScript(gitScript);

    res.json({ success: true, url: repo.html_url });
  } catch (error: any) {
    console.error("GitHub Push Error:", error);
    res.status(500).json({ error: error.message });
  }
});

io.on("connection", (socket) => {
  socket.on("run", async ({ id, command, args = [] }) => {
    const sandboxPath = sandboxes.get(id);
    if (!sandboxPath) {
      socket.emit("output", { type: "stderr", data: "Sandbox not found\n" });
      return;
    }

    socket.emit("output", { type: "system", data: `> Executing: ${command} ${args.join(" ")}\n` });

    const child = spawn(command, args, {
      cwd: sandboxPath,
      env: { ...process.env, FORCE_COLOR: "1" },
    });

    child.stdout.on("data", (data) => {
      socket.emit("output", { type: "stdout", data: data.toString() });
    });

    child.stderr.on("data", (data) => {
      socket.emit("output", { type: "stderr", data: data.toString() });
    });

    child.on("close", (code) => {
      socket.emit("output", { type: "system", data: `\nProcess exited with code ${code}\n` });
      socket.emit("exit", { code });
    });
  });
});

async function setupVite() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // In production (Vercel or Railway), serve static files
    const distPath = path.resolve(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
}

// Start server if not in Vercel environment
if (!process.env.VERCEL) {
  setupVite().then(() => {
    httpServer.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  });
} else {
  // On Vercel, we just export the app
  setupVite();
}

export default app;
