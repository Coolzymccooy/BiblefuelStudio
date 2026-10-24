/**
 * The Edge "Read Aloud" client (#120). No network: the socket is a fake that
 * plays the service's side of the protocol.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

const {
  TRUSTED_CLIENT_TOKEN,
  secMsGec,
  edgeSynthUrl,
  edgeHandshakeHeaders,
  buildSsml,
  edgeSynthesize,
} = await import("../../src/lib/edgeTtsClient.js");

// Reference values computed independently with Python's hashlib:
// sha256(str(((unix + 11644473600) rounded down to 300 s) * 1e7) + token), upper-case hex.
test("secMsGec hashes the 5-minute Windows-tick window with the trusted client token", () => {
  assert.equal(TRUSTED_CLIENT_TOKEN, "6A5AA1D4EAFF4E9FB37E23D68491D6F4");
  assert.equal(
    secMsGec(1_700_000_000_000),
    "42301B335578FEFDAE2637DED1ABD614505D432559EC08032B82048483726AFF",
  );
  const sameWindow = "AE4CF72E466874182A75878E20EADA83D29A1C12CAD9C3E0E014CCE0BFA55880";
  assert.equal(secMsGec(1_700_000_100_000), sameWindow);
  assert.equal(secMsGec(1_700_000_299_900), sameWindow);
});

test("edgeSynthUrl targets the msedgeservices endpoint with the token, GEC and version", () => {
  const url = new URL(edgeSynthUrl({ nowMs: 1_700_000_000_000, connectionId: "ab".repeat(16) }));
  assert.equal(url.protocol, "wss:");
  assert.equal(url.host, "api.msedgeservices.com");
  assert.equal(url.pathname, "/tts/cognitiveservices/websocket/v1");
  assert.equal(url.searchParams.get("Ocp-Apim-Subscription-Key"), TRUSTED_CLIENT_TOKEN);
  assert.equal(url.searchParams.get("Sec-MS-GEC"), secMsGec(1_700_000_000_000));
  assert.match(url.searchParams.get("Sec-MS-GEC-Version"), /^1-\d+\.\d+\.\d+\.\d+$/);
  assert.equal(url.searchParams.get("ConnectionId"), "ab".repeat(16));
});

test("edgeSynthUrl makes a fresh 32-hex connection id when none is given", () => {
  const id = new URL(edgeSynthUrl()).searchParams.get("ConnectionId");
  assert.match(id, /^[0-9a-f]{32}$/);
});

test("the handshake sends the browser headers the service now checks (#120)", () => {
  const headers = edgeHandshakeHeaders();
  // Without Accept-Encoding and Accept-Language the service answers HTTP 200 instead of upgrading.
  assert.ok(headers["Accept-Encoding"]);
  assert.ok(headers["Accept-Language"]);
  assert.equal(headers.Origin, "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold");
  assert.match(headers["User-Agent"], /Edg\/\d+/);
});

test("buildSsml escapes the text and the attribute values", () => {
  const ssml = buildSsml({ text: `Faith & "hope" <love>`, voice: "en-US-AriaNeural", rate: "+10%" });
  assert.match(ssml, /<voice name="en-US-AriaNeural">/);
  assert.match(ssml, /rate="\+10%"/);
  assert.match(ssml, /pitch="\+0Hz"/);
  assert.match(ssml, /volume="\+0%"/);
  assert.ok(ssml.includes("Faith &amp; &quot;hope&quot; &lt;love&gt;"));
  assert.ok(!ssml.includes("<love>"));
  assert.ok(buildSsml({ text: "hi there", voice: `x"y` }).includes(`name="x&quot;y"`));
});

/** A fake ws socket. `script(socket, sent)` plays the service once the client sends SSML. */
function fakeSocketFactory(script, captured = {}) {
  return (url, options) => {
    const socket = new EventEmitter();
    captured.url = url;
    captured.options = options;
    captured.sent = [];
    socket.readyState = 0;
    socket.send = (data, cb) => {
      captured.sent.push(String(data));
      if (typeof cb === "function") cb();
      if (String(data).includes("Path:ssml")) setImmediate(() => script(socket, captured.sent));
    };
    socket.close = () => { socket.readyState = 3; setImmediate(() => socket.emit("close", 1000)); };
    socket.terminate = socket.close;
    setImmediate(() => { socket.readyState = 1; socket.emit("open"); });
    return socket;
  };
}

function audioFrame(requestId, bytes, contentType = "audio/mpeg") {
  const head = Buffer.from(
    `X-RequestId:${requestId}\r\n${contentType ? `Content-Type:${contentType}\r\n` : ""}Path:audio\r\n`,
  );
  const len = Buffer.alloc(2);
  len.writeUInt16BE(head.length);
  return Buffer.concat([len, head, Buffer.from(bytes)]);
}

function requestIdOf(sent) {
  return /X-RequestId:([0-9a-f]+)/.exec(sent.find((m) => m.includes("Path:ssml")))[1];
}

