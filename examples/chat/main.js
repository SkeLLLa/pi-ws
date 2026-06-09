const messages = document.querySelector('#messages');
const events = document.querySelector('#events');
const status = document.querySelector('#status');
const wsUrl = document.querySelector('#ws-url');
const authTokenInput = document.querySelector('#auth-token');
const connectButton = document.querySelector('#connect');
const authenticateButton = document.querySelector('#authenticate');
const composer = document.querySelector('#composer');
const promptInput = document.querySelector('#prompt');
const sendButton = document.querySelector('#send');
const abortButton = document.querySelector('#abort');
const sessionInfo = document.querySelector('#session-info');

const MAX_EVENT_LOG_ENTRIES = 200;
const MAX_MESSAGE_NODES = 150;
const CSV_PREVIEW_MAX_BYTES = 256 * 1024;
const MAX_CSV_COLUMNS = 20;
const MAX_CSV_ROWS = 50;
const MAX_CSV_CELL_CHARS = 300;
const TEXT_PREVIEW_MAX_CHARS = 4000;

let socket;
let requestNumber = 0;
let activeAssistantMessage;
let activeAssistantText = '';
let activeSessionId = '';
let artifactUrls = new Set();
let assistantRenderScheduled = false;
let authPending = false;
let eventLogEntries = [];
let eventLogRenderScheduled = false;
let pendingArtifact;
let pendingAssistantDelta = '';
let piReady = false;
let scrollMessagesScheduled = false;

wsUrl.value = defaultWebSocketUrl();
setConnectionState('disconnected');
appendSystem('Open the connection, then send a prompt.');
window.addEventListener('beforeunload', releaseArtifactUrls);

connectButton.addEventListener('click', () => {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.close();
    return;
  }

  connect();
});

authenticateButton.addEventListener('click', () => {
  if (!authPending) {
    appendSystem('Authentication is not waiting for a token.');
    return;
  }

  sendAuthMessage();
});

composer.addEventListener('submit', (event) => {
  event.preventDefault();

  const message = promptInput.value.trim();
  if (message === '') return;

  sendCommand({
    id: nextRequestId(),
    type: 'prompt',
    message,
    streamingBehavior: 'followUp',
  });

  appendMessage('user', message);
  activeAssistantMessage = undefined;
  activeAssistantText = '';
  pendingAssistantDelta = '';
  promptInput.value = '';
});

abortButton.addEventListener('click', () => {
  sendCommand({
    id: nextRequestId(),
    type: 'abort',
  });
});

function connect() {
  socket?.close();
  socket = new WebSocket(wsUrl.value);
  socket.binaryType = 'arraybuffer';
  piReady = false;
  activeSessionId = '';
  authPending = false;
  pendingArtifact = undefined;
  renderSessionInfo();
  setConnectionState('connecting');

  socket.addEventListener('open', () => {
    setConnectionState('connected');
    appendSystem('Connected.');
  });

  socket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') {
      handleBinaryFrame(event.data);
      return;
    }

    const data = parseEvent(event.data);
    logEvent(data);
    handlePiEvent(data);
  });

  socket.addEventListener('close', (event) => {
    piReady = false;
    activeSessionId = '';
    authPending = false;
    pendingArtifact = undefined;
    renderSessionInfo();
    setConnectionState('disconnected');
    appendSystem(`Disconnected (${event.code || 'no code'}).`);
  });

  socket.addEventListener('error', () => {
    appendSystem('WebSocket error. Check server logs and Pi provider config.');
  });
}

function sendCommand(command) {
  if (socket?.readyState !== WebSocket.OPEN) {
    appendSystem('Not connected.');
    return;
  }

  if (!piReady) {
    appendSystem('Pi is not ready yet.');
    return;
  }

  socket.send(JSON.stringify(command));
}

