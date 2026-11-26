// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from 'vitest';
import { AppError, fromZod } from '../src/lib/errors.js';
import { z } from 'zod';
import { makeApp } from './helpers/app.js';

const apps: ReturnType<typeof makeApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('the error envelope', () => {
  it('serializes an AppError to {error:{code,message,hint}} with hint present', () => {
    const app = makeApp();
    apps.push(app);
    app.get('/explode', async () => {
      throw new AppError('board_not_found');
    });

    return app.inject({ method: 'GET', url: '/explode' }).then((response) => {
      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body).toEqual({
        error: { code: 'board_not_found', message: 'Board not found.', hint: null },
      });
      expect('hint' in body.error).toBe(true);
    });
  });

  it('turns a Zod failure into validation_failed with details[]', async () => {
    const app = makeApp();
    apps.push(app);
    const schema = z.object({ title: z.string().min(1) });
    app.post('/validate', async (request) => {
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) throw fromZod(parsed.error);
      return parsed.data;
    });

    const response = await app.inject({ method: 'POST', url: '/validate', payload: { title: '' } });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details[0].path).toBe('title');
  });

  it('answers an unknown route with the same envelope', async () => {
    const app = makeApp();
    apps.push(app);
    const response = await app.inject({ method: 'GET', url: '/nothing-here' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('not_found');
    expect(response.headers['x-request-id']).toBeDefined();
  });
});