test("edgeSynthesize sends speech.config then SSML and collects the audio frames", async () => {
  const captured = {};
  const createSocket = fakeSocketFactory((socket, sent) => {
    const rid = requestIdOf(sent);
    socket.emit("message", Buffer.from(`X-RequestId:${rid}\r\nPath:turn.start\r\n\r\n{}`), false);
    socket.emit("message", audioFrame(rid, [1, 2, 3]), true);
    socket.emit("message", audioFrame(rid, [4, 5]), true);
    socket.emit("message", audioFrame(rid, [], null), true);
    socket.emit("message", Buffer.from(`X-RequestId:${rid}\r\nPath:turn.end\r\n\r\n{}`), false);
  }, captured);

  const audio = await edgeSynthesize({ text: "Hello there.", voice: "en-US-AriaNeural", createSocket });
  assert.deepEqual([...audio], [1, 2, 3, 4, 5]);
  assert.equal(new URL(captured.url).host, "api.msedgeservices.com");
  assert.ok(captured.options.headers["Accept-Language"]);
  assert.match(captured.sent[0], /Path:speech\.config/);
  assert.match(captured.sent[0], /audio-24khz-48kbitrate-mono-mp3/);
  assert.match(captured.sent[1], /Content-Type:application\/ssml\+xml/);
  assert.match(captured.sent[1], /Hello there\./);
});

test("edgeSynthesize rejects when the socket closes before turn.end", async () => {
  const createSocket = fakeSocketFactory((socket, sent) => {
    socket.emit("message", audioFrame(requestIdOf(sent), [9]), true);
    socket.close();
  });
  await assert.rejects(
    edgeSynthesize({ text: "Hello there.", voice: "en-US-AriaNeural", createSocket }),
    /closed before the audio finished/,
  );
});

test("edgeSynthesize rejects when turn.end arrives with no audio", async () => {
  const createSocket = fakeSocketFactory((socket, sent) => {
    socket.emit("message", Buffer.from(`X-RequestId:${requestIdOf(sent)}\r\nPath:turn.end\r\n\r\n{}`), false);
  });
  await assert.rejects(
    edgeSynthesize({ text: "Hello there.", voice: "en-US-AriaNeural", createSocket }),
    /no audio/i,
  );
});

test("edgeSynthesize reports the HTTP status when the handshake is refused", async () => {
  const createSocket = () => {
    const socket = new EventEmitter();
    socket.close = () => {};
    socket.terminate = () => {};
    setImmediate(() => {
      const response = new EventEmitter();
      response.statusCode = 403;
      response.headers = { date: new Date().toUTCString() };
      response.resume = () => {};
      socket.emit("unexpected-response", { destroy() {} }, response);
    });
    return socket;
  };
  await assert.rejects(
    edgeSynthesize({ text: "Hello there.", voice: "en-US-AriaNeural", createSocket }),
    /Edge TTS handshake refused: HTTP 403/,
  );
});

test("a 403 with a skewed server clock retries once with the corrected time", async () => {
  const urls = [];
  const clientNow = 1_700_000_000_000;
  const skewedDate = new Date(clientNow + 20 * 60 * 1000).toUTCString();
  const good = fakeSocketFactory((socket, sent) => {
    const rid = requestIdOf(sent);
    socket.emit("message", audioFrame(rid, [7]), true);
    socket.emit("message", Buffer.from(`X-RequestId:${rid}\r\nPath:turn.end\r\n\r\n{}`), false);
  });
  const createSocket = (url, options) => {
    urls.push(url);
    if (urls.length > 1) return good(url, options);
    const socket = new EventEmitter();
    socket.close = () => {};
    socket.terminate = () => {};
    setImmediate(() => {
      const response = new EventEmitter();
      response.statusCode = 403;
      response.headers = { date: skewedDate };
      response.resume = () => {};
      socket.emit("unexpected-response", { destroy() {} }, response);
    });
    return socket;
  };
  const audio = await edgeSynthesize({
    text: "Hello there.", voice: "en-US-AriaNeural", createSocket, now: () => clientNow,
  });
  assert.deepEqual([...audio], [7]);
  assert.equal(new URL(urls[0]).searchParams.get("Sec-MS-GEC"), secMsGec(clientNow));
  assert.equal(urls.length, 2);
  const gec = (u) => new URL(u).searchParams.get("Sec-MS-GEC");
  assert.equal(gec(urls[1]), secMsGec(Date.parse(skewedDate)));
});

function refusingSocket(status) {
  const socket = new EventEmitter();
  socket.close = () => {};
  socket.terminate = () => {};
  setImmediate(() => {
    const response = new EventEmitter();
    response.statusCode = status;
    response.headers = { date: new Date().toUTCString() };
    response.resume = () => {};
    socket.emit("unexpected-response", { destroy() {} }, response);
  });
  return socket;
}

test("a 429 (the service throttles bursts) is retried after a pause", async () => {
  let calls = 0;
  const good = fakeSocketFactory((socket, sent) => {
    const rid = requestIdOf(sent);
    socket.emit("message", audioFrame(rid, [8]), true);
    socket.emit("message", Buffer.from(`X-RequestId:${rid}\r\nPath:turn.end\r\n\r\n{}`), false);
  });
  const createSocket = (url, options) => (++calls === 1 ? refusingSocket(429) : good(url, options));
  const audio = await edgeSynthesize({ text: "Hello there.", voice: "en-US-AriaNeural", createSocket, retryDelayMs: 0 });
  assert.deepEqual([...audio], [8]);
  assert.equal(calls, 2);
});

test("a 429 that persists gives up after three attempts", async () => {
  let calls = 0;
  const createSocket = () => { calls += 1; return refusingSocket(429); };
  await assert.rejects(
    edgeSynthesize({ text: "Hello there.", voice: "en-US-AriaNeural", createSocket, retryDelayMs: 0 }),
    /HTTP 429/,
  );
  assert.equal(calls, 3);
});

test("edgeSynthesize times out a stalled synthesis", async () => {
  const createSocket = fakeSocketFactory(() => { /* the service never answers */ });
  await assert.rejects(
    edgeSynthesize({ text: "Hello there.", voice: "en-US-AriaNeural", createSocket, timeoutMs: 50 }),
    /timed out/,
  );
});
