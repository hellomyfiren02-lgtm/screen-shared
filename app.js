const socket = io();
fetch("/api/webrtc-config").then(r=>r.json()).then(c=>{ if(c?.iceServers) window.WEBRTC_CONFIG=c; }).catch(()=>{});
const $ = id => document.getElementById(id);
const TURN_CONFIG = window.WEBRTC_CONFIG || {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302"] }
  ]
};
const state = {
  role: null, room: null, name: "", peers: new Map(), pendingIce: new Map(), localStream: null,
  screenTrack: null, micTrack: null, startedAt: null, durationTimer: null,
  systemAudio: false, theme: localStorage.getItem("theme") || "dark"
};

document.body.classList.toggle("light", state.theme === "light");

function show(id) {
  ["home","setup","room"].forEach(x => $(x).classList.toggle("hidden", x !== id));
}
function setHostUI(host) {
  document.querySelectorAll(".host-only").forEach(el => el.classList.toggle("hidden", !host));
}
function formatTime(ms) {
  const s = Math.max(0, Math.floor(ms/1000));
  return [Math.floor(s/3600), Math.floor(s/60)%60, s%60].map(x=>String(x).padStart(2,"0")).join(":");
}
function addMessage(m) {
  const div = document.createElement("div"); div.className="msg"; div.dataset.id=m.id;
  const mod = m.moderator ? " 🛡️" : "";
  div.innerHTML = `<b>${escapeHtml(m.name)}${mod}</b><small>${new Date(m.time).toLocaleTimeString()}</small><p>${escapeHtml(m.text)}</p>`;
  if (state.role === "host" || m.moderator === false) {
    const actions = document.createElement("div"); actions.className="msg-actions";
    if (state.role === "host") {
      actions.innerHTML = `<button class="secondary">📌 Fixar</button><button class="danger">🧹 Apagar</button>`;
      actions.children[0].onclick=()=>socket.emit("chat:pin",m.id);
      actions.children[1].onclick=()=>socket.emit("chat:delete",m.id);
      div.appendChild(actions);
    }
  }
  $("messages").appendChild(div); $("messages").scrollTop=$("messages").scrollHeight;
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}

$("createBtn").onclick=()=>show("setup");
$("backHome").onclick=()=>show("home");
$("privateRoom").onchange=()=> $("roomPassword").classList.toggle("hidden", !$("privateRoom").checked);
$("themeBtn").onclick=()=>{state.theme=state.theme==="dark"?"light":"dark";localStorage.setItem("theme",state.theme);document.body.classList.toggle("light",state.theme==="light")};
$("makeRoom").onclick=()=>{
  $("setupError").textContent="";
  if($("privateRoom").checked && !$("roomPassword").value) return $("setupError").textContent="Defina uma senha.";
  socket.emit("room:create",{
    name:$("roomName").value,hostName:$("hostName").value,customId:$("customId").value,
    isPrivate:$("privateRoom").checked,password:$("roomPassword").value,
    maxViewers:$("maxViewers").value,temporary:$("temporaryRoom").checked
  },r=>{if(!r.ok)return $("setupError").textContent=r.error; enterRoom(r.room,"host")});
};

function enterRoom(room,role){
  state.room=room;state.role=role;state.name=role==="host"?room.hostName:"";
  $("roomTitle").textContent=room.name; $("roomLink").value=location.origin+"/sala/"+room.id;
  setHostUI(role==="host"); show("room");
  updateRoomStats(0,room.peakViewers||0);
  if(role==="host") $("roomStatus").textContent="Pronto para iniciar";
}
function joinExisting(roomId){
  const name=prompt("Seu nome:","Espectador")||"Espectador";
  const password=promptForPassword();
  socket.emit("room:join",{roomId,name,password},r=>{
    if(!r.ok){alert(r.error);show("home");return}
    state.name=name;enterRoom(r.room,"viewer");
    r.messages.forEach(addMessage); setViewers(r.viewers);
  });
}
function promptForPassword(){return "";} // Private access is handled by server; use the browser prompt below when needed.
const roomIdFromPath=location.pathname.match(/^\/sala\/([^/]+)/)?.[1];
if(roomIdFromPath){
  // Ask for password only after the server tells us one is required is not possible without a probe.
  // A single prompt keeps the public flow simple; empty means public.
  const name=prompt("Seu nome:","Espectador")||"Espectador";
  const password=prompt("Se a sala tiver senha, digite-a (ou deixe vazio):")||"";
  socket.emit("room:join",{roomId:roomIdFromPath,name,password},r=>{
    if(!r.ok){alert(r.error);return}
    state.name=name;enterRoom(r.room,"viewer");r.messages.forEach(addMessage);setViewers(r.viewers);
  });
}

