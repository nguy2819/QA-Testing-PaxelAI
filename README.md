***This is an express/node app with Xvfb, x11vnc, websockify, noVNC UI, WebSocket tunnel, and Docker startup order.****

*Rescue-rebuild* is the current safe recovery branch

## Architect:
- Xvfb -> fluxbox -> x11vnc -> websockify -> Node.
- Frontend -> fetch('/api/bugs') -> server -> Postgres

**Render Web Service (Docker) + Render Postgres.**
User Render Postgres for backend persistent storage.

Node/Express = public HTTP server
x11vnc, websockify = internal only
Node has to bind into PORT of Render; web service is 10000.

**Run docker local:**
- docker build -t paxel-qa-demo .
- docker ps
- docker stop container_id
- docker run --rm -p 3010:3001 -p 6090:6080 -p 5910:5900 paxel-qa-demo

How to check what container_id docker is running by type **"docker ps"** on terminal.

Want to check what container that we already stopped - type **"docker ps -a"**

If you *met an error "/app/docker/start.sh: line 1: $'\r': command not found"* - meaning file start.sh is under CRLF (you can see on the bottom right on VScode) - it needs to be under LF.
Fix this error by **typing "docker/start.sh" -> change from CRLF to LF.** so Linux container can execute it

