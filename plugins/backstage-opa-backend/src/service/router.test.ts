import { getVoidLogger } from '@backstage/backend-common';
import express from 'express';
import request from 'supertest';
import { createRouter } from './router';
import { ConfigReader } from '@backstage/config';
import fetch from 'node-fetch';

jest.mock('node-fetch');

const { Response: FetchResponse } = jest.requireActual('node-fetch');

describe('createRouter', () => {
  let app: express.Express;

  const config = new ConfigReader({
    opaClient: {
      baseUrl: 'http://localhost',
      policies: {
        entityChecker: {
          package: 'entitymeta_policy',
        },
        rbac: {
          package: 'rbac_policy',
        },
      },
    },
  });

  beforeAll(async () => {
    const router = await createRouter({
      logger: getVoidLogger(),
      config: config,
    });

    app = express().use(router);
    jest.resetAllMocks();
  });

  describe('GET /health', () => {
    it('returns ok', async () => {
      const res = await request(app).get('/health');

      expect(res.status).toEqual(200);
      expect(res.body).toEqual({ status: 'ok' });
    });
  });

  describe('Entity Checker Route', () => {
    const mockedPayload = {
      input: {
        metadata: {
          namespace: 'default',
          annotations: {
            'backstage.io/managed-by-location':
              'file:/brewed-backstage/examples/entities.yaml',
            'backstage.io/managed-by-origin-location':
              'file:/brewed-backstage/examples/entities.yaml',
          },
          name: 'example-website',
          uid: '762d5d68-7418-4b65-baa4-43d5e6cd591d',
          etag: '46e9e22027eb7c502df70e8c34a0285123bc8e01',
        },
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Component',
        spec: {
          type: 'website',
          lifecycle: 'experimental',
          owner: 'guests',
          system: 'examples',
          providesApis: ['example-grpc-api'],
        },
        relations: [
          {
            type: 'ownedBy',
            targetRef: 'group:default/guests',
            target: {
              kind: 'group',
              namespace: 'default',
              name: 'guests',
            },
          },
          {
            type: 'partOf',
            targetRef: 'system:default/examples',
            target: {
              kind: 'system',
              namespace: 'default',
              name: 'examples',
            },
          },
          {
            type: 'providesApi',
            targetRef: 'api:default/example-grpc-api',
            target: {
              kind: 'api',
              namespace: 'default',
              name: 'example-grpc-api',
            },
          },
        ],
      },
    };

    const mockedEntityResponse = {
      allow: true,
      is_system_present: true,
      violation: [
        {
          level: 'warning',
          message: 'You do not have any tags set!',
        },
      ],
    };

    it('POSTS and returns a response from OPA as expected', async () => {
      (fetch as jest.MockedFunction<typeof fetch>).mockImplementation(() => {
        return Promise.resolve(
          new FetchResponse(JSON.stringify(mockedEntityResponse), {
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      });

      const res = await request(app)
        .post('/entity-checker')
        .send(mockedPayload)
        .expect('Content-Type', /json/);

      expect(res.status).toEqual(200);
      expect(res.body).toEqual(mockedEntityResponse);
    });

    it('will complain if the OPA url is missing', async () => {
      const noBaseUrlConfig = new ConfigReader({
        opaClient: {
          baseUrl: undefined,
          policies: {
            entityChecker: {
              package: 'entitymeta_policy',
            },
            rbac: {
              package: 'rbac_policy',
            },
          },
        },
      });

      const router = await createRouter({
        logger: getVoidLogger(),
        config: noBaseUrlConfig,
      });

      const localApp = express().use(router);

      const res = await request(localApp)
        .post(`/entity-checker`)
        .send({ input: {} }); // send an empty input

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('OPA URL not set or missing!');
    });

    it('will complain if no entity checker package is set', async () => {
      const noEntityCheckerPackageConfig = new ConfigReader({
        opaClient: {
          baseUrl: 'http://localhost',
          policies: {
            entityChecker: {
              package: undefined,
            },
            rbac: {
              package: 'entitymeta_policy',
            },
          },
        },
      });

      const router = await createRouter({
        logger: getVoidLogger(),
        config: noEntityCheckerPackageConfig,
      });

      const localApp = express().use(router);

      const res = await request(localApp)
        .post(`/entity-checker`)
        .send({ input: {} });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(
        'OPA entity checker package not set or missing!',
      );
    });

    it('will return a 500 if OPA there is an issue sending the request to OPA', async () => {
      (fetch as jest.MockedFunction<typeof fetch>).mockImplementation(() => {
        return Promise.reject(new Error('OPA is not available'));
      });

      const res = await request(app)
        .post('/entity-checker')
        .send(mockedPayload)
        .expect('Content-Type', /json/);

      expect(res.status).toEqual(500);
      expect(res.body).toEqual({
        message: 'An error occurred trying to send entity metadata to OPA',
      });
    });

    it('returns a 400 if the input is missing', async () => {
      const res = await request(app)
        .post('/entity-checker')
        .send()
        .expect('Content-Type', /json/);

      expect(res.status).toEqual(400);
      expect(res.body.message).toBe('Entity metadata is missing!');
    });
  });
});
