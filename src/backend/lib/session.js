const SESSION_COOKIE = "wavetag_session";

export function getSessionCookieName() {
  return SESSION_COOKIE;
}

export async function createSession(app, user) {
  const sessionId = `${user.role}_${user.id}`;

  app.sessions.set(sessionId, {
    id: sessionId,
    userId: user.id,
    role: user.role,
    email: user.email,
    displayName: user.displayName || null,
    createdAt: new Date().toISOString()
  });

  return sessionId;
}

export function readSession(app, request) {
  const sessionId = request.cookies[SESSION_COOKIE];

  if (!sessionId) {
    return null;
  }

  return app.sessions.get(sessionId) || null;
}

export function clearSession(app, request, reply) {
  const sessionId = request.cookies[SESSION_COOKIE];

  if (sessionId) {
    app.sessions.delete(sessionId);
  }

  reply.clearCookie(SESSION_COOKIE, {
    path: "/"
  });
}

export function writeSessionCookie(reply, sessionId) {
  reply.setCookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    path: "/",
    sameSite: "lax"
  });
}
