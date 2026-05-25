# Docker images

No Dockerfile is checked in yet. Worker and control-plane images can be added here when container-based deployment replaces zip/VM flows.

Suggested layout:

```
deploy/docker/
  worker/Dockerfile
  control-plane/Dockerfile
```

Use multi-stage builds (build in one stage, copy runtime artifacts into a slim base image).
