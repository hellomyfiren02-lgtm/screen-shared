const socket = io();

const $ = id => document.getElementById(id);

const state = {
  role: null,
  room: null,
  name: "",
  peers: new Map(),
  pendingIce: new Map(),
  viewerIds: new Set(),
  localStream: null,
  screenTrack: null,
  micTrack: null,
  startedAt: null,
  durationTimer: null,
  systemAudio: false,
  theme: localStorage.getItem("theme") || "dark",
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302"] }
  ]
};

document.body.classList.toggle("light", state.theme === "light");

/* =========================
   WEBRTC CONFIG
========================= */

fetch("/api/webrtc-config")
  .then(r => r.json())
  .then(config => {
    if (config?.iceServers) {
      state.iceServers = config.iceServers;
    }
  })
  .catch(() => {});

/* =========================
   UI
========================= */

function show(id) {
  ["home", "setup", "room"].forEach(x => {
    const el = $(x);
    if (el) el.classList.toggle("hidden", x !== id);
  });
}

function setHostUI(host) {
  document
    .querySelectorAll(".host-only")
    .forEach(el => el.classList.toggle("hidden", !host));
}

function formatTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));

  return [
    Math.floor(s / 3600),
    Math.floor(s / 60) % 60,
    s % 60
  ]
    .map(x => String(x).padStart(2, "0"))
    .join(":");
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[c])
  );
}

/* =========================
   CHAT
========================= */

function addMessage(m) {
  const div = document.createElement("div");
  div.className = "msg";
  div.dataset.id = m.id;

  const mod = m.moderator ? " 🛡️" : "";

  div.innerHTML = `
    <b>${escapeHtml(m.name)}${mod}</b>
    <small>${new Date(m.time).toLocaleTimeString()}</small>
    <p>${escapeHtml(m.text)}</p>
  `;

  if (state.role === "host") {
    const actions = document.createElement("div");
    actions.className = "msg-actions";

    actions.innerHTML = `
      <button class="secondary">📌 Fixar</button>
      <button class="danger">🧹 Apagar</button>
    `;

    actions.children[0].onclick = () => {
      socket.emit("chat:pin", m.id);
    };

    actions.children[1].onclick = () => {
      socket.emit("chat:delete", m.id);
    };

    div.appendChild(actions);
  }

  $("messages").appendChild(div);
  $("messages").scrollTop = $("messages").scrollHeight;
}

function sendChat() {
  const text = $("chatInput").value.trim();

  if (!text) return;

  socket.emit("chat:send", { text });

  $("chatInput").value = "";
}

/* =========================
   HOME / SALA
========================= */

$("createBtn").onclick = () => show("setup");

$("backHome").onclick = () => show("home");

$("privateRoom").onchange = () => {
  $("roomPassword").classList.toggle(
    "hidden",
    !$("privateRoom").checked
  );
};

$("themeBtn").onclick = () => {
  state.theme = state.theme === "dark" ? "light" : "dark";

  localStorage.setItem("theme", state.theme);

  document.body.classList.toggle(
    "light",
    state.theme === "light"
  );
};

$("makeRoom").onclick = () => {
  $("setupError").textContent = "";

  if (
    $("privateRoom").checked &&
    !$("roomPassword").value
  ) {
    $("setupError").textContent = "Defina uma senha.";
    return;
  }

  socket.emit(
    "room:create",
    {
      name: $("roomName").value,
      hostName: $("hostName").value,
      customId: $("customId").value,
      isPrivate: $("privateRoom").checked,
      password: $("roomPassword").value,
      maxViewers: $("maxViewers").value,
      temporary: $("temporaryRoom").checked
    },
    r => {
      if (!r.ok) {
        $("setupError").textContent = r.error;
        return;
      }

      enterRoom(r.room, "host");
    }
  );
};

function enterRoom(room, role) {
  state.room = room;
  state.role = role;
  state.name =
    role === "host"
      ? room.hostName
      : state.name;

  $("roomTitle").textContent = room.name;

  $("roomLink").value =
    location.origin + "/sala/" + room.id;

  setHostUI(role === "host");

  show("room");

  updateRoomStats(
    0,
    room.peakViewers || 0
  );

  if (role === "host") {
    $("roomStatus").textContent =
      "Pronto para iniciar";
  }
}

