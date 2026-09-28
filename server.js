const express = require("express");
const http = require("http");
const crypto = require("crypto");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});
  if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    iceServers.push({
      urls: process.env.TURN_URL.split(",").map(s => s.trim()),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL
    });
  }
  res.json({ iceServers });
});


const rooms = new Map();

function id() {
  return crypto.randomBytes(5).toString("hex");
}

function safeRoom(room) {
  return {
    id: room.id,
    name: room.name,
    isPrivate: room.isPrivate,
    maxViewers: room.maxViewers,
    temporary: room.temporary,
    live: room.live,
    startedAt: room.startedAt,
    peakViewers: room.peakViewers
  };
}

function viewerList(room) {
  return [...room.viewers.values()].map(v => ({
    id: v.id,
    name: v.name,
    moderator: v.moderator,
    joinedAt: v.joinedAt
  }));
}

app.get("/sala/:roomId", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

io.on("connection", socket => {
  socket.on("room:create", (data, cb) => {
    const roomId = (data.customId || id()).toLowerCase().replace(/[^a-z0-9-_]/g, "").slice(0, 40);
    if (!roomId || rooms.has(roomId)) return cb?.({ ok: false, error: "Esse link já existe." });

    const room = {
      id: roomId,
      name: String(data.name || "Minha transmissão").slice(0, 80),
      isPrivate: !!data.isPrivate,
      password: data.password ? String(data.password).slice(0, 100) : "",
      maxViewers: Math.max(1, Math.min(500, Number(data.maxViewers) || 100)),
      temporary: data.temporary !== false,
      live: false,
      startedAt: null,
      peakViewers: 0,
      hostId: socket.id,
      hostName: String(data.hostName || "Transmissor").slice(0, 40),
      viewers: new Map(),
      blocked: new Set(),
      moderators: new Set(),
      pinned: null,
      messages: []
    };
    rooms.set(roomId, room);
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = "host";
    cb?.({ ok: true, room: safeRoom(room) });
  });

  socket.on("room:join", (data, cb) => {
    const room = rooms.get(String(data.roomId || "").toLowerCase());
    if (!room) return cb?.({ ok: false, error: "Sala não encontrada." });
    if (room.blocked.has(socket.id)) return cb?.({ ok: false, error: "Você está bloqueado nesta sala." });
    if (room.isPrivate && room.password !== String(data.password || "")) {
      return cb?.({ ok: false, error: "Senha incorreta." });
    }
    if (room.viewers.size >= room.maxViewers) return cb?.({ ok: false, error: "A sala atingiu o limite de espectadores." });

    const viewer = {
      id: socket.id,
      name: String(data.name || "Espectador").slice(0, 40),
      moderator: room.moderators.has(socket.id),
      joinedAt: Date.now()
    };
    room.viewers.set(socket.id, viewer);
    socket.join(room.id);
    socket.data.roomId = room.id;
    socket.data.role = "viewer";
    socket.data.name = viewer.name;

    room.peakViewers = Math.max(room.peakViewers, room.viewers.size);
    cb?.({ ok: true, room: safeRoom(room), viewers: viewerList(room), messages: room.messages, pinned: room.pinned });
    io.to(room.hostId).emit("room:viewers", { count: room.viewers.size, peak: room.peakViewers, viewers: viewerList(room) });
    socket.to(room.id).emit("viewer:joined", viewer);
  });

  socket.on("stream:start", data => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.hostId !== socket.id) return;
    room.live = true;
    room.startedAt = Date.now();
    io.to(room.id).emit("stream:state", { live: true, startedAt: room.startedAt });
  });

  socket.on("stream:end", () => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.hostId !== socket.id) return;
    room.live = false;
    io.to(room.id).emit("stream:state", { live: false });
  });

  socket.on("chat:send", data => {
    const room = rooms.get(socket.data.roomId);
    if (!room) return;
    const text = String(data.text || "").trim().slice(0, 500);
    if (!text) return;
    const now = Date.now();
    const recent = room.messages.filter(m => m.userId === socket.id && now - m.time < 4000);
    if (recent.length >= 4) return socket.emit("chat:error", "Aguarde um pouco antes de enviar mais mensagens.");

    const message = {
      id: id(),
      userId: socket.id,
      name: socket.data.role === "host" ? room.hostName : (room.viewers.get(socket.id)?.name || "Usuário"),
      text,
      time: now,
      moderator: socket.data.role === "host" || room.moderators.has(socket.id)
    };
    room.messages.push(message);
    room.messages = room.messages.slice(-100);
    io.to(room.id).emit("chat:message", message);
  });

  socket.on("chat:delete", messageId => {
    const room = rooms.get(socket.data.roomId);
    if (!room || !isModerator(room, socket.id)) return;
    room.messages = room.messages.filter(m => m.id !== messageId);
    io.to(room.id).emit("chat:deleted", messageId);
  });

  socket.on("chat:pin", messageId => {
    const room = rooms.get(socket.data.roomId);
    if (!room || !isModerator(room, socket.id)) return;
    room.pinned = room.messages.find(m => m.id === messageId) || null;
    io.to(room.id).emit("chat:pinned", room.pinned);
  });

  socket.on("moderator:set", ({ viewerId, value }) => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.hostId !== socket.id) return;
    if (value) room.moderators.add(viewerId); else room.moderators.delete(viewerId);
    const v = room.viewers.get(viewerId);
    if (v) v.moderator = value;
    io.to(room.id).emit("room:viewers", { count: room.viewers.size, peak: room.peakViewers, viewers: viewerList(room) });
  });

  socket.on("viewer:kick", viewerId => {
    const room = rooms.get(socket.data.roomId);
    if (!room || !isModerator(room, socket.id)) return;
    const target = io.sockets.sockets.get(viewerId);
    if (target) target.emit("moderation:kicked");
    target?.leave(room.id);
    room.viewers.delete(viewerId);
    io.to(room.id).emit("room:viewers", { count: room.viewers.size, peak: room.peakViewers, viewers: viewerList(room) });
  });

  socket.on("viewer:block", viewerId => {
    const room = rooms.get(socket.data.roomId);
    if (!room || !isModerator(room, socket.id)) return;
    room.blocked.add(viewerId);
    const target = io.sockets.sockets.get(viewerId);
    if (target) {
      target.emit("moderation:blocked");
      target.disconnect(true);
    }
    room.viewers.delete(viewerId);
    io.to(room.id).emit("room:viewers", { count: room.viewers.size, peak: room.peakViewers, viewers: viewerList(room) });
  });

  // WebRTC signaling for the prototype transport.
  socket.on("webrtc:offer", ({ to, offer }) => io.to(to).emit("webrtc:offer", { from: socket.id, offer }));
  socket.on("webrtc:answer", ({ to, answer }) => io.to(to).emit("webrtc:answer", { from: socket.id, answer }));
  socket.on("webrtc:ice", ({ to, candidate }) => io.to(to).emit("webrtc:ice", { from: socket.id, candidate }));

  socket.on("disconnect", () => {
    const room = rooms.get(socket.data.roomId);
    if (!room) return;

    if (room.hostId === socket.id) {
      io.to(room.id).emit("stream:host-ended");
      rooms.delete(room.id);
      return;
    }

    room.viewers.delete(socket.id);
    room.moderators.delete(socket.id);
    io.to(room.id).emit("room:viewers", { count: room.viewers.size, peak: room.peakViewers, viewers: viewerList(room) });
    io.to(room.id).emit("viewer:left", socket.id);
  });
});

function isModerator(room, socketId) {
  return room.hostId === socketId || room.moderators.has(socketId);
}

setInterval(() => {
  for (const [key, room] of rooms) {
    if (room.temporary && !room.live && room.viewers.size === 0 && Date.now() - (room.startedAt || Date.now()) > 30 * 60 * 1000) {
      rooms.delete(key);
    }
  }
}, 5 * 60 * 1000);

server.listen(PORT, () => console.log(`Screen Share V2: http://localhost:${PORT}`));
