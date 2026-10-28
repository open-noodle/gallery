import { Provider } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { galleryProviders } from 'src/gallery/index.js';
import { GalleryMachineLearningRepository } from 'src/gallery/repositories/gallery-machine-learning.repository.js';
import { GALLERY_REPOSITORY_DEPENDENCIES, GalleryRepositories } from 'src/gallery/repositories/index.js';
import { repositories } from 'src/repositories/index.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MachineLearningRepository } from 'src/repositories/machine-learning.repository.js';
import { services } from 'src/services/index.js';

const token = (provider: Provider) => ('provide' in provider ? provider.provide : provider);

describe('GalleryMachineLearningRepository registration', () => {
  it('is the one ML repository instance, behind both tokens and in GalleryRepositories', async () => {
    const tokens: Set<unknown> = new Set([
      MachineLearningRepository,
      GalleryMachineLearningRepository,
      GalleryRepositories,
    ]);
    // app.module's provider order (`common`), narrowed to the providers under test
    const registered = [...repositories, ...galleryProviders, ...services].filter((provider) =>
      tokens.has(token(provider)),
    );
    const logger = { setContext: vi.fn() };
    const stubs = GALLERY_REPOSITORY_DEPENDENCIES.filter((type) => !tokens.has(type)).map((type) => ({
      provide: type,
      useValue: {},
    }));

    const module = await Test.createTestingModule({
      providers: [...stubs, { provide: LoggingRepository, useValue: logger }, ...registered],
    }).compile();

    const machineLearning = module.get(MachineLearningRepository);
    expect(machineLearning).toBeInstanceOf(GalleryMachineLearningRepository);
    expect(module.get(GalleryMachineLearningRepository)).toBe(machineLearning);
    expect(module.get(GalleryRepositories).galleryMachineLearningRepository).toBe(machineLearning);
    // every ML repository constructor names its logger once; one call means one instance, so SystemConfigService's
    // setup() configures the only instance and its health-check interval cannot run twice
    expect(logger.setContext.mock.calls.filter(([name]) => name === MachineLearningRepository.name)).toHaveLength(1);
  });
});