function promptForPassword() {
  return "";
}

function joinExisting(roomId) {
  const name =
    prompt("Seu nome:", "Espectador") ||
    "Espectador";

  const password = prompt(
    "Se a sala tiver senha, digite-a (ou deixe vazio):"
  ) || "";

  socket.emit(
    "room:join",
    {
      roomId,
      name,
      password
    },
    r => {
      if (!r.ok) {
        alert(r.error);
        show("home");
        return;
      }

      state.name = name;

      enterRoom(r.room, "viewer");

      r.messages.forEach(addMessage);

      setViewers(r.viewers);
    }
  );
}

/* =========================
   ENTRAR DIRETO /SALA
========================= */

const roomIdFromPath =
  location.pathname.match(
    /^\/sala\/([^/]+)/
  )?.[1];

if (roomIdFromPath) {
  const name =
    prompt("Seu nome:", "Espectador") ||
    "Espectador";

  const password =
    prompt(
      "Se a sala tiver senha, digite-a (ou deixe vazio):"
    ) || "";

  socket.emit(
    "room:join",
    {
      roomId: roomIdFromPath,
      name,
      password
    },
    r => {
      if (!r.ok) {
        alert(r.error);
        return;
      }

      state.name = name;

      enterRoom(r.room, "viewer");

      r.messages.forEach(addMessage);

      setViewers(r.viewers);
    }
  );
}

/* =========================
   BOTÕES
========================= */

$("copyBtn").onclick = async () => {
  await navigator.clipboard.writeText(
    $("roomLink").value
  );

  $("copyBtn").textContent = "Copiado ✓";

  setTimeout(() => {
    $("copyBtn").textContent = "Copiar";
  }, 1200);
};

$("fullscreenBtn").onclick = () => {
  $("videoWrap").requestFullscreen?.();
};

$("theaterBtn").onclick = () => {
  document.body.classList.toggle("theater");
};

$("sendChat").onclick = sendChat;

$("chatInput").onkeydown = e => {
  if (e.key === "Enter") {
    sendChat();
  }
};

/* =========================
   INICIAR TRANSMISSÃO
========================= */

$("startBtn").onclick = async () => {
  try {
    await startScreen();

    socket.emit("stream:start");

    setLive(true);

    /*
      IMPORTANTE:
      Aqui criamos as conexões também para
      espectadores que já estavam na sala.
    */
    await renegotiateAllViewers();

  } catch (e) {
    alert(
      "Não foi possível iniciar a transmissão: " +
      e.message
    );
  }
};

$("screenBtn").onclick = async () => {
  try {
    await startScreen();

    if (state.role === "host") {
      await renegotiateAllViewers();
    }
  } catch (e) {
    alert(e.message);
  }
};

$("micBtn").onclick = toggleMic;

$("sysAudioBtn").onclick = () => {
  state.systemAudio = !state.systemAudio;

  $("sysAudioBtn").textContent =
    `🔊 Áudio sistema: ${
      state.systemAudio ? "ON" : "OFF"
    }`;
};

$("endBtn").onclick = () => {
  state.localStream
    ?.getTracks()
    .forEach(t => t.stop());

  state.localStream = null;
  state.screenTrack = null;

  socket.emit("stream:end");

  setLive(false);

  $("remoteVideo").srcObject = null;

  $("waiting").classList.remove("hidden");

  for (const pc of state.peers.values()) {
    pc.close();
  }

  state.peers.clear();
};

/* =========================
   CAPTURA DA TELA
========================= */