$("copyBtn").onclick=async()=>{await navigator.clipboard.writeText($("roomLink").value);$("copyBtn").textContent="Copiado ✓";setTimeout(()=>$("copyBtn").textContent="Copiar",1200)};
$("fullscreenBtn").onclick=()=> $("videoWrap").requestFullscreen?.();
$("theaterBtn").onclick=()=>document.body.classList.toggle("theater");

$("sendChat").onclick=sendChat;
$("chatInput").onkeydown=e=>{if(e.key==="Enter")sendChat()};
function sendChat(){const text=$("chatInput").value.trim();if(!text)return;socket.emit("chat:send",{text});$("chatInput").value=""}

$("startBtn").onclick=async()=>{
  try{
    await startScreen();
    socket.emit("stream:start");
    setLive(true);
    await renegotiateAllViewers();
  }catch(e){alert("Não foi possível iniciar a transmissão: "+e.message)}
};
$("screenBtn").onclick=async()=>{try{await startScreen()}catch(e){alert(e.message)}};
$("micBtn").onclick=toggleMic;
$("sysAudioBtn").onclick=()=>{state.systemAudio=!state.systemAudio;$("sysAudioBtn").textContent=`🔊 Áudio sistema: ${state.systemAudio?"ON":"OFF"}`};
$("endBtn").onclick=()=>{state.localStream?.getTracks().forEach(t=>t.stop());state.localStream=null;socket.emit("stream:end");setLive(false);$("remoteVideo").srcObject=null;$("waiting").classList.remove("hidden")};

async function startScreen(){
  if(state.localStream) state.localStream.getTracks().forEach(t=>t.stop());
  const q=Number($("quality").value), fps=Number($("fps").value);
  const display=await navigator.mediaDevices.getDisplayMedia({
    video:{width:{ideal:q*1.777},height:{ideal:q},frameRate:{ideal:fps,max:fps}},
    audio:state.systemAudio
  });
  state.localStream=display; state.screenTrack=display.getVideoTracks()[0];
  state.screenTrack.onended=()=>{if(state.role==="host"){socket.emit("stream:end");setLive(false)}};
  if(state.micTrack) state.localStream.addTrack(state.micTrack);
  $("remoteVideo").srcObject=state.localStream;
  $("waiting").classList.add("hidden");
  for(const [peerId,pc] of state.peers){
    const sender=pc.getSenders().find(s=>s.track?.kind==="video");
    if(sender) await sender.replaceTrack(state.screenTrack);
  }
}
async function toggleMic(){
  if(!state.micTrack){
    const ms=await navigator.mediaDevices.getUserMedia({audio:true});
    state.micTrack=ms.getAudioTracks()[0];
    state.micTrack.enabled=true;
    if(state.localStream) state.localStream.addTrack(state.micTrack);
  }else state.micTrack.enabled=!state.micTrack.enabled;
  $("micBtn").textContent=`🎙️ Microfone: ${state.micTrack.enabled?"ON":"OFF"}`;
  for(const pc of state.peers.values()){
    const sender=pc.getSenders().find(s=>s.track?.kind==="audio");
    if(sender) await sender.replaceTrack(state.micTrack.enabled?state.micTrack:null);
  }
}

function setLive(live){
  $("liveBadge").classList.toggle("hidden",!live);
  $("roomStatus").textContent=live?"🔴 AO VIVO":"Offline";
  if(live){state.startedAt=Date.now();clearInterval(state.durationTimer);state.durationTimer=setInterval(()=>$("duration").textContent=formatTime(Date.now()-state.startedAt),1000)}
  else{clearInterval(state.durationTimer);$("duration").textContent="00:00:00"}
}

socket.on("stream:state",d=>{setLive(d.live); if(!d.live)$("waiting").classList.remove("hidden")});
socket.on("stream:host-ended",()=>{alert("O transmissor encerrou a sala.");location.href="/"});
socket.on("chat:message",addMessage);
socket.on("chat:error",msg=>alert(msg));
socket.on("chat:deleted",id=>document.querySelector(`.msg[data-id="${id}"]`)?.remove());
socket.on("chat:pinned",m=>{const p=$("pinned");if(!m){p.classList.add("hidden");return}p.classList.remove("hidden");p.innerHTML=`📌 <b>${escapeHtml(m.name)}:</b> ${escapeHtml(m.text)}`});
socket.on("moderation:kicked",()=>{alert("Você foi expulso da sala.");location.href="/"});
socket.on("moderation:blocked",()=>{alert("Você foi bloqueado nesta sala.");location.href="/"});