function handlePiEvent(event) {
  if (!event || typeof event !== 'object') return;

  switch (event.type) {
    case 'pi_ws_artifact':
      prepareArtifactTransfer(event, 'single');
      break;
    case 'pi_ws_artifact_chunk':
      break;
    case 'pi_ws_artifact_end':
      finalizeArtifactTransfer(event.id);
      break;
    case 'pi_ws_artifact_skipped':
      appendSystem(
        `Artifact skipped: ${event.relativePath ?? event.name} (${event.reason})`,
      );
      break;
    case 'pi_ws_artifact_start':
      prepareArtifactTransfer(event, 'chunked');
      break;
    case 'pi_ws_auth_failed':
      authPending = false;
      appendSystem(
        `Authentication failed: ${event.status ?? '401 Unauthorized'}`,
      );
      break;
    case 'pi_ws_auth_required':
      authPending = true;
      setConnectionState('auth-required');
      appendSystem('Server requested WebSocket auth.');
      if (authTokenInput.value.trim() !== '') {
        sendAuthMessage();
      }
      break;
    case 'pi_ws_error':
      appendSystem(`Bridge error: ${event.message}`);
      break;
    case 'pi_ws_ready':
      piReady = true;
      activeSessionId = event.sessionId ?? '';
      authPending = false;
      renderSessionInfo(event);
      setConnectionState('ready');
      appendSystem(
        `Session ready: ${event.sessionId ?? '(missing session id)'}`,
      );
      if (event.artifactDir) {
        appendSystem(`Artifact directory: ${event.artifactDir}`);
      }
      if (event.sandboxCwd) {
        appendSystem(`Sandbox cwd: ${event.sandboxCwd}`);
      }
      sendCommand({ id: nextRequestId(), type: 'get_state' });
      break;
    case 'pi_ws_session':
      activeSessionId = event.sessionId ?? '';
      renderSessionInfo(event);
      setConnectionState(authPending ? 'auth-required' : 'connected');
      appendSystem(
        `Socket session: ${event.sessionId ?? '(missing session id)'}`,
      );
      break;
    case 'pi_ws_stderr':
      appendSystem(`Pi stderr: ${event.data}`);
      break;
    case 'response':
      handleResponse(event);
      break;
    case 'agent_start':
      break;
    case 'message_update':
      handleMessageUpdate(event);
      break;
    case 'message_end':
      handleMessageEnd(event);
      break;
    case 'agent_end':
      if (!activeAssistantMessage) renderAgentEnd(event);
      break;
    case 'tool_execution_start':
      appendSystem(`Tool started: ${event.toolName}`);
      break;
    case 'tool_execution_end':
      appendSystem(`Tool finished: ${event.toolName}`);
      break;
    default:
      break;
  }
}

function handleBinaryFrame(data) {
  if (!(data instanceof ArrayBuffer)) {
    appendSystem('Received non-ArrayBuffer binary frame.');
    return;
  }

  if (!pendingArtifact) {
    logEvent({
      type: 'pi_ws_unexpected_binary',
      size: data.byteLength,
    });
    appendSystem(`Unexpected binary frame (${data.byteLength} bytes).`);
    return;
  }

  const bytes = new Uint8Array(data);
  pendingArtifact.chunks.push(bytes);
  pendingArtifact.receivedBytes += bytes.byteLength;

  logEvent({
    type: 'pi_ws_binary_frame',
    artifactId: pendingArtifact.id,
    size: bytes.byteLength,
  });

  if (pendingArtifact.mode === 'single') {
    finalizeArtifactTransfer(pendingArtifact.id);
  }
}

function handleResponse(event) {
  if (event.success === false) {
    appendSystem(`Command failed: ${event.error ?? 'unknown error'}`);
  }
}

function handleMessageUpdate(event) {
  const assistantEvent = event.assistantMessageEvent;
  if (assistantEvent?.type !== 'text_delta') return;

  activeAssistantMessage ??= appendMessage('assistant', '');
  pendingAssistantDelta += assistantEvent.delta ?? '';
  scheduleAssistantRender();
}

function handleMessageEnd(event) {
  if (event.message?.role !== 'assistant') return;

  const text = extractMessageText(event.message);
  if (text === '') return;

  activeAssistantMessage ??= appendMessage('assistant', '');
  activeAssistantText = text;
  pendingAssistantDelta = '';
  activeAssistantMessage.textContent = text;
  scheduleMessagesScroll();
}

function renderAgentEnd(event) {
  const assistant = event.messages?.findLast?.(
    (message) => message?.role === 'assistant',
  );
  const text = extractMessageText(assistant);

  if (text !== '') {
    activeAssistantMessage = appendMessage('assistant', text);
    activeAssistantText = text;
    pendingAssistantDelta = '';
  }
}

function prepareArtifactTransfer(event, mode) {
  pendingArtifact = {
    chunks: [],
    expectedBytes: event.size ?? 0,
    id: event.id,
    metadata: event,
    mode,
    receivedBytes: 0,
  };
  appendSystem(
    `Receiving artifact: ${event.relativePath ?? event.name} (${event.mimeType}, ${event.size} bytes)`,
  );
}

