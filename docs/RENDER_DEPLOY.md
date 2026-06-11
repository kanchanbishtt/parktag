# Render Deploy

This is the minimum deployment setup for the WaveTag prototype.

## Service

- provider: `Render`
- runtime: `Node`
- build command: `npm install`
- start command: `npm start`
- health check path: `/api/health`

## Environment Variables

Set these in Render:

- `MONGODB_URI`
- `MONGODB_DB_NAME`

Recommended value:

- `MONGODB_DB_NAME=wavetag`

## Files

- `render.yaml` contains the basic Render service definition
- `.env.example` shows the same variables for local development

## First Deploy Checklist

1. Create a new Render web service from this repo.
2. Confirm Render picks up:
   - build command: `npm install`
   - start command: `npm start`
3. Add `MONGODB_URI`.
4. Add `MONGODB_DB_NAME=wavetag`.
5. Deploy.
6. Verify:
   - `/api/health`
   - `/api/runtime/status`
   - `/`
7. Seed demo data through the verification page or `POST /api/demo/seed`.

## Notes

- The current prototype is designed to run from `npm start`.
- The current root page is a verification surface, not the final scanner UI.
