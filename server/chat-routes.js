import { readBody, sendJson } from './http-utils.js';
import { submitDesktopFollowerUserInput as defaultSubmitDesktopFollowerUserInput } from './desktop-ipc-client.js';
import { normalizeDesktopUserInputSubmission } from './user-input-requests.js';

export function createChatRouteHandler({
  chatService,
  remoteAddress = () => '',
  submitDesktopFollowerUserInput = defaultSubmitDesktopFollowerUserInput
}) {
  if (!chatService) {
    throw new Error('createChatRouteHandler requires chatService');
  }

  return async function handleChatApi(req, res, url) {
    const method = req.method || 'GET';
    const pathname = url.pathname;
    const parts = pathname.split('/').filter(Boolean);

    if (!pathname.startsWith('/api/chat/')) {
      return false;
    }

    if (method === 'GET' && parts.length === 4 && parts[0] === 'api' && parts[1] === 'chat' && parts[2] === 'turns') {
      const turnId = decodeURIComponent(parts[3]);
      sendJson(res, 200, { turn: chatService.getTurn(turnId) });
      return true;
    }

    if (method === 'GET' && pathname === '/api/chat/queue') {
      sendJson(res, 200, chatService.listQueue({
        sessionId: url.searchParams.get('sessionId') || '',
        draftSessionId: url.searchParams.get('draftSessionId') || ''
      }));
      return true;
    }

    if (method === 'DELETE' && pathname === '/api/chat/queue') {
      const body = await readBody(req);
      const draft = chatService.removeQueuedDraft(body);
      sendJson(res, draft ? 200 : 404, { success: Boolean(draft), draft });
      return true;
    }

    if (method === 'POST' && pathname === '/api/chat/queue/restore') {
      const body = await readBody(req);
      const draft = chatService.restoreQueuedDraft(body);
      sendJson(res, draft ? 200 : 404, { success: Boolean(draft), draft });
      return true;
    }

    if (method === 'POST' && pathname === '/api/chat/queue/steer') {
      const body = await readBody(req);
      try {
        const result = await chatService.steerQueuedDraft(body);
        sendJson(res, result ? 202 : 404, result || { error: 'Queued draft not found' });
      } catch (error) {
        sendJson(res, error.statusCode || 500, { error: error.message || 'Failed to steer queued draft' });
      }
      return true;
    }

    if (method === 'POST' && pathname === '/api/chat/send') {
      const body = await readBody(req);
      try {
        const result = await chatService.sendChat(body, { remoteAddress: remoteAddress(req) });
        sendJson(res, 202, result);
      } catch (error) {
        sendJson(res, error.statusCode || 500, { error: error.message || 'Failed to send chat' });
      }
      return true;
    }

    if (method === 'POST' && pathname === '/api/chat/user-input/respond') {
      const body = await readBody(req);
      try {
        const result = chatService.respondToUserInput(body);
        if (result.ok) {
          sendJson(res, 200, { accepted: true });
          return true;
        }
        const desktopSubmission = normalizeDesktopUserInputSubmission(body);
        if (desktopSubmission) {
          const { conversationId, ...request } = desktopSubmission;
          await submitDesktopFollowerUserInput(conversationId, request);
          sendJson(res, 200, { accepted: true, delivery: 'desktop-ipc' });
          return true;
        }
        sendJson(res, 404, { error: 'User input request not found' });
      } catch (error) {
        sendJson(res, error.statusCode || 500, { error: error.message || 'Failed to submit user input' });
      }
      return true;
    }

    if (method === 'POST' && pathname === '/api/chat/abort') {
      const body = await readBody(req);
      try {
        const aborted = await chatService.abortChat(body, { remoteAddress: remoteAddress(req) });
        sendJson(res, aborted ? 200 : 404, { aborted });
      } catch (error) {
        sendJson(res, error.statusCode || 500, { error: error.message || 'Failed to abort chat' });
      }
      return true;
    }

    sendJson(res, 404, { error: 'Chat API route not found' });
    return true;
  };
}