function finalizeArtifactTransfer(id) {
  if (!pendingArtifact || pendingArtifact.id !== id) return;

  if (pendingArtifact.receivedBytes < pendingArtifact.expectedBytes) {
    appendSystem(
      `Artifact ${pendingArtifact.metadata.name} is incomplete (${pendingArtifact.receivedBytes}/${pendingArtifact.expectedBytes} bytes).`,
    );
    return;
  }

  const payload = concatChunks(
    pendingArtifact.chunks,
    pendingArtifact.receivedBytes,
  );
  const blob = new Blob([payload], {
    type: pendingArtifact.metadata.mimeType,
  });

  appendArtifact({
    blob,
    bytes: payload,
    metadata: pendingArtifact.metadata,
  });
  logEvent({
    type: 'pi_ws_artifact_complete',
    id: pendingArtifact.id,
    name: pendingArtifact.metadata.name,
    size: pendingArtifact.receivedBytes,
  });
  pendingArtifact = undefined;
}

function appendArtifact({ blob, bytes, metadata }) {
  const container = document.createElement('article');
  container.className = 'message assistant artifact';

  const card = document.createElement('div');
  card.className = 'artifact-card';

  const title = document.createElement('strong');
  title.textContent = metadata.relativePath ?? metadata.name;
  card.append(title);

  const meta = document.createElement('p');
  meta.className = 'artifact-meta';
  meta.textContent = `${metadata.mimeType} • ${metadata.size} bytes`;
  card.append(meta);

  const url = URL.createObjectURL(blob);
  artifactUrls.add(url);
  container.dataset.objectUrl = url;
  const preview = renderArtifactPreview({
    bytes,
    metadata,
    url,
  });
  if (preview) {
    card.append(preview);
  }

  const link = document.createElement('a');
  link.href = url;
  link.download = metadata.name ?? 'artifact';
  link.rel = 'noreferrer';
  link.target = '_blank';
  link.textContent = metadata.mimeType?.startsWith('image/')
    ? 'Open full image'
    : 'Download artifact';
  card.append(link);

  container.append(card);
  messages.append(container);
  trimMessages();
  scheduleMessagesScroll();
}

function renderArtifactPreview({ bytes, metadata, url }) {
  const mimeType = metadata.mimeType ?? '';

  if (mimeType.startsWith('image/')) {
    const image = document.createElement('img');
    image.alt = metadata.name;
    image.loading = 'lazy';
    image.src = url;
    return image;
  }

  if (mimeType === 'application/pdf') {
    const frame = document.createElement('iframe');
    frame.className = 'artifact-frame';
    frame.loading = 'lazy';
    frame.src = url;
    frame.title = metadata.name ?? 'PDF artifact';
    return frame;
  }

  if (mimeType.startsWith('audio/')) {
    const audio = document.createElement('audio');
    audio.className = 'artifact-media';
    audio.controls = true;
    audio.src = url;
    return audio;
  }

  if (mimeType.startsWith('video/')) {
    const video = document.createElement('video');
    video.className = 'artifact-media';
    video.controls = true;
    video.preload = 'metadata';
    video.src = url;
    return video;
  }

  if (isCsvArtifact(metadata, mimeType)) {
    const csvText = decodeLimitedText({
      bytes,
      maxBytes: CSV_PREVIEW_MAX_BYTES,
    });
    const csvPreview =
      csvText === undefined
        ? undefined
        : buildCsvTable({
            text: csvText,
            truncatedByBytes: bytes.byteLength > CSV_PREVIEW_MAX_BYTES,
          });
    if (csvPreview) return csvPreview;
  }

  const decodedText = decodeArtifactText({ bytes, mimeType });
  if (decodedText !== undefined) {
    const pre = document.createElement('pre');
    pre.className = 'artifact-text';
    pre.textContent = decodedText;
    return pre;
  }

  return buildBinarySummary(bytes);
}

function isCsvArtifact(metadata, mimeType) {
  const name = `${metadata.relativePath ?? metadata.name ?? ''}`.toLowerCase();
  return mimeType === 'text/csv' || name.endsWith('.csv');
}

function decodeArtifactText({ bytes, mimeType }) {
  if (!isTextLikeMimeType(mimeType)) {
    return undefined;
  }

  try {
    const text = new TextDecoder().decode(bytes);
    if (mimeType === 'application/json') {
      try {
        return JSON.stringify(JSON.parse(text), null, 2).slice(0, 4000);
      } catch {
        return text.slice(0, TEXT_PREVIEW_MAX_CHARS);
      }
    }
    return text.slice(0, TEXT_PREVIEW_MAX_CHARS);
  } catch {
    return undefined;
  }
}