socket.on("room:viewers",d=>{updateRoomStats(d.count,d.peak);setViewers(d.viewers)});
socket.on("viewer:joined",v=>{});
socket.on("viewer:left",()=>{});

function updateRoomStats(count,peak){$("viewerCount").textContent=count;$("peakCount").textContent=peak}
function setViewers(list){
  $("viewerList").innerHTML="";
  list.forEach(v=>{
    const d=document.createElement("div");d.className="viewer";
    const buttons=state.role==="host"?`<div class="viewer-actions"><button class="secondary" onclick="mod('${v.id}',${!v.moderator})">${v.moderator?"↩️":"🛡️"}</button><button class="secondary" onclick="kick('${v.id}')">🚪</button><button class="danger" onclick="blockV('${v.id}')">🚫</button></div>`:"";
    d.innerHTML=`<div><b>${escapeHtml(v.name)}</b><br><small>${v.moderator?"Moderador":"Espectador"}</small></div>${buttons}`;
    $("viewerList").appendChild(d);
  });
}
window.mod=(id,value)=>socket.emit("moderator:set",{viewerId:id,value});
window.kick=id=>{if(confirm("Expulsar este espectador?"))socket.emit("viewer:kick",id)};
window.blockV=id=>{if(confirm("Bloquear este espectador?"))socket.emit("viewer:block",id)};

async function renegotiateAllViewers(){
  if(state.role!=="host" || !state.localStream) return;
  for(const [peerId,pc] of state.peers){
    const senders=pc.getSenders();
    for(const track of state.localStream.getTracks()){
      const existing=senders.find(s=>s.track?.kind===track.kind);
      if(existing) await existing.replaceTrack(track);
      else pc.addTrack(track,state.localStream);
    }
    const offer=await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("webrtc:offer",{to:peerId,offer:pc.localDescription});
  }
}

// WebRTC prototype: one peer per viewer. For larger audiences, replace this transport with an SFU.
async function makePeer(peerId,isHost){
  const pc=new RTCPeerConnection(TURN_CONFIG);
  state.peers.set(peerId,pc);
  pc.onicecandidate=e=>{if(e.candidate)socket.emit("webrtc:ice",{to:peerId,candidate:e.candidate})};
  pc.onconnectionstatechange=()=>{
    if(state.role==="viewer" && ["failed","disconnected"].includes(pc.connectionState)){
      $("latency").textContent="Reconectando…";
    } else if(state.role==="viewer" && pc.connectionState==="connected") $("latency").textContent="Conectado";
  };
  pc.ontrack=e=>{
    if(state.role!=="viewer") return;
    const stream=$("remoteVideo").srcObject || new MediaStream();
    if(!stream.getTracks().some(t=>t.id===e.track.id)) stream.addTrack(e.track);
    $("remoteVideo").srcObject=stream; $("waiting").classList.add("hidden");
  };
  if(isHost && state.localStream) state.localStream.getTracks().forEach(t=>pc.addTrack(t,state.localStream));
  return pc;
}
socket.on("viewer:joined",async v=>{
  if(state.role!=="host")return;
  const pc=await makePeer(v.id,true);const offer=await pc.createOffer();await pc.setLocalDescription(offer);
  socket.emit("webrtc:offer",{to:v.id,offer:pc.localDescription});
});
socket.on("webrtc:offer",async({from,offer})=>{
  if(state.role!=="viewer")return;
  const pc=await makePeer(from,false);await pc.setRemoteDescription(offer);
  const queued=state.pendingIce.get(from)||[]; for(const c of queued){try{await pc.addIceCandidate(c)}catch{}}
  state.pendingIce.delete(from);
  const answer=await pc.createAnswer();await pc.setLocalDescription(answer);
  socket.emit("webrtc:answer",{to:from,answer:pc.localDescription});
});
socket.on("webrtc:answer",async({from,answer})=>{
  const pc=state.peers.get(from); if(!pc) return;
  await pc.setRemoteDescription(answer);
  const queued=state.pendingIce.get(from)||[];
  for(const c of queued){try{await pc.addIceCandidate(c)}catch{}}
  state.pendingIce.delete(from);
});
socket.on("webrtc:ice",async({from,candidate})=>{
  const pc=state.peers.get(from);
  if(!pc) return;
  if(pc.remoteDescription) { try{await pc.addIceCandidate(candidate)}catch{} }
  else { if(!state.pendingIce.has(from)) state.pendingIce.set(from,[]); state.pendingIce.get(from).push(candidate); }
});
