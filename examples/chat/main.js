const messages = document.querySelector('#messages');
const events = document.querySelector('#events');
const status = document.querySelector('#status');
const wsUrl = document.querySelector('#ws-url');
const connectButton = document.querySelector('#connect');
const composer = document.querySelector('#composer');
const promptInput = document.querySelector('#prompt');
const sendButton = document.querySelector('#send');
const abortButton = document.querySelector('#abort');

let socket;
let requestNumber = 0;
let activeAssistantMessage;

wsUrl.value = defaultWebSocketUrl();
setConnected(false);
appendSystem('Open the connection, then send a prompt.');

connectButton.addEventListener('click', () => {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.close();
    return;
  }

  connect();
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
  status.textContent = 'Connecting...';

  socket.addEventListener('open', () => {
    setConnected(true);
    appendSystem('Connected.');
    sendCommand({ id: nextRequestId(), type: 'get_state' });
  });

  socket.addEventListener('message', (event) => {
    const data = parseEvent(event.data);
    logEvent(data);
    handlePiEvent(data);
  });

  socket.addEventListener('close', (event) => {
    setConnected(false);
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

  socket.send(JSON.stringify(command));
}

function handlePiEvent(event) {
  if (!event || typeof event !== 'object') return;

  switch (event.type) {
    case 'pi_ws_ready':
      status.textContent = 'Connected. Pi RPC process is ready.';
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
      activeAssistantMessage = appendMessage('assistant', '');
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

function setConnected(connected) {
  connectButton.textContent = connected ? 'Disconnect' : 'Connect';
  sendButton.disabled = !connected;
  abortButton.disabled = !connected;
  status.textContent = connected ? 'Connected' : 'Disconnected';
}

function nextRequestId() {
  requestNumber += 1;
  return `chat-${requestNumber}`;
}

function defaultWebSocketUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/pi`;
}