async function startScreen() {
  if (state.localStream) {
    state.localStream
      .getTracks()
      .forEach(t => t.stop());
  }

  const q = Number($("quality").value);
  const fps = Number($("fps").value);

  const display =
    await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: {
          ideal: Math.round(q * 1.777)
        },
        height: {
          ideal: q
        },
        frameRate: {
          ideal: fps,
          max: fps
        }
      },
      audio: state.systemAudio
    });

  state.localStream = display;

  state.screenTrack =
    display.getVideoTracks()[0];

  state.screenTrack.onended = () => {
    if (state.role === "host") {
      socket.emit("stream:end");

      setLive(false);

      $("waiting").classList.remove("hidden");
    }
  };

  if (state.micTrack) {
    state.localStream.addTrack(
      state.micTrack
    );
  }

  $("remoteVideo").srcObject =
    state.localStream;

  $("waiting").classList.add("hidden");

  /*
    Se já existirem conexões, substituímos
    a faixa de vídeo.
  */
  for (const pc of state.peers.values()) {
    const sender = pc
      .getSenders()
      .find(
        s => s.track?.kind === "video"
      );

    if (sender) {
      await sender.replaceTrack(
        state.screenTrack
      );
    }
  }
}

/* =========================
   MICROFONE
========================= */

async function toggleMic() {
  try {
    if (!state.micTrack) {
      const ms =
        await navigator.mediaDevices.getUserMedia({
          audio: true
        });

      state.micTrack =
        ms.getAudioTracks()[0];

      state.micTrack.enabled = true;

      if (state.localStream) {
        state.localStream.addTrack(
          state.micTrack
        );
      }
    } else {
      state.micTrack.enabled =
        !state.micTrack.enabled;
    }

    $("micBtn").textContent =
      `🎙️ Microfone: ${
        state.micTrack.enabled
          ? "ON"
          : "OFF"
      }`;

    for (const pc of state.peers.values()) {
      const sender = pc
        .getSenders()
        .find(
          s => s.track?.kind === "audio"
        );

      if (sender) {
        await sender.replaceTrack(
          state.micTrack.enabled
            ? state.micTrack
            : null
        );
      }
    }
  } catch (e) {
    alert(
      "Não foi possível acessar o microfone: " +
      e.message
    );
  }
}

/* =========================
   LIVE
========================= */

function setLive(live) {
  $("liveBadge")
    .classList
    .toggle("hidden", !live);

  $("roomStatus").textContent =
    live ? "🔴 AO VIVO" : "Offline";

  if (live) {
    state.startedAt = Date.now();

    clearInterval(
      state.durationTimer
    );

    state.durationTimer =
      setInterval(() => {
        $("duration").textContent =
          formatTime(
            Date.now() -
            state.startedAt
          );
      }, 1000);

  } else {
    clearInterval(
      state.durationTimer
    );

    $("duration").textContent =
      "00:00:00";
  }
}

/* =========================
   SOCKET / ESTADO
========================= */

socket.on("stream:state", d => {
  setLive(d.live);

  if (!d.live) {
    $("waiting")
      .classList
      .remove("hidden");
  }
});

socket.on("stream:host-ended", () => {
  alert(
    "O transmissor encerrou a sala."
  );

  location.href = "/";
});

socket.on("chat:message", addMessage);

socket.on("chat:error", msg => {
  alert(msg);
});

socket.on("chat:deleted", id => {
  document
    .querySelector(
      `.msg[data-id="${id}"]`
    )
    ?.remove();
});

socket.on("chat:pinned", m => {
  const p = $("pinned");

  if (!m) {
    p.classList.add("hidden");
    return;
  }

  p.classList.remove("hidden");

  p.innerHTML =
    `📌 <b>${escapeHtml(m.name)}:</b> ` +
    escapeHtml(m.text);
});

socket.on("moderation:kicked", () => {
  alert(
    "Você foi expulso da sala."
  );

  location.href = "/";
});

socket.on("moderation:blocked", () => {
  alert(
    "Você foi bloqueado nesta sala."
  );

  location.href = "/";
});

/* =========================
   ESPECTADORES
========================= */

socket.on("room:viewers", d => {
  updateRoomStats(
    d.count,
    d.peak
  );

  setViewers(d.viewers);
});

function updateRoomStats(
  count,
  peak
) {
  $("viewerCount").textContent =
    count;

  $("peakCount").textContent =
    peak;
}

