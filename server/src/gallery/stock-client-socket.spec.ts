import { Socket } from 'socket.io';
import { EventRepository } from 'src/repositories/event.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { WebsocketRepository } from 'src/repositories/websocket.repository.js';

const newSocket = (headers: Record<string, string>, auth: Record<string, unknown> = {}) => {
  const rooms = new Set<string>(['socket-id']);
  return {
    id: 'socket-id',
    handshake: { headers, auth },
    rooms,
    join: vitest.fn((room: string | string[]) => {
      for (const name of [room].flat()) {
        rooms.add(name);
      }
    }),
    emit: vitest.fn(),
    disconnect: vitest.fn(),
  };
};

const newServer = () => {
  const emitted: Array<{ target: string; args: unknown[] }> = [];
  const operator = (target: string): any => ({
    to: (room: string) => operator(`${target} to(${room})`),
    except: (room: string) => operator(`${target} except(${room})`),
    emit: (...args: unknown[]) => {
      emitted.push({ target, args });
    },
  });
  return { server: operator('server'), emitted };
};

describe(WebsocketRepository.name, () => {
  let sut: WebsocketRepository;

  beforeEach(() => {
    const eventRepository = { emit: vitest.fn() } as unknown as EventRepository;
    const logger = { setContext: vitest.fn(), log: vitest.fn(), error: vitest.fn() } as unknown as LoggingRepository;
    sut = new WebsocketRepository(eventRepository, logger);
    sut.setAuthFn(() => Promise.resolve({ user: { id: 'user-1' }, session: { id: 'session-1' } } as any));
  });

  describe('handleConnection', () => {
    it('puts stock Immich app sockets in the stock rooms', async () => {
      const socket = newSocket({ 'user-agent': 'immich-android/3.3.1' });
      await sut.handleConnection(socket as unknown as Socket);
      expect(socket.rooms).toEqual(
        new Set([
          'socket-id',
          'user-1',
          'session-1',
          'stock-immich-client',
          'stock-immich-client:user-1',
          'stock-immich-client:session-1',
        ]),
      );
    });

    it.each([
      ['a Gallery app', { 'user-agent': 'immich-ios/5.4.0' }, {}],
      ['the Gallery web', { 'user-agent': 'Mozilla/5.0' }, { 'x-gallery-app': '5.4.0' }],
    ])('keeps %s out of the stock rooms', async (_, headers, auth) => {
      const socket = newSocket(headers, auth);
      await sut.handleConnection(socket as unknown as Socket);
      expect(socket.rooms).toEqual(new Set(['socket-id', 'user-1', 'session-1']));
    });
  });

  describe('clientSendByClient', () => {
    it('sends each client class its own payload', () => {
      const { server, emitted } = newServer();
      (sut as any).server = server;
      sut.clientSendByClient('on_user_delete', 'user-1', ['gallery'], ['stock']);
      expect(emitted).toEqual([
        { target: 'server except(stock-immich-client) to(user-1)', args: ['on_user_delete', 'gallery'] },
        { target: 'server to(stock-immich-client:user-1)', args: ['on_user_delete', 'stock'] },
      ]);
    });

    it('broadcasts to Gallery clients only when no stock payload is given', () => {
      const { server, emitted } = newServer();
      (sut as any).server = server;
      sut.clientSendByClient('on_user_delete', undefined, ['gallery']);
      expect(emitted).toEqual([{ target: 'server except(stock-immich-client)', args: ['on_user_delete', 'gallery'] }]);
    });
  });
});
