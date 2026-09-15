import { HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { isConnectionAbortedError, onRouteError } from 'src/utils/logger.js';

const newMockLogger = () =>
  ({
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    log: vi.fn(),
    verbose: vi.fn(),
    setContext: vi.fn(),
  }) as unknown as LoggingRepository;

const newMockRequest = (overrides: Partial<Request> = {}) =>
  ({ destroyed: false, complete: true, ...overrides }) as unknown as Request;

const newMockResponse = (overrides: Partial<Response> = {}) =>
  ({ headersSent: false, ...overrides }) as unknown as Response;

describe('onRouteError', () => {
  it('should log HttpException at debug level with status and response', () => {
    const logger = newMockLogger();
    const exception = new HttpException('Not Found', HttpStatus.NOT_FOUND);

    onRouteError(newMockRequest(), newMockResponse(), exception, logger);

    expect(logger.debug).toHaveBeenCalledOnce();
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('HttpException(404)'));
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Not Found'));
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('should log HttpException with object response body', () => {
    const logger = newMockLogger();
    const exception = new HttpException({ message: 'Validation failed', errors: ['field required'] }, 422);

    onRouteError(newMockRequest(), newMockResponse(), exception, logger);

    expect(logger.debug).toHaveBeenCalledOnce();
    const message = (logger.debug as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(message).toContain('HttpException(422)');
    expect(message).toContain('Validation failed');
  });

  it('should log aborted requests at debug level', () => {
    const logger = newMockLogger();
    const error = new Error('socket hang up');

    onRouteError(newMockRequest({ destroyed: true, complete: false }), newMockResponse(), error, logger);

    expect(logger.debug).toHaveBeenCalledOnce();
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Client aborted request'));
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('should log generic Error at error level with message and stack', () => {
    const logger = newMockLogger();
    const error = new Error('something broke');

    onRouteError(newMockRequest(), newMockResponse(), error, logger);

    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Unknown error'), error.stack);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('something broke'), expect.any(String));
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('should include the stack trace for generic errors', () => {
    const logger = newMockLogger();
    const error = new Error('stack test');

    onRouteError(newMockRequest(), newMockResponse(), error, logger);

    const stackArg = (logger.error as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(stackArg).toContain('stack test');
  });

  it('should handle an Error subclass that is not HttpException', () => {
    const logger = newMockLogger();

    class CustomError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'CustomError';
      }
    }

    const error = new CustomError('custom failure');

    onRouteError(newMockRequest(), newMockResponse(), error, logger);

    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Unknown error'), expect.any(String));
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('should handle HttpException with various status codes', () => {
    const logger = newMockLogger();

    for (const status of [400, 401, 403, 500]) {
      const exception = new HttpException('error', status);
      onRouteError(newMockRequest(), newMockResponse(), exception, logger);
    }

    expect(logger.debug).toHaveBeenCalledTimes(4);
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('isConnectionAbortedError', () => {
  it('should return true for ECONNABORTED error code', () => {
    const error = { code: 'ECONNABORTED' };
    expect(isConnectionAbortedError(error)).toBe(true);
  });

  it('should return false for other error codes', () => {
    const error = { code: 'ECONNRESET' };
    expect(isConnectionAbortedError(error)).toBe(false);
  });

  it('should return false for errors without a code', () => {
    const error = new Error('test');
    expect(isConnectionAbortedError(error)).toBe(false);
  });
});