function decodeLimitedText({ bytes, maxBytes }) {
  try {
    return new TextDecoder().decode(bytes.slice(0, maxBytes));
  } catch {
    return undefined;
  }
}

function buildCsvTable({ text, truncatedByBytes }) {
  const { rows, truncatedByRows } = parseCsvPreview(text);
  if (rows.length === 0) return undefined;

  const columnCount = Math.min(
    MAX_CSV_COLUMNS,
    Math.max(...rows.map((row) => row.length)),
  );
  if (columnCount === 0) return undefined;

  const wrapper = document.createElement('div');
  wrapper.className = 'artifact-table-wrap';

  const table = document.createElement('table');
  table.className = 'artifact-table';

  const head = table.createTHead();
  const headRow = head.insertRow();
  for (let column = 0; column < columnCount; column += 1) {
    headRow.append(createCsvCell('th', rows[0]?.[column] ?? ''));
  }

  const body = table.createTBody();
  for (const row of rows.slice(1, MAX_CSV_ROWS + 1)) {
    const bodyRow = body.insertRow();
    for (let column = 0; column < columnCount; column += 1) {
      bodyRow.append(createCsvCell('td', row[column] ?? ''));
    }
  }

  wrapper.append(table);

  if (truncatedByRows || truncatedByBytes || columnCount === MAX_CSV_COLUMNS) {
    const note = document.createElement('p');
    note.className = 'artifact-table-note';
    note.textContent = `Preview limited to ${MAX_CSV_ROWS} rows, ${MAX_CSV_COLUMNS} columns, and ${Math.round(CSV_PREVIEW_MAX_BYTES / 1024)} KiB. Download the artifact for the full CSV.`;
    wrapper.append(note);
  }

  return wrapper;
}

function parseCsvPreview(text) {
  const rows = [];
  let currentField = '';
  let currentRow = [];
  let index = 0;
  let quoted = false;
  let truncatedByRows = false;
  const maxRowsWithHeader = MAX_CSV_ROWS + 1;

  while (index < text.length) {
    if (rows.length >= maxRowsWithHeader) {
      truncatedByRows = true;
      break;
    }

    const char = text[index];

    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        currentField += '"';
        index += 2;
        continue;
      }
      if (char === '"') {
        quoted = false;
        index += 1;
        continue;
      }
      currentField += char;
      index += 1;
      continue;
    }

    if (char === '"' && currentField === '') {
      quoted = true;
      index += 1;
      continue;
    }

    if (char === ',') {
      currentRow.push(currentField);
      currentField = '';
      index += 1;
      continue;
    }

    if (char === '\n' || char === '\r') {
      currentRow.push(currentField);
      rows.push(currentRow);
      currentField = '';
      currentRow = [];
      if (char === '\r' && text[index + 1] === '\n') {
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }

    currentField += char;
    index += 1;
  }

  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return {
    rows,
    truncatedByRows,
  };
}

function createCsvCell(tagName, value) {
  const cell = document.createElement(tagName);
  cell.textContent = truncateCsvCell(value);
  return cell;
}

function truncateCsvCell(value) {
  return value.length > MAX_CSV_CELL_CHARS
    ? `${value.slice(0, MAX_CSV_CELL_CHARS)}...`
    : value;
}

function isTextLikeMimeType(mimeType) {
  return (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'application/javascript' ||
    mimeType === 'image/svg+xml'
  );
}

function buildBinarySummary(bytes) {
  const wrapper = document.createElement('div');
  wrapper.className = 'artifact-binary';

  const heading = document.createElement('p');
  heading.className = 'artifact-binary-heading';
  heading.textContent = 'Binary preview';
  wrapper.append(heading);

  const signature = document.createElement('code');
  signature.className = 'artifact-signature';
  signature.textContent = formatBytePreview(bytes.slice(0, 24));
  wrapper.append(signature);

  return wrapper;
}

function formatBytePreview(bytes) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join(
    ' ',
  );
}

function concatChunks(chunks, totalBytes) {
  const merged = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return merged;
}

function extractMessageText(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
}

function appendMessage(kind, text) {
  const element = document.createElement('article');
  element.className = `message ${kind}`;
  element.textContent = text;
  messages.append(element);
  trimMessages();
  scheduleMessagesScroll();
  return element;
}

function appendSystem(text) {
  appendMessage('system', text);
}

