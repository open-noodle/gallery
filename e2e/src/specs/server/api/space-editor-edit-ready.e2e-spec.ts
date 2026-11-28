import { io, Socket } from 'socket.io-client';
import { authHeaders, buildSpaceContext, SpaceContext } from 'src/actors';
import { app, asBearerAuth, baseUrl, utils } from 'src/utils';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type EditReady = { asset: { id: string; isFavorite: boolean }; edit: unknown[] };

const connectGallerySocket = (token: string): Promise<Socket> => {
  const socket = io(baseUrl, {
    path: '/api/socket.io',
    transports: ['websocket'],
    extraHeaders: asBearerAuth(token),
    auth: { 'x-gallery-app': 'e2e' },
    forceNew: true,
    autoConnect: false,
  });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.disconnect();
      reject(new Error('Gallery socket did not connect'));
    }, 10_000);
    socket.once('connect', () => {
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timeout);
      socket.disconnect();
      reject(error);
    });
    socket.connect();
  });
};

const waitForEdit = (socket: Socket, assetId: string): Promise<EditReady> =>
  new Promise((resolve, reject) => {
    const receive = (data: EditReady) => {
      if (data.asset.id === assetId) {
        clearTimeout(timeout);
        socket.off('AssetEditReadyV2', receive);
        resolve(data);
      }
    };
    const timeout = setTimeout(() => {
      socket.off('AssetEditReadyV2', receive);
      reject(new Error(`No AssetEditReadyV2 for ${assetId}`));
    }, 10_000);
    socket.on('AssetEditReadyV2', receive);
  });

describe('Space editor receives edit completion (#1321)', () => {
  let ctx: SpaceContext;
  let owner: Socket;
  let editor: Socket;
  let stockEditor: Socket;
  let viewer: Socket;
  const stockEvents: EditReady[] = [];
  const viewerEvents: EditReady[] = [];
  const rotate = { edits: [{ action: 'rotate', parameters: { angle: 90 } }] };
  const adjust = { exposure: 20, contrast: 0, saturation: 0, invert: false };

  beforeAll(async () => {
    await utils.resetDatabase();
    ctx = await buildSpaceContext();
    owner = await utils.connectWebsocket(ctx.spaceOwner.token!);
    editor = await connectGallerySocket(ctx.spaceEditor.token!);
    stockEditor = await utils.connectWebsocket(ctx.spaceEditor.token!);
    viewer = await connectGallerySocket(ctx.spaceViewer.token!);
    stockEditor.on('AssetEditReadyV2', (event: EditReady) => {
      stockEvents.push(event);
    });
    viewer.on('AssetEditReadyV2', (event: EditReady) => {
      viewerEvents.push(event);
    });
  }, 30_000);

  afterAll(() => {
    for (const socket of [owner, editor, stockEditor, viewer]) {
      socket?.disconnect();
    }
  });

  const save = async (id: string, path: string, body?: object) => {
    const pendingOwner = waitForEdit(owner, id);
    const pendingEditor = waitForEdit(editor, id);
    const operation = body ? request(app).put(path).send(body) : request(app).delete(path);
    const [response, ownerReady, editorReady] = await Promise.all([
      operation.set(authHeaders(ctx.spaceEditor)),
      pendingOwner,
      pendingEditor,
    ]);
    expect(response.status, JSON.stringify(response.body)).toBe(body ? 200 : 204);
    expect(ownerReady.asset).toMatchObject({ id, isFavorite: true });
    expect(editorReady.asset).toMatchObject({ id, isFavorite: false });
    return editorReady;
  };

  it.each([
    { endpoint: 'edits', body: rotate, reset: false },
    { endpoint: 'edits', body: rotate, reset: true },
    { endpoint: 'adjust', body: adjust, reset: false },
    { endpoint: 'adjust', body: adjust, reset: true },
  ])(
    '$endpoint reset=$reset acknowledges the initiating Gallery editor',
    async ({ endpoint, body, reset }) => {
      const asset = await utils.createAsset(ctx.spaceOwner.token!);
      await utils.waitForWebsocketEvent({ event: 'assetUpload', id: asset.id });
      await utils.addSpaceAssets(ctx.spaceOwner.token!, ctx.spaceId, [asset.id]);
      const favorite = await request(app)
        .put('/assets/favorites')
        .set(asBearerAuth(ctx.spaceOwner.token!))
        .send({ ids: [asset.id], isFavorite: true });
      expect(favorite.status).toBe(204);
      const path = `/assets/${asset.id}/${endpoint}`;
      await save(asset.id, path, body);
      if (reset) {
        const ready = await save(asset.id, path);
        if (endpoint === 'edits') {
          expect(ready.edit).toEqual([]);
        }
      }
      // Allow the independent stock/viewer connections to drain after the positive deliveries.
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(stockEvents.filter((event) => event.asset.id === asset.id)).toEqual([]);
      expect(viewerEvents.filter((event) => event.asset.id === asset.id)).toEqual([]);
    },
    30_000,
  );
});