function setViewers(list) {
  /*
    Guardamos os IDs dos espectadores.
    Isso permite iniciar WebRTC mesmo
    quando eles entraram antes da live.
  */
  state.viewerIds =
    new Set(
      list.map(v => v.id)
    );

  $("viewerList").innerHTML = "";

  list.forEach(v => {
    const d =
      document.createElement("div");

    d.className = "viewer";

    const buttons =
      state.role === "host"
        ? `
          <div class="viewer-actions">
            <button
              class="secondary"
              onclick="mod('${v.id}',${!v.moderator})"
            >
              ${v.moderator ? "↩️" : "🛡️"}
            </button>

            <button
              class="secondary"
              onclick="kick('${v.id}')"
            >
              🚪
            </button>

            <button
              class="danger"
              onclick="blockV('${v.id}')"
            >
              🚫
            </button>
          </div>
        `
        : "";

    d.innerHTML = `
      <div>
        <b>${escapeHtml(v.name)}</b>
        <br>
        <small>
          ${v.moderator
            ? "Moderador"
            : "Espectador"}
        </small>
      </div>
      ${buttons}
    `;

    $("viewerList")
      .appendChild(d);
  });
}

window.mod = (
  id,
  value
) => {
  socket.emit(
    "moderator:set",
    {
      viewerId: id,
      value
    }
  );
};

window.kick = id => {
  if (
    confirm(
      "Expulsar este espectador?"
    )
  ) {
    socket.emit(
      "viewer:kick",
      id
    );
  }
};

window.blockV = id => {
  if (
    confirm(
      "Bloquear este espectador?"
    )
  ) {
    socket.emit(
      "viewer:block",
      id
    );
  }
};

/* =========================
   WEBRTC
========================= */

async function makePeer(
  peerId,
  isHost
) {
  /*
    Evita criar duas conexões para
    o mesmo espectador.
  */
  if (state.peers.has(peerId)) {
    return state.peers.get(peerId);
  }

  const pc =
    new RTCPeerConnection({
      iceServers:
        state.iceServers
    });

  state.peers.set(
    peerId,
    pc
  );

  pc.onicecandidate = e => {
    if (!e.candidate) return;

    socket.emit(
      "webrtc:ice",
      {
        to: peerId,
        candidate:
          e.candidate
      }
    );
  };

  pc.ontrack = e => {
    if (state.role !== "viewer")
      return;

    let stream =
      $("remoteVideo").srcObject;

    if (!(stream instanceof MediaStream)) {
      stream =
        new MediaStream();

      $("remoteVideo").srcObject =
        stream;
    }

    if (
      !stream
        .getTracks()
        .some(
          t => t.id === e.track.id
        )
    ) {
      stream.addTrack(
        e.track
      );
    }

    $("waiting")
      .classList
      .add("hidden");

    $("remoteVideo")
      .play()
      .catch(() => {});
  };

  pc.onconnectionstatechange = () => {
    if (
      pc.connectionState ===
        "failed" ||
      pc.connectionState ===
        "closed"
    ) {
      state.peers.delete(
        peerId
      );
    }

    if (
      state.role === "viewer"
    ) {
      if (
        pc.connectionState ===
        "connected"
      ) {
        $("latency").textContent =
          "Conectado";
      }

      if (
        pc.connectionState ===
          "disconnected" ||
        pc.connectionState ===
          "failed"
      ) {
        $("latency").textContent =
          "Reconectando…";
      }
    }
  };

  /*
    O host adiciona as faixas
    antes de criar a oferta.
  */
  if (
    isHost &&
    state.localStream
  ) {
    for (
      const track of
      state.localStream.getTracks()
    ) {
      pc.addTrack(
        track,
        state.localStream
      );
    }
  }

  return pc;
}

/* =========================
   NOVO ESPECTADOR
========================= */

socket.on(
  "viewer:joined",
  async v => {
    if (
      state.role !== "host"
    ) {
      return;
    }

    state.viewerIds.add(
      v.id
    );

    /*
      Se a live ainda não começou,
      não fazemos a conexão agora.
      Ela será criada quando
      a transmissão começar.
    */
    if (!state.localStream) {
      return;
    }

    await connectViewer(
      v.id
    );
  }
);

/* =========================
   CONECTAR ESPECTADOR
========================= */

