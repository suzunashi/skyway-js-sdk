const Peer = window.Peer;


async function get2chStream() {
  await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  const devices = await navigator.mediaDevices.enumerateDevices();
  const device2ch = devices.find(device => device.kind === "audioinput" && device.label === "Soundflower (2ch)");

  if (device2ch === undefined) {
    alert("2chデバイスが見つかりませんでした");
    return;
  }
  const stream = await navigator.mediaDevices.getUserMedia(
    {
      video: true,
      audio: {
        deviceId: device2ch.deviceId,
        channelCount: { ideal: 2, min: 1 },
        echoCancellation: false,
        googEchoCancellation: false
      }
    });

  // AudioContextを作成
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);
  const splitter = audioCtx.createChannelSplitter(2);
  source.connect(splitter);

  const dest1 = audioCtx.createMediaStreamDestination();
  const dest2 = audioCtx.createMediaStreamDestination();

  splitter.connect(dest1, 1);
  splitter.connect(dest2, 0);

  const newStream = new MediaStream();
  newStream.addTrack(stream.getVideoTracks()[0]);
  newStream.addTrack(dest1.stream.getAudioTracks()[0]);
  newStream.addTrack(dest2.stream.getAudioTracks()[0]);

  return newStream;
}


(async function main() {
  const localVideo = document.getElementById('js-local-stream');
  const joinTrigger = document.getElementById('js-join-trigger');
  const leaveTrigger = document.getElementById('js-leave-trigger');
  const remoteVideos = document.getElementById('js-remote-streams');
  const roomId = document.getElementById('js-room-id');
  const roomMode = document.getElementById('js-room-mode');
  const localText = document.getElementById('js-local-text');
  const sendTrigger = document.getElementById('js-send-trigger');
  const messages = document.getElementById('js-messages');
  const meta = document.getElementById('js-meta');
  const sdkSrc = document.querySelector('script[src*=skyway]');

  meta.innerText = `
    UA: ${navigator.userAgent}
    SDK: ${sdkSrc ? sdkSrc.src : 'unknown'}
  `.trim();

  const getRoomModeByHash = () => (location.hash === '#sfu' ? 'sfu' : 'mesh');

  roomMode.textContent = getRoomModeByHash();
  window.addEventListener(
    'hashchange',
    () => (roomMode.textContent = getRoomModeByHash())
  );

  // const localStream = await navigator.mediaDevices
  //   .getUserMedia({
  //     audio: true,
  //     video: true,
  //   })
  //   .catch(console.error);
  const localStream = await get2chStream();
  console.log(localStream.getTracks());

  // Render local stream
  localVideo.muted = true;
  localVideo.srcObject = localStream;
  localVideo.playsInline = true;
  await localVideo.play().catch(console.error);

  // eslint-disable-next-line require-atomic-updates
  const peer = (window.peer = new Peer({
    key: window.__SKYWAY_KEY__,
    debug: 3,
  }));

  // Register join handler
  joinTrigger.addEventListener('click', () => {
    // Note that you need to ensure the peer has connected to signaling server
    // before using methods of peer instance.
    if (!peer.open) {
      return;
    }

    const room = peer.joinRoom(roomId.value, {
      mode: getRoomModeByHash(),
      stream: localStream,
    });

    room.once('open', () => {
      messages.textContent += '=== You joined ===\n';
    });
    room.on('peerJoin', peerId => {
      messages.textContent += `=== ${peerId} joined ===\n`;
    });

    // Render remote stream for new peer join in the room
    room.on('stream', async stream => {
      const newVideo = document.createElement('video');
      console.log(stream.getAudioTracks());
      stream.getAudioTracks().forEach((track, i) => {
        const newStream = new MediaStream();
        const audio = document.getElementById(`audio-${i + 1}`);
        newStream.addTrack(track);
        audio.srcObject = newStream;
      })
      newVideo.srcObject = stream;
      newVideo.playsInline = true;
      newVideo.controls = true;
      // mark peerId to find it later at peerLeave event
      newVideo.setAttribute('data-peer-id', stream.peerId);
      remoteVideos.append(newVideo);
      await newVideo.play().catch(console.error);
    });

    room.on('data', ({ data, src }) => {
      // Show a message sent to the room and who sent
      messages.textContent += `${src}: ${data}\n`;
    });

    // for closing room members
    room.on('peerLeave', peerId => {
      const remoteVideo = remoteVideos.querySelector(
        `[data-peer-id="${peerId}"]`
      );
      remoteVideo.srcObject.getTracks().forEach(track => track.stop());
      remoteVideo.srcObject = null;
      remoteVideo.remove();

      messages.textContent += `=== ${peerId} left ===\n`;
    });

    // for closing myself
    room.once('close', () => {
      sendTrigger.removeEventListener('click', onClickSend);
      messages.textContent += '== You left ===\n';
      Array.from(remoteVideos.children).forEach(remoteVideo => {
        remoteVideo.srcObject.getTracks().forEach(track => track.stop());
        remoteVideo.srcObject = null;
        remoteVideo.remove();
      });
    });

    sendTrigger.addEventListener('click', onClickSend);
    leaveTrigger.addEventListener('click', () => room.close(), { once: true });

    function onClickSend() {
      // Send message to all of the peers in the room via websocket
      room.send(localText.value);

      messages.textContent += `${peer.id}: ${localText.value}\n`;
      localText.value = '';
    }
  });

  peer.on('error', console.error);
})();
