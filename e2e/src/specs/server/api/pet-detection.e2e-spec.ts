import { LoginResponseDto, QueueCommand, QueueName, getQueuesLegacy, mergePerson, updateConfig } from '@immich/sdk';
import { errorDto } from 'src/responses';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const getSystemConfig = (accessToken: string) => utils.getSystemConfig(accessToken);
const getQueues = (accessToken: string) => getQueuesLegacy({ headers: asBearerAuth(accessToken) });

describe('/pet-detection', () => {
  let admin: LoginResponseDto;
  let user1: LoginResponseDto;
  let user2: LoginResponseDto;

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup();

    [user1, user2] = await Promise.all([
      utils.userSetup(admin.accessToken, {
        email: 'pet-user1@immich.cloud',
        name: 'Pet User 1',
        password: 'password',
      }),
      utils.userSetup(admin.accessToken, {
        email: 'pet-user2@immich.cloud',
        name: 'Pet User 2',
        password: 'password',
      }),
    ]);

    await utils.connectDatabase();
  });

  afterAll(async () => {
    await utils.resetAdminConfig(admin.accessToken);
    await utils.disconnectDatabase();
  });

  describe('Config Management', () => {
    it('should have pet detection disabled by default with rfdetr-nano and 0.3 minScore', async () => {
      const config = await getSystemConfig(admin.accessToken);

      expect(config.machineLearning.petDetection).toEqual({
        enabled: false,
        modelName: 'rfdetr-nano',
        minScore: 0.3,
      });
    });

    it('should enable pet detection', async () => {
      const config = await getSystemConfig(admin.accessToken);
      config.machineLearning.petDetection.enabled = true;
      const updated = await updateConfig({ adminConfigDto: config }, { headers: asBearerAuth(admin.accessToken) });

      expect(updated.machineLearning.petDetection.enabled).toBe(true);

      const refetched = await getSystemConfig(admin.accessToken);
      expect(refetched.machineLearning.petDetection.enabled).toBe(true);
    });

    it('should change model to rfdetr-small', async () => {
      const config = await getSystemConfig(admin.accessToken);
      config.machineLearning.petDetection.modelName = 'rfdetr-small';
      await updateConfig({ adminConfigDto: config }, { headers: asBearerAuth(admin.accessToken) });

      const refetched = await getSystemConfig(admin.accessToken);
      expect(refetched.machineLearning.petDetection.modelName).toBe('rfdetr-small');
    });

    it('should migrate a persisted legacy model to rfdetr-nano', async () => {
      const config = await getSystemConfig(admin.accessToken);
      config.machineLearning.petDetection.modelName = 'yolo11m';
      await updateConfig({ adminConfigDto: config }, { headers: asBearerAuth(admin.accessToken) });

      const refetched = await getSystemConfig(admin.accessToken);
      expect(refetched.machineLearning.petDetection.modelName).toBe('rfdetr-nano');
    });

    it('should change minScore to 0.3', async () => {
      const config = await getSystemConfig(admin.accessToken);
      config.machineLearning.petDetection.minScore = 0.3;
      await updateConfig({ adminConfigDto: config }, { headers: asBearerAuth(admin.accessToken) });

      const refetched = await getSystemConfig(admin.accessToken);
      expect(refetched.machineLearning.petDetection.minScore).toBe(0.3);
    });

    it('should reject minScore below 0.1', async () => {
      const config = await getSystemConfig(admin.accessToken);
      config.machineLearning.petDetection.minScore = 0.05;

      const { status, body } = await request(app)
        .put('/system-config')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send(config);

      expect(status).toBe(400);
      expect(body).toEqual(
        errorDto.validationError([
          {
            path: ['machineLearning', 'petDetection', 'minScore'],
            message: 'Too small: expected number to be >=0.1',
          },
        ]),
      );
    });

    it('should reject minScore above 1.0', async () => {
      const config = await getSystemConfig(admin.accessToken);
      config.machineLearning.petDetection.minScore = 1.5;

      const { status, body } = await request(app)
        .put('/system-config')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send(config);

      expect(status).toBe(400);
      expect(body).toEqual(
        errorDto.validationError([
          {
            path: ['machineLearning', 'petDetection', 'minScore'],
            message: 'Too big: expected number to be <=1',
          },
        ]),
      );
    });

    it('should reject empty modelName', async () => {
      const config = await getSystemConfig(admin.accessToken);
      config.machineLearning.petDetection.modelName = '';

      const { status, body } = await request(app)
        .put('/system-config')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send(config);

      expect(status).toBe(400);
      expect(body).toEqual(
        errorDto.validationError([
          {
            path: ['machineLearning', 'petDetection', 'modelName'],
            message: 'Too small: expected string to have >=1 characters',
          },
        ]),
      );
    });

    it('should reset to defaults', async () => {
      await utils.resetAdminConfig(admin.accessToken);

      const config = await getSystemConfig(admin.accessToken);
      expect(config.machineLearning.petDetection).toEqual({
        enabled: false,
        modelName: 'rfdetr-nano',
        minScore: 0.3,
      });
    });
  });

  describe('Pet Recognition Config Management', () => {
    it('should have pet recognition disabled by default with pet-recognition-base, 0.55 maxDistance and 1 minFaces', async () => {
      const config = await getSystemConfig(admin.accessToken);

      expect(config.machineLearning.petRecognition).toEqual({
        enabled: false,
        modelName: 'pet-recognition-base',
        maxDistance: 0.55,
        minFaces: 1,
      });
    });

    it('should enable pet recognition and round-trip the change', async () => {
      const config = await getSystemConfig(admin.accessToken);
      config.machineLearning.petRecognition.enabled = true;
      const updated = await updateConfig({ adminConfigDto: config }, { headers: asBearerAuth(admin.accessToken) });

      expect(updated.machineLearning.petRecognition.enabled).toBe(true);

      const refetched = await getSystemConfig(admin.accessToken);
      expect(refetched.machineLearning.petRecognition.enabled).toBe(true);

      await utils.resetAdminConfig(admin.accessToken);
    });

    it('should reject maxDistance below 0.1', async () => {
      const config = await getSystemConfig(admin.accessToken);
      config.machineLearning.petRecognition.maxDistance = 0.05;

      const { status, body } = await request(app)
        .put('/system-config')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send(config);

      expect(status).toBe(400);
      expect(body).toEqual(
        errorDto.validationError([
          {
            path: ['machineLearning', 'petRecognition', 'maxDistance'],
            message: 'Too small: expected number to be >=0.1',
          },
        ]),
      );
    });

    it('should reject maxDistance above 2', async () => {
      const config = await getSystemConfig(admin.accessToken);
      config.machineLearning.petRecognition.maxDistance = 2.5;

      const { status, body } = await request(app)
        .put('/system-config')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send(config);

      expect(status).toBe(400);
      expect(body).toEqual(
        errorDto.validationError([
          {
            path: ['machineLearning', 'petRecognition', 'maxDistance'],
            message: 'Too big: expected number to be <=2',
          },
        ]),
      );
    });

    it('should reject minFaces below 1', async () => {
      const config = await getSystemConfig(admin.accessToken);
      config.machineLearning.petRecognition.minFaces = 0;

      const { status, body } = await request(app)
        .put('/system-config')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send(config);

      expect(status).toBe(400);
      expect(body).toEqual(
        errorDto.validationError([
          {
            path: ['machineLearning', 'petRecognition', 'minFaces'],
            message: 'Too small: expected number to be >=1',
          },
        ]),
      );
    });

    it('should reject minFaces above 1000', async () => {
      // searchPets rejects a numResults outside 1..1000 at query time, so an unbounded minFaces
      // would be accepted here and then throw on every recognition job instead.
      const config = await getSystemConfig(admin.accessToken);
      config.machineLearning.petRecognition.minFaces = 1001;

      const { status, body } = await request(app)
        .put('/system-config')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send(config);

      expect(status).toBe(400);
      expect(body).toEqual(
        errorDto.validationError([
          {
            path: ['machineLearning', 'petRecognition', 'minFaces'],
            message: 'Too big: expected number to be <=1000',
          },
        ]),
      );
    });

    // The whitelist lives in PetRecognitionService.onConfigValidate, not in the zod schema, so it
    // surfaces as a plain BadRequest rather than a validation error. Unit-tested already; this pins
    // that it actually reaches the HTTP layer.
    it('should reject an unknown pet recognition model over HTTP', async () => {
      const config = await getSystemConfig(admin.accessToken);
      config.machineLearning.petRecognition.modelName = 'pet-recognition-enormous';

      const { status, body } = await request(app)
        .put('/system-config')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send(config);

      expect(status).toBe(400);
      expect(body.message).toContain('Unknown pet recognition model: pet-recognition-enormous');
    });

    it('should reset to defaults', async () => {
      await utils.resetAdminConfig(admin.accessToken);

      const config = await getSystemConfig(admin.accessToken);
      expect(config.machineLearning.petRecognition).toEqual({
        enabled: false,
        modelName: 'pet-recognition-base',
        maxDistance: 0.55,
        minFaces: 1,
      });
    });
  });

  describe('Queue Operations', () => {
    it('should list petDetection in queues', async () => {
      const { status, body } = await request(app).get('/jobs').set('Authorization', `Bearer ${admin.accessToken}`);

      expect(status).toBe(200);
      expect(body).toHaveProperty('petDetection');
    });

    it('should accept start command on petDetection queue', async () => {
      const config = await getSystemConfig(admin.accessToken);
      config.machineLearning.petDetection.enabled = true;
      config.machineLearning.enabled = true;
      await updateConfig({ adminConfigDto: config }, { headers: asBearerAuth(admin.accessToken) });

      const { status } = await request(app)
        .put('/jobs/petDetection')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ command: QueueCommand.Start, force: false });

      expect(status).toBe(200);
      await utils.waitForQueueFinish(admin.accessToken, 'petDetection');

      await utils.resetAdminConfig(admin.accessToken);
    });

    it('should pause and resume petDetection queue', async () => {
      const { status: pauseStatus } = await request(app)
        .put('/jobs/petDetection')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ command: QueueCommand.Pause, force: false });

      expect(pauseStatus).toBe(200);

      const { status: resumeStatus } = await request(app)
        .put('/jobs/petDetection')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ command: QueueCommand.Resume, force: false });

      expect(resumeStatus).toBe(200);
    });

    it('should empty petDetection queue', async () => {
      const { status } = await request(app)
        .put('/jobs/petDetection')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ command: QueueCommand.Empty, force: false });

      expect(status).toBe(200);
    });

    it('should accept force reprocessing flag', async () => {
      const config = await getSystemConfig(admin.accessToken);
      config.machineLearning.petDetection.enabled = true;
      config.machineLearning.enabled = true;
      await updateConfig({ adminConfigDto: config }, { headers: asBearerAuth(admin.accessToken) });

      const { status } = await request(app)
        .put('/jobs/petDetection')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ command: QueueCommand.Start, force: true });

      expect(status).toBe(200);
      await utils.waitForQueueFinish(admin.accessToken, 'petDetection');

      await utils.resetAdminConfig(admin.accessToken);
    });
  });

  describe('Pet Recognition Queue Operations', () => {
    it('should list petRecognition in queues', async () => {
      const { status, body } = await request(app).get('/jobs').set('Authorization', `Bearer ${admin.accessToken}`);

      expect(status).toBe(200);
      expect(body).toHaveProperty('petRecognition');
    });

    it('should accept start command on petRecognition queue', async () => {
      const config = await getSystemConfig(admin.accessToken);
      config.machineLearning.petRecognition.enabled = true;
      config.machineLearning.enabled = true;
      await updateConfig({ adminConfigDto: config }, { headers: asBearerAuth(admin.accessToken) });

      const { status } = await request(app)
        .put('/jobs/petRecognition')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ command: QueueCommand.Start, force: false });

      expect(status).toBe(200);
      await utils.waitForQueueFinish(admin.accessToken, 'petRecognition');

      await utils.resetAdminConfig(admin.accessToken);
    });

    it('should pause and resume petRecognition queue', async () => {
      const { status: pauseStatus } = await request(app)
        .put('/jobs/petRecognition')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ command: QueueCommand.Pause, force: false });

      expect(pauseStatus).toBe(200);

      const { status: resumeStatus } = await request(app)
        .put('/jobs/petRecognition')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ command: QueueCommand.Resume, force: false });

      expect(resumeStatus).toBe(200);
    });

    it('should empty petRecognition queue', async () => {
      const { status } = await request(app)
        .put('/jobs/petRecognition')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ command: QueueCommand.Empty, force: false });

      expect(status).toBe(200);
    });
  });

  describe('Pet Person Records', () => {
    let petDogId: string;
    let petCatId: string;
    let asset1Id: string;
    let asset2Id: string;

    beforeAll(async () => {
      await utils.resetDatabase();
      admin = await utils.adminSetup();
      [user1, user2] = await Promise.all([
        utils.userSetup(admin.accessToken, {
          email: 'pet-user1@immich.cloud',
          name: 'Pet User 1',
          password: 'password',
        }),
        utils.userSetup(admin.accessToken, {
          email: 'pet-user2@immich.cloud',
          name: 'Pet User 2',
          password: 'password',
        }),
      ]);
      await utils.connectDatabase();

      const [a1, a2] = await Promise.all([utils.createAsset(admin.accessToken), utils.createAsset(admin.accessToken)]);
      asset1Id = a1.id;
      asset2Id = a2.id;
    });

    it('should create a pet person with type=pet and species=dog', async () => {
      petDogId = await utils.createPet(admin.userId, 'dog');

      const { status, body } = await request(app)
        .get(`/people/${petDogId}`)
        .set('Authorization', `Bearer ${admin.accessToken}`);

      expect(status).toBe(200);
      expect(body).toMatchObject({
        id: petDogId,
        type: 'pet',
        species: 'dog',
        name: 'dog',
      });
    });

    it('should create a separate pet person for cat species', async () => {
      petCatId = await utils.createPet(admin.userId, 'cat');

      const { status, body } = await request(app)
        .get(`/people/${petCatId}`)
        .set('Authorization', `Bearer ${admin.accessToken}`);

      expect(status).toBe(200);
      expect(body).toMatchObject({
        type: 'pet',
        species: 'cat',
      });
      expect(petCatId).not.toBe(petDogId);
    });

    it('should allow multiple pet records of the same species via direct DB insert', async () => {
      const secondDogId = await utils.createPet(admin.userId, 'dog');
      expect(secondDogId).not.toBe(petDogId);
    });

    it('should create separate pet records for different owners', async () => {
      const user1DogId = await utils.createPet(user1.userId, 'dog');
      const user2DogId = await utils.createPet(user2.userId, 'dog');

      expect(user1DogId).not.toBe(user2DogId);

      const { body: dog1 } = await request(app)
        .get(`/people/${user1DogId}`)
        .set('Authorization', `Bearer ${user1.accessToken}`);

      const { body: dog2 } = await request(app)
        .get(`/people/${user2DogId}`)
        .set('Authorization', `Bearer ${user2.accessToken}`);

      expect(dog1.species).toBe('dog');
      expect(dog2.species).toBe('dog');
    });

    it('should link pet to asset via createFace', async () => {
      await utils.createFace({ assetId: asset1Id, personGroupId: petDogId });

      const { body: stats } = await request(app)
        .get(`/people/${petDogId}/statistics`)
        .set('Authorization', `Bearer ${admin.accessToken}`);

      expect(stats.assets).toBeGreaterThanOrEqual(1);
    });

    it('should have thumbnailPath set on pet', async () => {
      const { body } = await request(app)
        .get(`/people/${petDogId}`)
        .set('Authorization', `Bearer ${admin.accessToken}`);

      expect(body.thumbnailPath).toBeTruthy();
    });

    it('should return type=pet and species for pet via GET /people/:id', async () => {
      const { status, body } = await request(app)
        .get(`/people/${petDogId}`)
        .set('Authorization', `Bearer ${admin.accessToken}`);

      expect(status).toBe(200);
      expect(body.type).toBe('pet');
      expect(body.species).toBe('dog');
    });

    it('should return type=person and no species for regular person', async () => {
      const person = await utils.createPerson(admin.accessToken, { name: 'Human Person' });

      const { status, body } = await request(app)
        .get(`/people/${person.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`);

      expect(status).toBe(200);
      expect(body.type).toBe('person');
      expect([null, undefined]).toContain(body.species);
    });

    it('should update pet name', async () => {
      const { status, body } = await request(app)
        .put(`/people/${petDogId}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ name: 'Buddy' });

      expect(status).toBe(200);
      expect(body.name).toBe('Buddy');
    });

    it('should toggle isHidden on pet', async () => {
      const { status, body } = await request(app)
        .put(`/people/${petDogId}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ isHidden: true });

      expect(status).toBe(200);
      expect(body.isHidden).toBe(true);

      const { body: body2 } = await request(app)
        .put(`/people/${petDogId}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ isHidden: false });

      expect(body2.isHidden).toBe(false);
    });

    it('should set isFavorite on pet', async () => {
      const { status, body } = await request(app)
        .put(`/people/${petDogId}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ isFavorite: true });

      expect(status).toBe(200);
      expect(body.isFavorite).toBe(true);
    });

    it('should return correct asset count for pet via statistics', async () => {
      await utils.createFace({ assetId: asset2Id, personGroupId: petCatId });

      const { status, body } = await request(app)
        .get(`/people/${petCatId}/statistics`)
        .set('Authorization', `Bearer ${admin.accessToken}`);

      expect(status).toBe(200);
      expect(body.assets).toBeGreaterThanOrEqual(1);
    });

    it('should delete a pet person', async () => {
      const tempPetId = await utils.createPet(admin.userId, 'horse');

      const { status: deleteStatus } = await request(app)
        .delete(`/people/${tempPetId}`)
        .set('Authorization', `Bearer ${admin.accessToken}`);

      expect(deleteStatus).toBe(204);

      const { status: getStatus } = await request(app)
        .get(`/people/${tempPetId}`)
        .set('Authorization', `Bearer ${admin.accessToken}`);

      expect(getStatus).toBe(400);
    });

    it('should merge two pet persons and consolidate faces', async () => {
      const pet1 = await utils.createPet(admin.userId, 'bird', 'Tweety');
      const pet2 = await utils.createPet(admin.userId, 'bird', 'Birdie');
      const asset = await utils.createAsset(admin.accessToken);
      await utils.createFace({ assetId: asset.id, personGroupId: pet2 });

      const { status } = await request(app)
        .post(`/people/${pet1}/merge`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ ids: [pet2] });

      expect(status).toBe(200);

      const { status: getStatus } = await request(app)
        .get(`/people/${pet2}`)
        .set('Authorization', `Bearer ${admin.accessToken}`);

      expect(getStatus).toBe(400);
    });

    it('should retain type=person when merging pet into regular person', async () => {
      const person = await utils.createPerson(admin.accessToken, { name: 'Merge Target Person' });
      const pet = await utils.createPet(admin.userId, 'sheep');

      await mergePerson(
        { id: person.id, mergePersonDto: { ids: [pet] } },
        { headers: asBearerAuth(admin.accessToken) },
      );

      const { body } = await request(app)
        .get(`/people/${person.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`);

      expect(body.type).toBe('person');
    });

    it('should retain type=pet when merging regular person into pet', async () => {
      const person = await utils.createPerson(admin.accessToken, { name: 'Merge Source Person' });
      const pet = await utils.createPet(admin.userId, 'zebra');

      await mergePerson(
        { id: pet, mergePersonDto: { ids: [person.id] } },
        { headers: asBearerAuth(admin.accessToken) },
      );

      const { body } = await request(app).get(`/people/${pet}`).set('Authorization', `Bearer ${admin.accessToken}`);

      expect(body.type).toBe('pet');
    });
  });

  describe('Person API Integration', () => {
    let integrationPetId: string;
    let integrationPersonId: string;
    let integrationAssetId: string;

    beforeAll(async () => {
      await utils.resetDatabase();
      admin = await utils.adminSetup();
      await utils.connectDatabase();

      const asset = await utils.createAsset(admin.accessToken);
      integrationAssetId = asset.id;

      integrationPetId = await utils.createPet(admin.userId, 'cat', 'Whiskers');
      const person = await utils.createPerson(admin.accessToken, { name: 'John' });
      integrationPersonId = person.id;

      await Promise.all([
        utils.createFace({ assetId: integrationAssetId, personGroupId: integrationPetId }),
        utils.createFace({ assetId: integrationAssetId, personGroupId: integrationPersonId }),
      ]);
    });

    it('should return both persons and pets in GET /people', async () => {
      const { status, body } = await request(app)
        .get('/people')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .query({ withHidden: true });

      expect(status).toBe(200);

      const types = body.people.map((p: any) => p.type);
      expect(types).toContain('person');
      expect(types).toContain('pet');
    });

    it('should include pet in asset people list', async () => {
      const asset = await utils.getAssetInfo(admin.accessToken, integrationAssetId);

      const petEntry = asset.people?.find((person) => person.id === integrationPetId);
      expect(petEntry).toBeDefined();
      expect(petEntry?.type).toBe('pet');
      expect(petEntry?.species).toBe('cat');

      const humanEntry = asset.people?.find((person) => person.id === integrationPersonId);
      expect(humanEntry).toBeDefined();
      expect(humanEntry?.type).toBe('person');
    });

    it('should handle multiple pets in same asset', async () => {
      const dogId = await utils.createPet(admin.userId, 'dog', 'Rex');
      const birdId = await utils.createPet(admin.userId, 'bird', 'Polly');

      const asset = await utils.createAsset(admin.accessToken);
      await Promise.all([
        utils.createFace({ assetId: asset.id, personGroupId: dogId }),
        utils.createFace({ assetId: asset.id, personGroupId: birdId }),
      ]);

      const [dogStats, birdStats] = await Promise.all([
        request(app).get(`/people/${dogId}/statistics`).set('Authorization', `Bearer ${admin.accessToken}`),
        request(app).get(`/people/${birdId}/statistics`).set('Authorization', `Bearer ${admin.accessToken}`),
      ]);

      expect(dogStats.body.assets).toBeGreaterThanOrEqual(1);
      expect(birdStats.body.assets).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Multi-user Isolation', () => {
    let isoUser1: LoginResponseDto;
    let isoUser2: LoginResponseDto;
    let user1PetId: string;
    let user2PetId: string;

    beforeAll(async () => {
      await utils.resetDatabase();
      admin = await utils.adminSetup();
      [isoUser1, isoUser2] = await Promise.all([
        utils.userSetup(admin.accessToken, {
          email: 'iso-user1@immich.cloud',
          name: 'Iso User 1',
          password: 'password',
        }),
        utils.userSetup(admin.accessToken, {
          email: 'iso-user2@immich.cloud',
          name: 'Iso User 2',
          password: 'password',
        }),
      ]);
      await utils.connectDatabase();

      user1PetId = await utils.createPet(isoUser1.userId, 'dog', 'Rover');
      user2PetId = await utils.createPet(isoUser2.userId, 'dog', 'Spot');

      const [a1, a2] = await Promise.all([
        utils.createAsset(isoUser1.accessToken),
        utils.createAsset(isoUser2.accessToken),
      ]);
      await Promise.all([
        utils.createFace({ assetId: a1.id, personGroupId: user1PetId }),
        utils.createFace({ assetId: a2.id, personGroupId: user2PetId }),
      ]);
    });

    it('should not show user1 pets to user2 in GET /people', async () => {
      const { body } = await request(app)
        .get('/people')
        .set('Authorization', `Bearer ${isoUser2.accessToken}`)
        .query({ withHidden: true });

      const petIds = body.people.map((p: any) => p.id);
      expect(petIds).not.toContain(user1PetId);
      expect(petIds).toContain(user2PetId);
    });

    it('should not allow user2 to access user1 pet via GET /people/:id', async () => {
      const { status } = await request(app)
        .get(`/people/${user1PetId}`)
        .set('Authorization', `Bearer ${isoUser2.accessToken}`);

      expect(status).toBe(400);
    });

    it('should not show user1 pets to admin', async () => {
      const { body } = await request(app)
        .get('/people')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .query({ withHidden: true });

      const petIds = body.people.map((p: any) => p.id);
      expect(petIds).not.toContain(user1PetId);
      expect(petIds).not.toContain(user2PetId);
    });

    it('should create separate pet records per user for same species', async () => {
      expect(user1PetId).not.toBe(user2PetId);

      const [{ body: pet1 }, { body: pet2 }] = await Promise.all([
        request(app).get(`/people/${user1PetId}`).set('Authorization', `Bearer ${isoUser1.accessToken}`),
        request(app).get(`/people/${user2PetId}`).set('Authorization', `Bearer ${isoUser2.accessToken}`),
      ]);

      expect(pet1.species).toBe('dog');
      expect(pet2.species).toBe('dog');
      expect(pet1.name).toBe('Rover');
      expect(pet2.name).toBe('Spot');
    });
  });

  // Slice 9 — the e2e stack has no ML service (no real detect->embed->cluster flow to exercise),
  // so this covers what e2e *can* prove: the force-reset flow purges pet data and requeues
  // detection through the real HTTP + queue + DB stack (R9.9), that the purge runs ahead of the
  // recognition-enabled gate (R9.10), and that a non-force start still honours that gate (R9.10b).
  describe('Force Reset & Recognition Queue Gate', () => {
    beforeAll(async () => {
      await utils.resetDatabase();
      admin = await utils.adminSetup();
      await utils.connectDatabase();
    });

    it('force-resets pet recognition: purges pet people and requeues detection under a paused petDetection queue (R9.9)', async () => {
      const asset = await utils.createAsset(admin.accessToken);
      const { personGroupId } = await utils.createPetWithEmbedding(admin.userId, 'dog', asset.id, 'Rex');

      // Recognition is enabled here so this exercises the ordinary path; the purge itself runs
      // ahead of the recognition-enabled gate either way (see R9.10 below).
      const config = await getSystemConfig(admin.accessToken);
      config.machineLearning.enabled = true;
      config.machineLearning.petRecognition.enabled = true;
      await updateConfig({ adminConfigDto: config }, { headers: asBearerAuth(admin.accessToken) });

      // Pause petDetection *before* triggering the reset so the PetDetectionQueueAll{force:true}
      // job the reset requeues is captured rather than immediately drained — a paused BullMQ
      // queue holds newly-added jobs under `paused`, not `waiting`, so the assertion below sums
      // both rather than asserting `waiting` alone.
      await utils.queueCommand(admin.accessToken, QueueName.PetDetection, {
        command: QueueCommand.Pause,
        force: false,
      });
      await utils.waitForQueuePaused(admin.accessToken, 'petDetection');

      const { status } = await request(app)
        .put('/jobs/petRecognition')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ command: QueueCommand.Start, force: true });

      expect(status).toBe(200);
      await utils.waitForQueueFinish(admin.accessToken, 'petRecognition');

      const { body } = await request(app)
        .get('/people')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .query({ withHidden: true });
      const petIds = body.people.map((p: any) => p.id);
      expect(petIds).not.toContain(personGroupId);

      const queues = await getQueues(admin.accessToken);
      expect(queues.petDetection.jobCounts.waiting + queues.petDetection.jobCounts.paused).toBeGreaterThan(0);

      // Clean up shared queue state before the next test / spec file runs (the e2e stack's
      // BullMQ queues are a machine-wide singleton across the whole vitest run).
      await utils.queueCommand(admin.accessToken, QueueName.PetDetection, {
        command: QueueCommand.Resume,
        force: false,
      });
      // Drain the requeued PetDetectionQueueAll{force:true} before leaving: its own purge (#718)
      // is unconditional, so letting it land mid-way through the next test would delete that
      // test's pets out from under it.
      await utils.waitForQueueFinish(admin.accessToken, 'petDetection');
      await utils.resetAdminConfig(admin.accessToken);
    });

    // The Reset dialog promises "this always deletes all named pets and their embeddings", so the
    // purge must not sit behind the recognition-enabled gate — the same #718 ordering the sibling
    // PetDetection queue already has. Only the non-force fan-out is gated.
    it('force-resetting petRecognition purges pets even while recognition is disabled (R9.10)', async () => {
      const asset = await utils.createAsset(admin.accessToken);
      const petId = await utils.createPet(admin.userId, 'cat', 'Whiskers');
      await utils.createFace({ assetId: asset.id, personGroupId: petId });

      // Recognition (and detection) stay at their default-disabled state here.
      const config = await getSystemConfig(admin.accessToken);
      expect(config.machineLearning.petRecognition.enabled).toBe(false);

      const { status } = await request(app)
        .put('/jobs/petRecognition')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ command: QueueCommand.Start, force: true });

      expect(status).toBe(200);
      await utils.waitForQueueFinish(admin.accessToken, 'petRecognition');

      const { status: getStatus } = await request(app)
        .get(`/people/${petId}`)
        .set('Authorization', `Bearer ${admin.accessToken}`);

      expect(getStatus).toBe(400);

      // Same reason as R9.9: the reset requeues a force detection run whose own purge would
      // otherwise land inside the next test.
      await utils.waitForQueueFinish(admin.accessToken, 'petDetection');
    });

    it('starting petRecognition WITHOUT force stays a no-op while recognition is disabled (R9.10b)', async () => {
      const asset = await utils.createAsset(admin.accessToken);
      const petId = await utils.createPet(admin.userId, 'cat', 'Mittens');
      await utils.createFace({ assetId: asset.id, personGroupId: petId });

      const config = await getSystemConfig(admin.accessToken);
      expect(config.machineLearning.petRecognition.enabled).toBe(false);

      const { status } = await request(app)
        .put('/jobs/petRecognition')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ command: QueueCommand.Start, force: false });

      expect(status).toBe(200);
      await utils.waitForQueueFinish(admin.accessToken, 'petRecognition');

      const { status: getStatus, body } = await request(app)
        .get(`/people/${petId}`)
        .set('Authorization', `Bearer ${admin.accessToken}`);

      expect(getStatus).toBe(200);
      expect(body.type).toBe('pet');
      expect(body.species).toBe('cat');
    });
  });
});