async function connectViewer(
  peerId
) {
  if (
    state.role !== "host" ||
    !state.localStream
  ) {
    return;
  }

  let pc =
    state.peers.get(
      peerId
    );

  if (!pc) {
    pc =
      await makePeer(
        peerId,
        true
      );
  }

  /*
    Garante que todas as faixas
    da transmissão estejam na conexão.
  */
  for (
    const track of
    state.localStream.getTracks()
  ) {
    const sender =
      pc
        .getSenders()
        .find(
          s =>
            s.track?.kind ===
            track.kind
        );

    if (sender) {
      await sender.replaceTrack(
        track
      );
    } else {
      pc.addTrack(
        track,
        state.localStream
      );
    }
  }

  /*
    Só criamos a oferta depois
    de adicionar as faixas.
  */
  const offer =
    await pc.createOffer();

  await pc.setLocalDescription(
    offer
  );

  socket.emit(
    "webrtc:offer",
    {
      to: peerId,
      offer:
        pc.localDescription
    }
  );
}

/* =========================
   RECONECTAR TODOS
========================= */

async function renegotiateAllViewers() {
  if (
    state.role !== "host" ||
    !state.localStream
  ) {
    return;
  }

  for (
    const peerId of
    state.viewerIds
  ) {
    try {
      await connectViewer(
        peerId
      );
    } catch (e) {
      console.error(
        "Erro ao conectar espectador:",
        peerId,
        e
      );
    }
  }
}

/* =========================
   RECEBER OFERTA
========================= */

socket.on(
  "webrtc:offer",
  async ({
    from,
    offer
  }) => {
    if (
      state.role !== "viewer"
    ) {
      return;
    }

    let pc =
      state.peers.get(
        from
      );

    if (!pc) {
      pc =
        await makePeer(
          from,
          false
        );
    }

    try {
      await pc.setRemoteDescription(
        offer
      );

      const queued =
        state.pendingIce.get(
          from
        ) || [];

      for (
        const candidate of
        queued
      ) {
        try {
          await pc.addIceCandidate(
            candidate
          );
        } catch {}
      }

      state.pendingIce.delete(
        from
      );

      const answer =
        await pc.createAnswer();

      await pc.setLocalDescription(
        answer
      );

      socket.emit(
        "webrtc:answer",
        {
          to: from,
          answer:
            pc.localDescription
        }
      );
    } catch (e) {
      console.error(
        "Erro processando oferta:",
        e
      );
    }
  }
);

/* =========================
   RECEBER RESPOSTA
========================= */

socket.on(
  "webrtc:answer",
  async ({
    from,
    answer
  }) => {
    const pc =
      state.peers.get(
        from
      );

    if (!pc) return;

    try {
      await pc.setRemoteDescription(
        answer
      );

      const queued =
        state.pendingIce.get(
          from
        ) || [];

      for (
        const candidate of
        queued
      ) {
        try {
          await pc.addIceCandidate(
            candidate
          );
        } catch {}
      }

      state.pendingIce.delete(
        from
      );
    } catch (e) {
      console.error(
        "Erro processando resposta:",
        e
      );
    }
  }
);

/* =========================
   ICE
========================= */

socket.on(
  "webrtc:ice",
  async ({
    from,
    candidate
  }) => {
    let pc =
      state.peers.get(
        from
      );

    /*
      Se ainda não existe conexão,
      guardamos o candidato.
    */
    if (!pc) {
      if (
        !state.pendingIce.has(
          from
        )
      ) {
        state.pendingIce.set(
          from,
          []
        );
      }

      state.pendingIce
        .get(from)
        .push(candidate);

      return;
    }

    /*
      Se a descrição remota ainda
      não chegou, aguardamos.
    */
    if (
      !pc.remoteDescription
    ) {
      if (
        !state.pendingIce.has(
          from
        )
      ) {
        state.pendingIce.set(
          from,
          []
        );
      }

      state.pendingIce
        .get(from)
        .push(candidate);

      return;
    }

    try {
      await pc.addIceCandidate(
        candidate
      );
    } catch (e) {
      console.error(
        "Erro ICE:",
        e
      );
    }
  }
);

/* =========================
   DESCONEXÃO
========================= */

socket.on(
  "viewer:left",
  viewerId => {
    state.viewerIds.delete(
      viewerId
    );

    const pc =
      state.peers.get(
        viewerId
      );

    if (pc) {
      pc.close();
      state.peers.delete(
        viewerId
      );
    }
  }
);
