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

let socket;
let requestNumber = 0;
let activeAssistantMessage;
let piReady = false;
let authPending = false;

wsUrl.value = defaultWebSocketUrl();
setConnectionState('disconnected');
appendSystem('Open the connection, then send a prompt.');

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
  piReady = false;
  authPending = false;
  setConnectionState('connecting');

  socket.addEventListener('open', () => {
    setConnectionState('connected');
    appendSystem('Connected.');
  });

  socket.addEventListener('message', (event) => {
    const data = parseEvent(event.data);
    logEvent(data);
    handlePiEvent(data);
  });

  socket.addEventListener('close', (event) => {
    piReady = false;
    authPending = false;
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
    case 'pi_ws_auth_required':
      authPending = true;
      setConnectionState('auth-required');
      appendSystem('Server requested WebSocket auth.');
      if (authTokenInput.value.trim() !== '') {
        sendAuthMessage();
      }
      break;
    case 'pi_ws_auth_failed':
      authPending = false;
      appendSystem(
        `Authentication failed: ${event.status ?? '401 Unauthorized'}`,
      );
      break;
    case 'pi_ws_ready':
      piReady = true;
      authPending = false;
      setConnectionState('ready');
      sendCommand({ id: nextRequestId(), type: 'get_state' });
      break;
    case 'pi_ws_error':
      appendSystem(`Bridge error: ${event.message}`);
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

function handleResponse(event) {
  if (event.success === false) {
    appendSystem(`Command failed: ${event.error ?? 'unknown error'}`);
  }
}

function handleMessageUpdate(event) {
  const assistantEvent = event.assistantMessageEvent;
  if (assistantEvent?.type !== 'text_delta') return;

  activeAssistantMessage ??= appendMessage('assistant', '');
  activeAssistantMessage.textContent += assistantEvent.delta ?? '';
  activeAssistantMessage.scrollIntoView({ block: 'end' });
}

function handleMessageEnd(event) {
  if (event.message?.role !== 'assistant') return;

  const text = extractMessageText(event.message);
  if (text === '') return;

  activeAssistantMessage ??= appendMessage('assistant', '');
  activeAssistantMessage.textContent = text;
}

function renderAgentEnd(event) {
  const assistant = event.messages?.findLast?.(
    (message) => message?.role === 'assistant',
  );
  const text = extractMessageText(assistant);

  if (text !== '') {
    activeAssistantMessage = appendMessage('assistant', text);
  }
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
  element.scrollIntoView({ block: 'end' });
  return element;
}

function appendSystem(text) {
  appendMessage('system', text);
}

function logEvent(event) {
  events.textContent += `${JSON.stringify(event, null, 2)}\n\n`;
  events.scrollTop = events.scrollHeight;
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
      status.textContent = 'Connected. Waiting for Pi route readiness.';
      break;
    case 'auth-required':
      status.textContent = 'Connected. Waiting for authentication.';
      break;
    case 'ready':
      status.textContent = 'Connected. Pi RPC process is ready.';
      break;
    default:
      status.textContent = 'Disconnected';
      break;
  }
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