function renderSessionInfo(event = undefined) {
  if (!sessionInfo) return;

  if (!event) {
    sessionInfo.hidden = true;
    sessionInfo.textContent = '';
    return;
  }

  sessionInfo.hidden = false;
  sessionInfo.replaceChildren(
    buildSessionInfoRow('Session', event.sessionId ?? '(missing)'),
    buildSessionInfoRow('Connection', event.connectionId ?? '(missing)'),
    buildSessionInfoRow('Artifacts', event.artifactDir ?? '(disabled)'),
    buildSessionInfoRow('Sandbox cwd', event.sandboxCwd ?? '(unset)'),
  );
}

function buildSessionInfoRow(label, value) {
  const row = document.createElement('p');
  row.className = 'session-info-row';

  const labelNode = document.createElement('span');
  labelNode.className = 'session-info-label';
  labelNode.textContent = label;

  const valueNode = document.createElement('code');
  valueNode.textContent = value;

  row.append(labelNode, valueNode);
  return row;
}

function logEvent(event) {
  eventLogEntries.push(JSON.stringify(event, null, 2));
  if (eventLogEntries.length > MAX_EVENT_LOG_ENTRIES) {
    eventLogEntries = eventLogEntries.slice(-MAX_EVENT_LOG_ENTRIES);
  }
  scheduleEventLogRender();
}

function parseEvent(data) {
  try {
    return JSON.parse(data);
  } catch {
    return { type: 'invalid_json', data };
  }
}

function setConnectionState(state) {
  connectButton.textContent =
    state === 'disconnected' || state === 'connecting'
      ? 'Connect'
      : 'Disconnect';
  sendButton.disabled = !piReady;
  abortButton.disabled = !piReady;
  authenticateButton.disabled = !authPending;

  switch (state) {
    case 'connecting':
      status.textContent = 'Connecting...';
      break;
    case 'connected':
      status.textContent =
        activeSessionId === ''
          ? 'Connected. Waiting for Pi route readiness.'
          : `Connected. Session ${activeSessionId} is waiting for Pi readiness.`;
      break;
    case 'auth-required':
      status.textContent =
        activeSessionId === ''
          ? 'Connected. Waiting for authentication.'
          : `Connected. Session ${activeSessionId} is waiting for authentication.`;
      break;
    case 'ready':
      status.textContent =
        activeSessionId === ''
          ? 'Connected. Pi RPC process is ready.'
          : `Connected. Session ${activeSessionId} is ready.`;
      break;
    default:
      status.textContent = 'Disconnected';
      break;
  }
}

function scheduleAssistantRender() {
  if (assistantRenderScheduled) return;
  assistantRenderScheduled = true;

  requestAnimationFrame(() => {
    assistantRenderScheduled = false;
    if (!activeAssistantMessage || pendingAssistantDelta === '') {
      return;
    }

    activeAssistantText += pendingAssistantDelta;
    pendingAssistantDelta = '';
    activeAssistantMessage.textContent = activeAssistantText;
    scheduleMessagesScroll();
  });
}

function scheduleEventLogRender() {
  if (eventLogRenderScheduled) return;
  eventLogRenderScheduled = true;

  requestAnimationFrame(() => {
    eventLogRenderScheduled = false;
    events.textContent = eventLogEntries.join('\n\n');
    events.scrollTop = events.scrollHeight;
  });
}

function scheduleMessagesScroll() {
  if (scrollMessagesScheduled) return;
  scrollMessagesScheduled = true;

  requestAnimationFrame(() => {
    scrollMessagesScheduled = false;
    messages.scrollTop = messages.scrollHeight;
  });
}

function trimMessages() {
  while (messages.children.length > MAX_MESSAGE_NODES) {
    const oldest = messages.firstElementChild;
    if (!(oldest instanceof HTMLElement)) {
      break;
    }
    cleanupArtifactElement(oldest);
    oldest.remove();
  }
}

function cleanupArtifactElement(element) {
  const objectUrl = element.dataset.objectUrl;
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    artifactUrls.delete(objectUrl);
  }
}

function releaseArtifactUrls() {
  for (const url of artifactUrls) {
    URL.revokeObjectURL(url);
  }
  artifactUrls = new Set();
}

function sendAuthMessage() {
  if (socket?.readyState !== WebSocket.OPEN) {
    appendSystem('Not connected.');
    return;
  }

  const token = authTokenInput.value.trim();
  if (token === '') {
    appendSystem('Enter an auth token before authenticating.');
    return;
  }

  authPending = true;
  status.textContent = 'Connected. Authenticating...';
  socket.send(
    JSON.stringify({
      type: 'pi_ws_auth',
      token,
    }),
  );
}

function nextRequestId() {
  requestNumber += 1;
  return `chat-${requestNumber}`;
}

function defaultWebSocketUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/pi`;
}
